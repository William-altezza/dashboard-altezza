/**
 * Edge Function: sync-c2s
 * Sync incremental da API C2S → Supabase (a cada 15 min via pg_cron)
 * A API usa JSON:API — todos os campos em item.attributes.*
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const C2S_TOKEN              = Deno.env.get('C2S_TOKEN')!
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PER_PAGE               = 50
const SLEEP_MS               = 6200

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

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

function parseCurrency(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return isNaN(raw) ? null : raw
  let s = String(raw).trim().replace(/^R\$\s*/, '')
  if (s.includes(',') || (s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseDate(raw: unknown): string | null {
  if (!raw) return null
  const d = new Date(String(raw))
  return isNaN(d.getTime()) ? null : d.toISOString()
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
    tags:                Array.isArray(a.tags) ? a.tags.map((t: any) => t.name || t).filter(Boolean) : [],
    valor_potencial:     parseCurrency(a.product?.price_float),
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  // Último updated_gte de sync bem-sucedido
  const { data: lastLog } = await supabase
    .from('sync_log')
    .select('ultimo_updated_gte')
    .eq('tipo', 'incremental')
    .eq('status', 'completed')
    .order('finalizado_em', { ascending: false })
    .limit(1)
    .single()

  // A API C2S exige formato sem milissegundos: YYYY-MM-DDTHH:MM:SSZ
  function toC2SDate(iso: string): string {
    return iso.replace(/\.\d{3}Z$/, 'Z').replace(/\+00:00$/, 'Z')
  }

  const rawGte = lastLog?.ultimo_updated_gte
    ?? new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const updatedGte = toC2SDate(rawGte)

  console.log(`Sync incremental desde: ${updatedGte}`)

  const { data: logRow } = await supabase
    .from('sync_log')
    .insert({ tipo: 'incremental', iniciado_em: new Date().toISOString(), status: 'running', ultimo_updated_gte: updatedGte })
    .select('id').single()
  const logId = logRow?.id

  let totalProcessed = 0
  let newestUpdated  = updatedGte

  try {
    let page = 1
    let hasMore = true

    while (hasMore) {
      const url = new URL('https://api.contact2sale.com/integration/leads')
      url.searchParams.set('page', String(page))
      url.searchParams.set('perpage', String(PER_PAGE))
      url.searchParams.set('updated_gte', updatedGte)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${C2S_TOKEN}` },
      })
      if (!res.ok) throw new Error(`C2S HTTP ${res.status}: ${await res.text()}`)

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

      // Rastreia updated_at mais recente
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
      ultimo_updated_gte: newestUpdated,
      erro: null,
    }).eq('id', logId)

    return new Response(
      JSON.stringify({ ok: true, processados: totalProcessed, ultimoUpdated: newestUpdated }),
      { headers: { 'Content-Type': 'application/json', ...CORS } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Erro sync-c2s:', msg)
    await supabase.from('sync_log')
      .update({ status: 'error', erro: msg, finalizado_em: new Date().toISOString() })
      .eq('id', logId)
    return new Response(JSON.stringify({ ok: false, erro: msg }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } })
  }
})
