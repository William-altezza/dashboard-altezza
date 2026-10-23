/**
 * meta-acao — pausa/ativa campanhas, conjuntos e anúncios e altera orçamento
 * diário no Meta, a partir do dashboard.
 *
 * Segurança:
 *  - só usuários com perfis.role = 'admin' (JWT validado aqui);
 *  - orçamento: aumento máximo de +50% por alteração, mínimo R$ 5;
 *  - toda tentativa (ok ou erro) é registrada em meta_acoes_log.
 *
 * Body: { tipo: 'campanha'|'conjunto'|'anuncio', id, acao: 'pausar'|'ativar'|'orcamento', valor? }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const META_TOKEN = Deno.env.get('META_ACCESS_TOKEN')!
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)
const V = 'v21.0'
const AUMENTO_MAX = 0.5   // +50% por alteração
const ORCAMENTO_MIN = 5   // R$

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const resp = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const TABELAS: Record<string, { tabela: string; pk: string }> = {
  campanha: { tabela: 'meta_campanhas', pk: 'campaign_id' },
  conjunto: { tabela: 'meta_conjuntos', pk: 'adset_id' },
  anuncio:  { tabela: 'meta_anuncios',  pk: 'ad_id' },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return resp({ ok: false, erro: 'Use POST' }, 405)

  // 1) quem está chamando?
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const { data: u } = await supabase.auth.getUser(jwt)
  const user = u?.user
  if (!user) return resp({ ok: false, erro: 'Não autenticado' }, 401)
  const { data: perfil } = await supabase.from('perfis').select('role').eq('id', user.id).single()
  if (perfil?.role !== 'admin') return resp({ ok: false, erro: 'Apenas administradores podem alterar campanhas' }, 403)

  // 2) validação do pedido
  // deno-lint-ignore no-explicit-any
  let body: any
  try { body = await req.json() } catch { return resp({ ok: false, erro: 'JSON inválido' }, 400) }
  const { tipo, id, acao, valor } = body || {}
  const alvo = TABELAS[tipo]
  if (!alvo || !/^\d+$/.test(String(id)) || !['pausar', 'ativar', 'orcamento'].includes(acao)) {
    return resp({ ok: false, erro: 'Pedido inválido' }, 400)
  }

  let nome = ''
  let antes = ''
  let depois = ''
  const log = async (ok: boolean, erro?: string) => {
    await supabase.from('meta_acoes_log').insert({
      usuario: user.email, tipo, alvo_id: String(id), alvo_nome: nome, acao, antes, depois, ok, erro: erro ?? null,
    })
  }
  const falha = async (msg: string, status = 400) => { await log(false, msg); return resp({ ok: false, erro: msg }, status) }

  try {
    // 3) estado atual no Meta (fonte da verdade, não o espelho)
    const g = new URL(`https://graph.facebook.com/${V}/${id}`)
    g.searchParams.set('fields', 'name,status,effective_status,daily_budget')
    g.searchParams.set('access_token', META_TOKEN)
    const atual = await (await fetch(g.toString())).json()
    if (atual.error) return await falha(`Meta: ${atual.error.message}`)
    nome = atual.name || ''

    // deno-lint-ignore no-explicit-any
    const params: Record<string, string> = {}
    const espelho: Record<string, unknown> = {}

    if (acao === 'pausar') {
      if (atual.status !== 'ACTIVE') return await falha(`Já não está ativa (status: ${atual.status})`)
      antes = 'ACTIVE'; depois = 'PAUSED'
      params.status = 'PAUSED'; espelho.status_efetivo = 'PAUSED'
    } else if (acao === 'ativar') {
      if (atual.status !== 'PAUSED') return await falha(`Só dá para ativar item pausado (status: ${atual.status})`)
      antes = 'PAUSED'; depois = 'ACTIVE'
      params.status = 'ACTIVE'; espelho.status_efetivo = 'ACTIVE'
    } else {
      if (tipo === 'anuncio') return await falha('Anúncio não tem orçamento próprio')
      const atualReais = atual.daily_budget ? Number(atual.daily_budget) / 100 : 0
      if (!atualReais) return await falha('Este item não tem orçamento diário (o orçamento está em outro nível ou é vitalício)')
      const novo = Number(valor)
      if (!isFinite(novo) || novo < ORCAMENTO_MIN) return await falha(`Orçamento mínimo: R$ ${ORCAMENTO_MIN}`)
      if (novo > atualReais * (1 + AUMENTO_MAX)) {
        return await falha(`Aumento acima de ${AUMENTO_MAX * 100}% de uma vez bloqueado (atual R$ ${atualReais.toFixed(2)}, máximo R$ ${(atualReais * (1 + AUMENTO_MAX)).toFixed(2)}). Faça em etapas.`)
      }
      antes = atualReais.toFixed(2); depois = novo.toFixed(2)
      params.daily_budget = String(Math.round(novo * 100)); espelho.orcamento_diario = novo
    }

    // 4) aplica no Meta
    const r = await fetch(`https://graph.facebook.com/${V}/${id}`, {
      method: 'POST',
      body: new URLSearchParams({ ...params, access_token: META_TOKEN }),
    })
    const j = await r.json()
    if (!r.ok || j.error) {
      const m = j.error?.error_user_msg || j.error?.message || 'erro desconhecido'
      const dica = /permission|ads_management|\(#200\)|#10\b/i.test(m)
        ? ' — o token do Meta não tem permissão de edição (ads_management).' : ''
      return await falha(`Meta recusou: ${m}${dica}`, 502)
    }

    // 5) atualiza o espelho local e registra
    await supabase.from(alvo.tabela).update(espelho).eq(alvo.pk, String(id))
    await log(true)
    return resp({ ok: true, nome, antes, depois })
  } catch (e) {
    return await falha(e instanceof Error ? e.message : String(e), 500)
  }
})
