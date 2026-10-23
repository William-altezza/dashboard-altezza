/**
 * sync-meta-estrutura
 * Conjuntos de anúncios e anúncios do Meta (cadastro + métricas por dia).
 * Complementa o sync-meta-campanhas (nível campanha).
 *
 *   ?since=YYYY-MM-DD&until=YYYY-MM-DD   (padrão: últimos 7 dias)
 *   ?conta=act_123                       (opcional: só uma conta)
 *   ?level=adset|ad                      (opcional: só um nível)
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
  // deno-lint-ignore no-explicit-any
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

async function gravar(tabela: string, rows: Record<string, unknown>[], conflito: string) {
  for (let k = 0; k < rows.length; k += 500) {
    const { error } = await supabase.from(tabela).upsert(rows.slice(k, k + 500), { onConflict: conflito })
    if (error) throw error
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const hoje = new Date()
  const since = url.searchParams.get('since') || fmt(new Date(hoje.getTime() - 7 * 86400000))
  const until = url.searchParams.get('until') || fmt(hoje)
  const soConta = url.searchParams.get('conta')
  const soNivel = url.searchParams.get('level')

  let q = supabase.from('contas_anuncio').select('id, nome, moeda').eq('ativa', true)
  if (soConta) q = q.eq('id', soConta)
  const { data: contas, error: cErr } = await q
  if (cErr) return Response.json({ ok: false, erro: cErr.message }, { status: 500 })

  const { data: cambio } = await supabase
    .from('cambio').select('data, taxa').eq('moeda', 'USD').order('data', { ascending: false })
  const taxaEm = (d: string) => {
    const c = (cambio || []).find(x => x.data <= d) || (cambio || [])[0]
    return c ? Number(c.taxa) : 5
  }

  const erros: string[] = []
  const cont = { conjuntos: 0, anuncios: 0, dias_conjunto: 0, dias_anuncio: 0 }

  for (const conta of contas || []) {
    const moeda = conta.moeda || 'BRL'
    const brl = (g: number, d: string) => (moeda === 'USD' ? g * taxaEm(d) : g)

    // deno-lint-ignore no-explicit-any
    const metricas = (i: any) => {
      const g = Number(i.spend) || 0
      return {
        gasto_brl: brl(g, i.date_start),
        impressoes: Number(i.impressions) || 0,
        alcance: Number(i.reach) || 0,
        cliques_link: Number(i.inline_link_clicks) || 0,
        leads: acao(i.actions, ['lead', 'onsite_conversion.lead_grouped']),
        conversas: acao(i.actions, ['onsite_conversion.messaging_conversation_started_7d']),
      }
    }

    for (const nivel of ['adset', 'ad']) {
      if (soNivel && soNivel !== nivel) continue
      try {
        // cadastro
        if (nivel === 'adset') {
          const lista = await graph(`${conta.id}/adsets`, {
            fields: 'id,name,campaign_id,effective_status,daily_budget,optimization_goal', limit: '200',
          })
          await gravar('meta_conjuntos', lista.map(a => ({
            adset_id: a.id, campaign_id: a.campaign_id, conta_id: conta.id, nome: a.name,
            status_efetivo: a.effective_status ?? null,
            orcamento_diario: a.daily_budget ? Number(a.daily_budget) / 100 : null,
            otimizacao: a.optimization_goal ?? null, atualizado_em: new Date().toISOString(),
          })), 'adset_id')
          cont.conjuntos += lista.length
        } else {
          const lista = await graph(`${conta.id}/ads`, {
            fields: 'id,name,adset_id,campaign_id,effective_status,creative{thumbnail_url}', limit: '100',
          })
          await gravar('meta_anuncios', lista.map(a => ({
            ad_id: a.id, adset_id: a.adset_id, campaign_id: a.campaign_id, conta_id: conta.id, nome: a.name,
            status_efetivo: a.effective_status ?? null,
            thumbnail_url: a.creative?.thumbnail_url ?? null, atualizado_em: new Date().toISOString(),
          })), 'ad_id')
          cont.anuncios += lista.length
        }

        // métricas por dia (janelas de 15 dias: nível anúncio gera muitas linhas)
        let cursor = new Date(since + 'T12:00:00Z')
        const fim = new Date(until + 'T12:00:00Z')
        while (cursor <= fim) {
          const winEnd = new Date(Math.min(cursor.getTime() + 14 * 86400000, fim.getTime()))
          const ins = await graph(`${conta.id}/insights`, {
            level: nivel,
            time_increment: '1',
            time_range: JSON.stringify({ since: fmt(cursor), until: fmt(winEnd) }),
            fields: nivel === 'adset'
              ? 'campaign_id,adset_id,adset_name,spend,impressions,reach,inline_link_clicks,actions'
              : 'campaign_id,adset_id,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions',
            limit: '500',
          })
          if (nivel === 'adset') {
            await gravar('meta_conjuntos_dia', ins.map(i => ({
              data: i.date_start, adset_id: i.adset_id, campaign_id: i.campaign_id,
              conta_id: conta.id, nome: i.adset_name, ...metricas(i),
            })), 'data,adset_id')
            cont.dias_conjunto += ins.length
          } else {
            await gravar('meta_anuncios_dia', ins.map(i => ({
              data: i.date_start, ad_id: i.ad_id, adset_id: i.adset_id, campaign_id: i.campaign_id,
              conta_id: conta.id, nome: i.ad_name, ...metricas(i),
            })), 'data,ad_id')
            cont.dias_anuncio += ins.length
          }
          cursor = new Date(winEnd.getTime() + 86400000)
        }
      } catch (e) {
        erros.push(`${conta.nome}/${nivel}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return Response.json({ ok: erros.length === 0, since, until, ...cont, erros: erros.length ? erros : undefined })
})
