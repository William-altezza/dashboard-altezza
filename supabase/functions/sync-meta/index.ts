/**
 * Edge Function: sync-meta
 * Busca spend diário dos últimos 7 dias de todas as contas ativas do Meta
 * Converte USD → BRL usando taxa PTAX do Banco Central (com fallback dias úteis)
 * Agendada 1x/dia (madrugada)
 *
 * POST body:
 *   { backfill: true, since: "YYYY-MM-DD", until: "YYYY-MM-DD" }
 *     → backfill histórico de uma conta
 *   { reprocess_cambio: true }
 *     → reprocessa todos os registros existentes aplicando câmbio histórico
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const META_TOKEN           = Deno.env.get('META_ACCESS_TOKEN')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const META_GRAPH_VERSION   = 'v21.0'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
})

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Meta API ────────────────────────────────────────────────────────────────

async function fetchAccountCurrency(accountId: string): Promise<string> {
  const cleanId = accountId.replace('act_', '')
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/act_${cleanId}`)
  url.searchParams.set('fields', 'currency')
  url.searchParams.set('access_token', META_TOKEN)
  const res = await fetch(url.toString())
  if (!res.ok) return 'BRL'
  const json = await res.json()
  return json.currency || 'BRL'
}

async function fetchSpend(
  accountId: string,
  since: string,
  until: string
): Promise<Array<{ date_start: string; spend: string }>> {
  const cleanId = accountId.replace('act_', '')
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/act_${cleanId}/insights`)
  url.searchParams.set('fields', 'spend,date_start')
  url.searchParams.set('time_increment', '1')
  url.searchParams.set('time_range', JSON.stringify({ since, until }))
  url.searchParams.set('access_token', META_TOKEN)
  url.searchParams.set('limit', '90')

  const res = await fetch(url.toString())
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errCode = (body as any)?.error?.code
    if (errCode === 190) throw new Error('META_TOKEN_EXPIRED')
    throw new Error(`Meta API ${res.status}: ${JSON.stringify(body)}`)
  }
  const json = await res.json()
  return json.data || []
}

// ── Banco Central PTAX ───────────────────────────────────────────────────────

// Cache em memória dentro da execução
const ptaxCache: Record<string, number> = {}

async function fetchPtax(date: string): Promise<number | null> {
  // Try the date itself, then up to 5 days back (handles weekends/holidays)
  for (let daysBack = 0; daysBack <= 5; daysBack++) {
    const d = new Date(date + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - daysBack)
    const mm   = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd   = String(d.getUTCDate()).padStart(2, '0')
    const yyyy = String(d.getUTCFullYear())
    const ptaxDate = `${mm}-${dd}-${yyyy}` // format required by BCB API

    if (ptaxCache[ptaxDate] !== undefined) return ptaxCache[ptaxDate]

    try {
      const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${ptaxDate}'&$top=1&$format=json&$select=cotacaoVenda`
      const res  = await fetch(url)
      if (!res.ok) continue
      const json = await res.json()
      const taxa = json.value?.[0]?.cotacaoVenda
      if (taxa) {
        ptaxCache[ptaxDate] = taxa
        return taxa
      }
    } catch {
      continue
    }
    await sleep(200)
  }
  return null
}

// Persiste taxa no Supabase (cache permanente para reprocessamentos futuros)
async function upsertCambio(date: string, taxa: number) {
  await supabase.from('cambio').upsert(
    { data: date, moeda: 'USD', taxa, fonte: 'ptax' },
    { onConflict: 'data,moeda' }
  )
}

// ── Reprocessamento de registros sem câmbio ─────────────────────────────────

async function reprocessExistingRecords(): Promise<{ updated: number; erros: string[] }> {
  const erros: string[] = []
  let updated = 0

  // Busca contas com moeda USD
  const { data: contas } = await supabase
    .from('contas_anuncio')
    .select('id, moeda')
    .eq('moeda', 'USD')

  if (!contas || contas.length === 0) {
    // Nenhuma conta USD — tenta detectar moeda de todas as contas ativas
    console.log('Nenhuma conta USD cadastrada — verifique se detectou a moeda corretamente.')
    return { updated, erros: ['Nenhuma conta USD encontrada para reprocessar'] }
  }

  const contaUsdIds = contas.map(c => c.id)

  // Busca registros de investimentos das contas USD sem taxa de câmbio aplicada
  const { data: rows, error } = await supabase
    .from('investimentos')
    .select('id, data, valor, valor_original, moeda')
    .in('conta_id', contaUsdIds)
    .is('taxa_cambio', null)
    .eq('fonte', 'api')

  if (error) { erros.push(error.message); return { updated, erros } }
  if (!rows || rows.length === 0) {
    console.log('Nenhum registro sem câmbio para reprocessar.')
    return { updated, erros }
  }

  console.log(`Reprocessando ${rows.length} registros sem câmbio...`)

  for (const row of rows) {
    const taxa = await fetchPtax(row.data)
    if (!taxa) {
      erros.push(`Sem taxa PTAX para ${row.data}`)
      continue
    }
    const valorUsd  = row.valor_original ?? row.valor // valor original pode já estar em USD
    const valorBrl  = Math.round(valorUsd * taxa * 100) / 100

    const { error: updErr } = await supabase
      .from('investimentos')
      .update({
        moeda:          'USD',
        valor_original: valorUsd,
        taxa_cambio:    taxa,
        valor:          valorBrl,
      })
      .eq('id', row.id)

    if (updErr) { erros.push(updErr.message); continue }

    await upsertCambio(row.data, taxa)
    updated++
    await sleep(100)
  }

  return { updated, erros }
}

// ── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  let backfill = false
  let sinceDateOverride: string | null = null
  let untilDateOverride: string | null = null
  let reprocessCambio = false

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      backfill           = body.backfill === true
      sinceDateOverride  = body.since || null
      untilDateOverride  = body.until || null
      reprocessCambio    = body.reprocess_cambio === true
    } catch { /* ignora body inválido */ }
  }

  // Modo especial: reprocessar câmbio de registros existentes
  if (reprocessCambio) {
    const result = await reprocessExistingRecords()
    return new Response(
      JSON.stringify({ ok: result.erros.length === 0, ...result }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    )
  }

  // Busca todas as contas ativas
  const { data: contas, error: contasErr } = await supabase
    .from('contas_anuncio')
    .select('id, nome, moeda')
    .eq('ativa', true)

  if (contasErr || !contas || contas.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, erro: 'Nenhuma conta de anúncio ativa encontrada' }),
      { status: 422, headers: { 'Content-Type': 'application/json', ...CORS } }
    )
  }

  const logId: Record<string, number> = {}
  let totalUpserted = 0
  const erros: string[] = []

  for (const conta of contas) {
    let since: string
    let until: string

    if (backfill && sinceDateOverride && untilDateOverride) {
      since = sinceDateOverride
      until = untilDateOverride
    } else {
      const now = new Date()
      until = formatDate(now)
      const sevenDaysAgo = new Date(now)
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      since = formatDate(sevenDaysAgo)
    }

    console.log(`Conta ${conta.nome} (${conta.id}): buscando ${since} → ${until}`)

    // Detecta moeda da conta se ainda não foi detectada
    let moeda = conta.moeda || 'BRL'
    if (!conta.moeda) {
      moeda = await fetchAccountCurrency(conta.id)
      await supabase.from('contas_anuncio').update({ moeda }).eq('id', conta.id)
      console.log(`  Moeda detectada: ${moeda}`)
    }

    const { data: logRow } = await supabase
      .from('sync_log')
      .insert({
        tipo:        'meta_diario',
        iniciado_em: new Date().toISOString(),
        status:      'running',
      })
      .select('id')
      .single()

    logId[conta.id] = logRow?.id

    try {
      let insights: Array<{ date_start: string; spend: string }> = []

      if (backfill) {
        // Divide em janelas de 90 dias
        const sinceD = new Date(since + 'T12:00:00Z')
        const untilD = new Date(until + 'T12:00:00Z')
        let cursor   = new Date(sinceD)

        while (cursor <= untilD) {
          const windowEnd = new Date(cursor)
          windowEnd.setUTCDate(windowEnd.getUTCDate() + 89)
          const windowUntil = windowEnd > untilD ? untilD : windowEnd

          const chunk = await fetchSpend(conta.id, formatDate(cursor), formatDate(windowUntil))
          insights = insights.concat(chunk)

          cursor = new Date(windowUntil)
          cursor.setUTCDate(cursor.getUTCDate() + 1)
          await sleep(500)
        }
      } else {
        insights = await fetchSpend(conta.id, since, until)
      }

      if (insights.length > 0) {
        const rows: Record<string, unknown>[] = []

        for (const i of insights) {
          const spendRaw = parseFloat(i.spend) || 0
          if (spendRaw === 0) continue // não salvar dias sem gasto

          let valorBrl        = spendRaw
          let valorOriginal: number | null = null
          let taxaCambio: number | null = null

          if (moeda === 'USD') {
            const taxa = await fetchPtax(i.date_start)
            if (taxa) {
              taxaCambio    = taxa
              valorOriginal = spendRaw
              valorBrl      = Math.round(spendRaw * taxa * 100) / 100
              await upsertCambio(i.date_start, taxa)
            } else {
              console.warn(`  Sem taxa PTAX para ${i.date_start} — gravando valor USD como fallback`)
              valorOriginal = spendRaw
              // valor permanece em USD até reprocessamento posterior
            }
            await sleep(150)
          }

          rows.push({
            data:           i.date_start,
            canal:          'Meta Ads',
            conta_id:       conta.id,
            valor:          valorBrl,
            fonte:          'api',
            moeda,
            valor_original: valorOriginal,
            taxa_cambio:    taxaCambio,
          })
        }

        if (rows.length > 0) {
          const { error: upsertErr } = await supabase
            .from('investimentos')
            .upsert(rows, { onConflict: 'data,canal,conta_id,fonte' })

          if (upsertErr) throw upsertErr
          totalUpserted += rows.length
          console.log(`  ✓ ${rows.length} dias upsertados para ${conta.nome}`)
        }
      }

      await supabase
        .from('sync_log')
        .update({
          finalizado_em: new Date().toISOString(),
          registros:     insights.length,
          status:        'completed',
        })
        .eq('id', logId[conta.id])

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Erro conta ${conta.id}:`, msg)
      erros.push(`${conta.nome}: ${msg}`)

      await supabase
        .from('sync_log')
        .update({ status: 'error', erro: msg, finalizado_em: new Date().toISOString() })
        .eq('id', logId[conta.id])

      if (msg === 'META_TOKEN_EXPIRED') {
        await supabase.from('data_quality_issues').insert({
          id_lead:  null,
          problema: 'META_TOKEN_EXPIRED',
          detalhe:  { conta_id: conta.id, conta_nome: conta.nome },
        })
      }
    }

    await sleep(1000)
  }

  const statusCode = erros.length > 0 && totalUpserted === 0 ? 500 : 200

  return new Response(
    JSON.stringify({
      ok:         erros.length === 0,
      upsertados: totalUpserted,
      erros:      erros.length > 0 ? erros : undefined,
    }),
    { status: statusCode, headers: { 'Content-Type': 'application/json', ...CORS } }
  )
})
