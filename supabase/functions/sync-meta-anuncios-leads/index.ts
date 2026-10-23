/**
 * sync-meta-anuncios-leads
 * Descobre no Meta os anúncios (e seus conjuntos/campanhas) que geraram leads
 * no C2S mas ainda não estão espelhados — anúncios antigos, arquivados ou de
 * outras contas. Roda em lotes: cada execução resolve até ?max=150 anúncios.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const META_TOKEN = Deno.env.get('META_ACCESS_TOKEN')!
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)
const V = 'v21.0'

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>

async function buscarLote(ids: string[], fields: string): Promise<Obj> {
  const u = new URL(`https://graph.facebook.com/${V}/`)
  u.searchParams.set('ids', ids.join(','))
  u.searchParams.set('fields', fields)
  u.searchParams.set('access_token', META_TOKEN)
  const r = await fetch(u.toString())
  if (r.ok) return await r.json()
  // Um id sem acesso derruba o lote inteiro: tenta um a um.
  const out: Obj = {}
  for (const id of ids) {
    const u1 = new URL(`https://graph.facebook.com/${V}/${id}`)
    u1.searchParams.set('fields', fields)
    u1.searchParams.set('access_token', META_TOKEN)
    const r1 = await fetch(u1.toString())
    if (r1.ok) out[id] = await r1.json()
  }
  return out
}

const pedacos = <T,>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

Deno.serve(async (req) => {
  const max = Number(new URL(req.url).searchParams.get('max') || 150)

  // anúncios citados por leads e ainda não espelhados
  const { data: faltam, error } = await supabase.rpc('anuncios_de_leads_faltando', { limite: max })
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 })
  const ids: string[] = (faltam || []).map((x: { ad_id: string }) => x.ad_id)
  if (!ids.length) return Response.json({ ok: true, restantes: 0, resolvidos: 0 })

  const agora = new Date().toISOString()
  const ads: Obj[] = []
  for (const lote of pedacos(ids, 50)) {
    const res = await buscarLote(lote, 'id,name,adset_id,campaign_id,account_id,effective_status,creative{thumbnail_url}')
    for (const id of lote) {
      const a = res[id]
      ads.push(a
        ? {
          ad_id: a.id, adset_id: a.adset_id, campaign_id: a.campaign_id,
          conta_id: `act_${a.account_id}`, nome: a.name, status_efetivo: a.effective_status ?? null,
          thumbnail_url: a.creative?.thumbnail_url ?? null, atualizado_em: agora,
        }
        // não achou (removido / sem acesso): grava marcador para não tentar de novo
        : {
          ad_id: id, adset_id: null, campaign_id: 'desconhecida', conta_id: 'desconhecida',
          nome: '(anúncio removido ou sem acesso)', status_efetivo: null, thumbnail_url: null, atualizado_em: agora,
        })
    }
  }
  const { error: e1 } = await supabase.from('meta_anuncios').upsert(ads, { onConflict: 'ad_id' })
  if (e1) return Response.json({ ok: false, erro: e1.message }, { status: 500 })

  // conjuntos e campanhas desses anúncios que ainda não conhecemos
  const adsetIds = [...new Set(ads.map(a => a.adset_id).filter(Boolean))] as string[]
  const campIds = [...new Set(ads.map(a => a.campaign_id).filter((c: string) => c && c !== 'desconhecida'))] as string[]

  const { data: adsetsJa } = await supabase.from('meta_conjuntos').select('adset_id').in('adset_id', adsetIds)
  const { data: campsJa } = await supabase.from('meta_campanhas').select('campaign_id').in('campaign_id', campIds)
  const novosAdsets = adsetIds.filter(i => !(adsetsJa || []).some(x => x.adset_id === i))
  const novasCamps = campIds.filter(i => !(campsJa || []).some(x => x.campaign_id === i))

  const adsetRows: Obj[] = []
  for (const lote of pedacos(novosAdsets, 50)) {
    const res = await buscarLote(lote, 'id,name,campaign_id,account_id,effective_status,daily_budget,optimization_goal')
    for (const a of Object.values(res) as Obj[]) {
      adsetRows.push({
        adset_id: a.id, campaign_id: a.campaign_id, conta_id: `act_${a.account_id}`, nome: a.name,
        status_efetivo: a.effective_status ?? null,
        orcamento_diario: a.daily_budget ? Number(a.daily_budget) / 100 : null,
        otimizacao: a.optimization_goal ?? null, atualizado_em: agora,
      })
    }
  }
  if (adsetRows.length) await supabase.from('meta_conjuntos').upsert(adsetRows, { onConflict: 'adset_id' })

  const campRows: Obj[] = []
  for (const lote of pedacos(novasCamps, 50)) {
    const res = await buscarLote(lote, 'id,name,account_id,status,effective_status,objective,daily_budget,lifetime_budget')
    for (const c of Object.values(res) as Obj[]) {
      campRows.push({
        campaign_id: c.id, conta_id: `act_${c.account_id}`, nome: c.name, objetivo: c.objective ?? null,
        status: c.status ?? null, status_efetivo: c.effective_status ?? null,
        orcamento_diario: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        orcamento_total: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null, atualizado_em: agora,
      })
    }
  }
  if (campRows.length) await supabase.from('meta_campanhas').upsert(campRows, { onConflict: 'campaign_id' })

  const { data: resta } = await supabase.rpc('anuncios_de_leads_faltando', { limite: 100000 })
  return Response.json({
    ok: true, resolvidos: ads.filter(a => a.campaign_id !== 'desconhecida').length,
    sem_acesso: ads.filter(a => a.campaign_id === 'desconhecida').length,
    conjuntos_novos: adsetRows.length, campanhas_novas: campRows.length, restantes: (resta || []).length,
  })
})
