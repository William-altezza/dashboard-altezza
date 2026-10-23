/**
 * Edge Function: sync-c2s
 * Sync incremental da API C2S → Supabase (a cada 15 min via pg_cron)
 * A API usa JSON:API — todos os campos em item.attributes.*
 *
 * CORREÇÕES 28/08/2026:
 *  1) A API C2S interpreta `updated_gte` em horário LOCAL (America/Sao_Paulo),
 *     mesmo com sufixo "Z". Enviar UTC criava uma janela cega de 3h por ciclo:
 *     leads atualizados nessa janela nunca eram sincronizados (negócios fechados
 *     ficaram de fora do dashboard). Agora o watermark UTC é convertido para o
 *     relógio de São Paulo antes de ir para a API. Só o formato
 *     YYYY-MM-DDTHH:MM:SSZ é aceito (offset explícito ou espaço → HTTP 403).
 *  2) Overlap de segurança de 30 min no watermark (o upsert é idempotente).
 *  3) parseCurrency: "747.870" (ponto de milhar pt-BR) era lido como 747,87.
 *  4) tag_potencial_em: data em que a etiqueta "Potencial" foi aplicada no C2S,
 *     para a Visão Geral poder contar por período de marcação.
 *  5) Parâmetros ?gte=&page=&pages=&async=1 para reprocessamento manual.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const C2S_TOKEN              = Deno.env.get('C2S_TOKEN')!
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PER_PAGE               = 50
const SLEEP_MS               = 6200
const OVERLAP_MIN            = 30

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

/** Converte um instante UTC para o "relógio" de São Paulo no formato aceito pela C2S. */
function toC2SDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso).replace(/\.\d{3}Z$/, 'Z').replace(/\+00:00$/, 'Z')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  const hh = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}-${g('month')}-${g('day')}T${hh}:${g('minute')}:${g('second')}Z`
}

// ── Mapeamento de funnel_status ───────────────────────────────────────────
const FUNNEL_MAP: Record<string, string> = {
  'new': 'new', 'new lead': 'new',
  'in attendance': 'in_attendance',
  'scheduled visit': 'scheduled_visit',
  'done visit': 'done_visit',
  'created offer': 'created_offer',
  'converted': 'converted',
  'lost': 'lost',
}

function normalizeFunnel(raw: string | null | undefined): string | null {
  return FUNNEL_MAP[(raw || '').toLowerCase()] ?? (raw || '').toLowerCase() ?? null
}

function funnelToStatus(funnel: string | null): string {
  const m: Record<string, string> = {
    new: 'Novo', in_attendance: 'Em negociação', scheduled_visit: 'Em negociação',
    done_visit: 'Em negociação', created_offer: 'Em negociação',
    converted: 'Negócio fechado', lost: 'Arquivado',
  }
  return m[funnel ?? ''] ?? funnel ?? ''
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function determineFunnelStatus(a: Record<string, any>): string | null {
  if (a.done_details?.done === true)              return 'converted'
  if (a.archive_details?.archived === true)       return 'lost'
  const alias = a.lead_status?.alias
  if (alias === 'converted')                      return 'converted'
  if (alias === 'lost' || alias === 'archived')   return 'lost'
  if (alias === 'new')                            return 'new'
  return normalizeFunnel(a.funnel_status?.status)
}

// ── País por telefone (sem lib externa no Deno) ───────────────────────────
const REGION_MAP: Record<string, string> = {
  BR:'Brasil', US:'América do Norte', CA:'América do Norte',
  GB:'Europa', GG:'Europa', JE:'Europa', IM:'Europa', IE:'Europa',
  CH:'Europa', IT:'Europa', PT:'Europa', DE:'Europa', BE:'Europa',
  ES:'Europa', NO:'Europa', FR:'Europa', NL:'Europa', AT:'Europa',
  SE:'Europa', DK:'Europa', FI:'Europa', PL:'Europa', LU:'Europa',
}

const PREFIXES: [string, string][] = [
  ['+55','BR'],['+358','FI'],['+353','IE'],['+352','LU'],['+351','PT'],
  ['+49','DE'],['+48','PL'],['+47','NO'],['+46','SE'],['+45','DK'],
  ['+44','GB'],['+43','AT'],['+41','CH'],['+39','IT'],['+34','ES'],
  ['+33','FR'],['+32','BE'],['+31','NL'],['+1','US'],
]

function parsePhoneCountry(phone: string | null): { pais_iso: string | null; regiao: string } {
  if (!phone) return { pais_iso: null, regiao: 'Outros' }
  const s = phone.trim().replace(/[^\d+]/g, '')
  const n = s.startsWith('+') ? s : `+${s}`
  for (const [prefix, iso] of PREFIXES) {
    if (n.startsWith(prefix)) return { pais_iso: iso, regiao: REGION_MAP[iso] || 'Outros' }
  }
  return { pais_iso: null, regiao: 'Outros' }
}

/** Aceita "R$ 1.712.380,00", "747.870", "750000.00", 530000 → number */
function parseCurrency(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return isNaN(raw) ? null : raw
  let s = String(raw).trim().replace(/^R\$\s*/, '').replace(/\s/g, '')
  if (s.includes(',')) {
    // padrão pt-BR: ponto = milhar, vírgula = decimal
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes('.')) {
    const dots = (s.match(/\./g) || []).length
    const afterLast = s.slice(s.lastIndexOf('.') + 1)
    // vários pontos, ou ponto seguido de exatamente 3 dígitos => separador de milhar
    if (dots > 1 || afterLast.length === 3) s = s.replace(/\./g, '')
  }
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseDate(raw: unknown): string | null {
  if (!raw) return null
  const d = new Date(String(raw))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** As tags do C2S vêm como "2026-07-15 06:59:16 -0300" (não é ISO). */
function parseC2SStamp(raw: unknown): string | null {
  if (!raw) return null
  let s = String(raw).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})?$/)
  if (m) s = `${m[1]}T${m[2]}${m[3]}:${m[4] ?? '00'}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** Quando a etiqueta "Potencial" foi aplicada (primeira vez). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tagPotencialEm(a: Record<string, any>): string | null {
  const tags = Array.isArray(a.tags) ? a.tags : []
  const datas = tags
    .filter((t: any) => String(t?.tag_name ?? t?.name ?? '').trim().toLowerCase() === 'potencial')
    .map((t: any) => parseC2SStamp(t?.added_at))
    .filter(Boolean) as string[]
  return datas.length > 0 ? datas.sort()[0] : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformItem(item: Record<string, any>) {
  const a        = item.attributes || {}
  const customer = a.customer || {}
  const seller   = a.seller || {}

  const telefone           = customer.phone_global || customer.phone || null
  const { pais_iso, regiao } = parsePhoneCountry(telefone)
  const funnel_status_atual  = determineFunnelStatus(a)
  const data_entrada         = parseDate(a.created_at)

  return {
    id_lead:             String(item.id),
    data_entrada:        data_entrada ?? new Date().toISOString(),
    origem:              a.lead_source?.name ?? null,
    canal:               a.channel?.name ?? null,
    nome_cliente:        customer.name ?? null,
    telefone,
    pais_iso,
    regiao,
    corretor:            seller.name ?? null,
    status_atual:        a.lead_status?.name ?? funnelToStatus(funnel_status_atual),
    funnel_status_atual,
    tags:                Array.isArray(a.tags) ? a.tags.map((t: any) => (t.tag_name || t.name || t)?.trim?.() || t).filter(Boolean) : [],
    valor_potencial:     parseCurrency(a.product?.price_float),
    tag_potencial_em:    tagPotencialEm(a),
    done_deal_at:        parseDate(a.done_deal_at),
    valor_venda:         parseCurrency(a.done_details?.done_price),
    arquivado:           a.archive_details?.archived === true || funnel_status_atual === 'lost',
    motivo_arquivamento: a.archive_details?.archive_notes ?? null,
    empreendimento:      a.product?.description ?? a.description ?? null,
    created_at_c2s:      data_entrada ?? null,
    updated_at_c2s:      parseDate(a.updated_at),
    raw:                 item,
    synced_at:           new Date().toISOString(),
  }
}

async function runSync(reqUrl: URL) {
  const gteOverride = reqUrl.searchParams.get('gte')
  const startPage   = parseInt(reqUrl.searchParams.get('page') || '1')
  const maxPages    = parseInt(reqUrl.searchParams.get('pages') || '400')
  const noLog       = reqUrl.searchParams.get('nolog') === '1'

  let rawGte: string
  if (gteOverride) {
    rawGte = new Date(gteOverride).toISOString()
  } else {
    const { data: lastLog } = await supabase
      .from('sync_log')
      .select('ultimo_updated_gte')
      .eq('tipo', 'incremental')
      .eq('status', 'completed')
      .order('finalizado_em', { ascending: false })
      .limit(1)
      .single()
    const base = lastLog?.ultimo_updated_gte ?? new Date(Date.now() - 15 * 60 * 1000).toISOString()
    rawGte = new Date(new Date(base).getTime() - OVERLAP_MIN * 60 * 1000).toISOString()
  }

  const updatedGte = toC2SDate(rawGte)
  console.log(`Sync incremental desde (UTC ${rawGte}) -> enviado a C2S como ${updatedGte}`)

  const { data: logRow } = await supabase
    .from('sync_log')
    .insert({ tipo: 'incremental', iniciado_em: new Date().toISOString(), status: 'running', ultimo_updated_gte: rawGte })
    .select('id').single()
  const logId = logRow?.id

  let totalProcessed = 0
  let newestUpdated  = rawGte

  try {
    let page = startPage
    let hasMore = true
    let loops = 0

    while (hasMore && loops < maxPages) {
      loops++
      const url = new URL('https://api.contact2sale.com/integration/leads')
      url.searchParams.set('page', String(page))
      url.searchParams.set('perpage', String(PER_PAGE))
      url.searchParams.set('updated_gte', updatedGte)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${C2S_TOKEN}` },
      })
      if (!res.ok) throw new Error(`C2S HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)

      const json  = await res.json()
      const items: any[] = json.data || []
      const total: number = json.meta?.total ?? 0

      if (items.length === 0) { hasMore = false; break }

      const leads = items.map(transformItem)
      const eventos = leads
        .filter(l => l.funnel_status_atual && l.data_entrada)
        .map(l => ({
          id_lead:       l.id_lead,
          status:        l.status_atual,
          funnel_status: l.funnel_status_atual,
          corretor:      l.corretor,
          data_evento:   l.data_entrada,
        }))

      const { error: leadsErr } = await supabase
        .from('leads').upsert(leads, { onConflict: 'id_lead' })
      if (leadsErr) throw leadsErr

      if (eventos.length > 0) {
        await supabase.from('lead_eventos')
          .upsert(eventos, { onConflict: 'id_lead,funnel_status,data_evento', ignoreDuplicates: true })
      }

      totalProcessed += leads.length

      for (const l of leads) {
        if (l.updated_at_c2s && l.updated_at_c2s > newestUpdated) newestUpdated = l.updated_at_c2s
      }

      console.log(`Página ${page}: ${leads.length} leads | total API: ${total}`)

      const totalPages = Math.ceil(total / PER_PAGE)
      if (page >= totalPages || items.length < PER_PAGE) { hasMore = false } else { page++; await sleep(SLEEP_MS) }
    }

    await supabase.rpc('marcar_recuperados')

    await supabase.from('sync_log').update({
      finalizado_em: new Date().toISOString(),
      registros: totalProcessed,
      status: 'completed',
      ultimo_updated_gte: noLog ? rawGte : newestUpdated,
      erro: null,
    }).eq('id', logId)

    return { ok: true, processados: totalProcessed, enviadoComoGte: updatedGte, ultimoUpdated: newestUpdated }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Erro sync-c2s:', msg)
    await supabase.from('sync_log')
      .update({ status: 'error', erro: msg, finalizado_em: new Date().toISOString() })
      .eq('id', logId)
    return { ok: false, erro: msg }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  const reqUrl = new URL(req.url)

  // Modo assíncrono para reprocessamentos longos: ?async=1
  if (reqUrl.searchParams.get('async') === '1') {
    const p = runSync(reqUrl)
    // @ts-ignore EdgeRuntime global
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p)
    return new Response(JSON.stringify({ started: true }), { headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  const out = await runSync(reqUrl)
  return new Response(JSON.stringify(out), {
    status: out.ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})
