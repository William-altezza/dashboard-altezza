/**
 * sync-meta-campanhas
 * Espelha as campanhas do Meta Ads (nível campanha, por dia) nas tabelas
 * meta_campanhas (cadastro/status/orçamento) e meta_campanhas_dia (métricas).
 *
 * Uso:
 *   GET/POST  (sem parâmetros)            → últimos 14 dias
 *   ?since=YYYY-MM-DD&until=YYYY-MM-DD    → intervalo (backfill)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const META_TOKEN = Deno.env.get('META_ACCESS_TOKEN')!
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)
const V = 'v21.0'
const fmt = (d: Date) => d.toISOString().slice(0, 10)

// deno-lint-ignore no-explicit-any
async function graph(path: string, params: Record<string, string>): Promise<any[]> {
  const out: any[] = []
  const u = new URL(`https://graph.facebook.com/${V}/${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  u.searchParams.set('access_token', META_TOKEN)
  let next: string | null = u.toString()
  while (next) {
    const r = await fetch(next)
    const j = await r.json()
    if (!r.ok) throw new Error(`Meta ${r.status}: ${JSON.stringify(j?.error ?? j)}`)
    out.push(...(j.data || []))
    next = j.paging?.next || null
  }
  return out
}

// deno-lint-ignore no-explicit-any
function acao(actions: any[] | undefined, tipos: string[]): number {
  for (const t of tipos) {
    const a = (actions || []).find(x => x.action_type === t)
    if (a) return Math.round(Number(a.value) || 0)
  }
  return 0
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const hoje = new Date()
  const since = url.searchParams.get('since') || fmt(new Date(hoje.getTime() - 14 * 86400000))
  const until = url.searchParams.get('until') || fmt(hoje)

  const { data: contas, error: cErr } = await supabase
    .from('contas_anuncio').select('id, nome, moeda').eq('ativa', true)
  if (cErr) return Response.json({ ok: false, erro: cErr.message }, { status: 500 })

  // câmbio USD→BRL (para contas em dólar)
  const { data: cambio } = await supabase
    .from('cambio').select('data, taxa').eq('moeda', 'USD').order('data', { ascending: false })
  const taxaEm = (d: string) => {
    const c = (cambio || []).find(x => x.data <= d) || (cambio || [])[0]
    return c ? Number(c.taxa) : 5
  }

  const erros: string[] = []
  let dias = 0, camps = 0

  for (const conta of contas || []) {
    try {
      const moeda = conta.moeda || 'BRL'

      // 1) cadastro das campanhas
      const lista = await graph(`${conta.id}/campaigns`, {
        fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget',
        limit: '200',
      })
      if (lista.length) {
        const rows = lista.map(c => ({
          campaign_id: c.id,
          conta_id: conta.id,
          nome: c.name,
          objetivo: c.objective ?? null,
          status: c.status ?? null,
          status_efetivo: c.effective_status ?? null,
          orcamento_diario: c.daily_budget ? Number(c.daily_budget) / 100 : null,
          orcamento_total: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
          atualizado_em: new Date().toISOString(),
        }))
        const { error } = await supabase.from('meta_campanhas').upsert(rows, { onConflict: 'campaign_id' })
        if (error) throw error
        camps += rows.length
      }

      // 2) métricas por campanha/dia, em janelas de 30 dias
      let cursor = new Date(since + 'T12:00:00Z')
      const fim = new Date(until + 'T12:00:00Z')
      while (cursor <= fim) {
        const winEnd = new Date(Math.min(cursor.getTime() + 29 * 86400000, fim.getTime()))
        const ins = await graph(`${conta.id}/insights`, {
          level: 'campaign',
          time_increment: '1',
          time_range: JSON.stringify({ since: fmt(cursor), until: fmt(winEnd) }),
          fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,actions',
          limit: '500',
        })
        const rows = ins.map(i => {
          const gasto = Number(i.spend) || 0
          return {
            data: i.date_start,
            campaign_id: i.campaign_id,
            conta_id: conta.id,
            nome: i.campaign_name,
            moeda,
            gasto,
            gasto_brl: moeda === 'USD' ? gasto * taxaEm(i.date_start) : gasto,
            impressoes: Number(i.impressions) || 0,
            alcance: Number(i.reach) || 0,
            cliques: Number(i.clicks) || 0,
            cliques_link: Number(i.inline_link_clicks) || 0,
            leads: acao(i.actions, ['lead', 'onsite_conversion.lead_grouped']),
            conversas: acao(i.actions, ['onsite_conversion.messaging_conversation_started_7d']),
          }
        })
        for (let k = 0; k < rows.length; k += 500) {
          const { error } = await supabase
            .from('meta_campanhas_dia').upsert(rows.slice(k, k + 500), { onConflict: 'data,campaign_id' })
          if (error) throw error
        }
        dias += rows.length
        cursor = new Date(winEnd.getTime() + 86400000)
      }
    } catch (e) {
      erros.push(`${conta.nome}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return Response.json(
    { ok: erros.length === 0, since, until, campanhas: camps, linhas_dia: dias, erros: erros.length ? erros : undefined },
    { status: erros.length && !dias ? 500 : 200 },
  )
})
