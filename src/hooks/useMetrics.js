import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useFilters } from './useFilters'
import { COMISSAO_PCT } from '../lib/constants'
import { isIndicacao } from '../lib/funnel'

// Brazil is always UTC-3 (no DST since 2019).
// Using timezone-aware timestamps ensures Postgres compares correctly
// against the timestamptz data_entrada column.
function spStart(d) {
  if (!d) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}T00:00:00-03:00`
}

function spEnd(d) {
  if (!d) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}T23:59:59-03:00`
}

// Month-boundary as ISO date string (date column, no TZ needed)
function isoDate(d) {
  if (!d) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Todas as colunas de `leads` menos `raw` (jsonb grande, nao usado no front).
const LEAD_COLS = [
  'id_lead', 'data_entrada', 'origem', 'canal', 'nome_cliente', 'telefone',
  'pais_iso', 'regiao', 'corretor', 'status_atual', 'funnel_status_atual',
  'tags', 'valor_potencial', 'done_deal_at', 'valor_venda', 'arquivado',
  'motivo_arquivamento', 'foi_recuperado', 'data_recuperacao', 'empreendimento',
  'created_at_c2s', 'updated_at_c2s', 'synced_at', 'tag_potencial_em', 'arquivado_por', 'ultima_atividade_em',
].join(',')

const PAGE_SIZE = 1000

// O PostgREST corta QUALQUER consulta em 1.000 linhas (limite "Max rows" do
// projeto Supabase). Sem paginacao, periodos longos (12 meses, este ano)
// devolviam so os 1.000 primeiros leads e todas as metricas calculadas no
// front saiam erradas: leads totais, funil, etiqueta Potencial, CPL e taxa
// de conversao. Agora buscamos pagina a pagina ate acabar.
async function fetchAllPages(buildQuery) {
  const all = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) return { data: null, error }
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return { data: all, error: null }
}

export function useLeads() {
  const { dateRange, corretores, origens, status, crossFilters } = useFilters()
  const [leads, setLeads]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    setLoading(true)
    setError(null)
    let cancelled = false

    // Precisa ser uma funcao: cada pagina exige um query builder novo.
    const buildQuery = () => {
      let q = supabase
        .from('leads')
        .select(LEAD_COLS)
        .gte('data_entrada', spStart(dateRange[0]))
        .lte('data_entrada', spEnd(dateRange[1]))
        .order('data_entrada', { ascending: false })
        .order('id_lead', { ascending: true })

      if (corretores.length > 0) q = q.in('corretor', corretores)
      if (origens.length > 0)    q = q.in('origem', origens)
      if (status.length > 0)     q = q.in('funnel_status_atual', status)
      if (crossFilters.corretor) q = q.eq('corretor', crossFilters.corretor)
      if (crossFilters.origem)   q = q.eq('origem', crossFilters.origem)
      if (crossFilters.regiao)   q = q.eq('regiao', crossFilters.regiao)
      if (crossFilters.pais)     q = q.eq('pais_iso', crossFilters.pais)
      if (crossFilters.status) {
        // "potencial" nao e um funnel_status_atual real - e a etapa
        // visual (Em Atendimento + etiqueta "Potencial" do C2S).
        if (crossFilters.status === 'potencial') {
          q = q.eq('funnel_status_atual', 'in_attendance').contains('tags', ['Potencial'])
        } else {
          q = q.eq('funnel_status_atual', crossFilters.status)
        }
      }
      return q
    }

    fetchAllPages(buildQuery).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setLeads(data || [])
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [dateRange, corretores, origens, status, crossFilters])

  return { leads, loading, error }
}

export function useVendas() {
  const { dateRange, corretores, origens, crossFilters } = useFilters()
  const [vendas, setVendas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    setLoading(true)
    let cancelled = false

    const buildQuery = () => {
      let q = supabase
        .from('leads')
        .select(LEAD_COLS)
        .eq('funnel_status_atual', 'converted')
        .not('done_deal_at', 'is', null)
        .gte('done_deal_at', spStart(dateRange[0]))
        .lte('done_deal_at', spEnd(dateRange[1]))
        .order('done_deal_at', { ascending: false })
        .order('id_lead', { ascending: true })

      if (corretores.length > 0) q = q.in('corretor', corretores)
      if (origens.length > 0)    q = q.in('origem', origens)
      if (crossFilters.corretor) q = q.eq('corretor', crossFilters.corretor)
      if (crossFilters.origem)   q = q.eq('origem', crossFilters.origem)
      return q
    }

    fetchAllPages(buildQuery).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setVendas(data || [])
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [dateRange, corretores, origens, crossFilters])

  return { vendas, loading, error }
}

// Leads que RECEBERAM a etiqueta "Potencial" dentro do periodo selecionado.
// Diferente de useLeads (que filtra por data de entrada): aqui o que importa e
// a data em que o corretor marcou a etiqueta no C2S. E a leitura "o que
// aconteceu neste periodo" aplicada a etiqueta.
export function usePotenciaisMarcados() {
  const { dateRange, corretores, origens, crossFilters } = useFilters()
  const [potenciais, setPotenciais] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    setLoading(true)
    let cancelled = false

    const buildQuery = () => {
      let q = supabase
        .from('leads')
        .select(LEAD_COLS)
        .not('tag_potencial_em', 'is', null)
        .gte('tag_potencial_em', spStart(dateRange[0]))
        .lte('tag_potencial_em', spEnd(dateRange[1]))
        .order('tag_potencial_em', { ascending: false })
        .order('id_lead', { ascending: true })

      if (corretores.length > 0) q = q.in('corretor', corretores)
      if (origens.length > 0)    q = q.in('origem', origens)
      if (crossFilters.corretor) q = q.eq('corretor', crossFilters.corretor)
      if (crossFilters.origem)   q = q.eq('origem', crossFilters.origem)
      return q
    }

    fetchAllPages(buildQuery).then(({ data }) => {
      if (cancelled) return
      setPotenciais(data || [])
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [dateRange, corretores, origens, crossFilters])

  return { potenciais, loading }
}

export function useInvestimentos() {
  const { dateRange } = useFilters()
  const [investimentos, setInvestimentos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return

    // Usa o intervalo de datas EXATO selecionado (não expande para o mês
    // inteiro) — a view investimento_por_dia tem granularidade diária,
    // então filtrar 1 dia específico retorna só o gasto daquele dia.
    const since = isoDate(dateRange[0])
    const until = isoDate(dateRange[1])

    supabase
      .from('investimento_por_dia')
      .select('*')
      .gte('dia', since)
      .lte('dia', until)
      .then(({ data }) => {
        setInvestimentos(data || [])
        setLoading(false)
      })
  }, [dateRange])

  return { investimentos, loading }
}

export function useCustos() {
  const { dateRange } = useFilters()
  const [custos, setCustos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return

    const sinceMonth = isoDate(new Date(dateRange[0].getFullYear(), dateRange[0].getMonth(), 1))
    const untilMonth = isoDate(new Date(dateRange[1].getFullYear(), dateRange[1].getMonth() + 1, 0))

    supabase
      .from('custos')
      .select('*')
      .gte('mes', sinceMonth)
      .lte('mes', untilMonth)
      .then(({ data }) => {
        setCustos(data || [])
        setLoading(false)
      })
  }, [dateRange])

  return { custos, loading }
}

export function useMetas() {
  const [metas, setMetas] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('metas').select('*').then(({ data }) => {
      const map = {}
      for (const row of (data || [])) map[row.chave] = row.valor
      setMetas(map)
      setLoading(false)
    })
  }, [])

  return { metas, loading }
}

// O C2S arquiva o lead sozinho depois de PRAZO_ARQUIVAMENTO dias sem nenhuma
// atividade registrada — e não avisa antes. Este hook lista quem está perto do
// prazo, para dar tempo de agir. Não depende do filtro de período: é a situação
// de agora, do pipeline inteiro.
export const PRAZO_ARQUIVAMENTO = 15
const JANELA_ALERTA = 7  // avisa quando faltam 7 dias ou menos

export function useLeadsEmRisco() {
  const [emRisco, setEmRisco] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const limite = new Date()
    limite.setDate(limite.getDate() - (PRAZO_ARQUIVAMENTO - JANELA_ALERTA))

    const buildQuery = () => supabase
      .from('leads')
      .select(LEAD_COLS)
      .eq('arquivado', false)
      .in('funnel_status_atual', ['new', 'in_attendance', 'scheduled_visit', 'done_visit', 'created_offer'])
      .not('ultima_atividade_em', 'is', null)
      .lte('ultima_atividade_em', limite.toISOString())
      .order('ultima_atividade_em', { ascending: true })
      .order('id_lead', { ascending: true })

    fetchAllPages(buildQuery).then(({ data }) => {
      if (cancelled) return
      const hoje = new Date()
      const comPrazo = (data || []).map(l => {
        const dias = Math.floor((hoje - new Date(l.ultima_atividade_em)) / 86400000)
        return { ...l, diasSemAtividade: dias, diasRestantes: PRAZO_ARQUIVAMENTO - dias }
      // Leads muito antigos já passaram do prazo e sobrevivem por exceção
      // (visita agendada, reabertura manual) — não adianta alertar sobre eles.
      }).filter(l => l.diasRestantes >= 0)
      setEmRisco(comPrazo)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  return { emRisco, loading }
}

// Métricas derivadas calculadas no front
export function useKPIs() {
  const { leads, loading: lLoading, error: lErr } = useLeads()
  const { vendas, loading: vLoading }              = useVendas()
  const { investimentos, loading: iLoading }       = useInvestimentos()
  const { custos, loading: cLoading }              = useCustos()

  const loading = lLoading || vLoading || iLoading || cLoading
  const error   = lErr

  const kpis = useMemo(() => {
    if (loading) return null

    const totalLeads  = leads.length
    const totalVendas = vendas.length
    const receita     = vendas.reduce((s, v) => s + (v.valor_venda || 0), 0)

    const investTotal = investimentos.reduce((s, i) => s + (i.valor || 0), 0)

    const ORIGENS_PAGAS = ['Instagram Leads','Facebook Leads','CTWA Facebook - Anúncios',
                           'CTWA Instagram','CTWA Postagens','Leads Turbo']
    // Indicação não é fruto do anúncio, mesmo quando a origem no C2S diz
    // "Instagram Leads" — fica fora do ROAS.
    const receitaPaga = vendas
      .filter(v => !isIndicacao(v))
      .filter(v => ORIGENS_PAGAS.some(o => (v.origem || '').toLowerCase().includes(o.toLowerCase())))
      .reduce((s, v) => s + (v.valor_venda || 0), 0)

    const custoTotal = custos.reduce((s, c) => s + (c.valor || 0), 0) + investTotal

    const temposMedio = vendas
      .filter(v => v.done_deal_at && v.data_entrada)
      .map(v => (new Date(v.done_deal_at) - new Date(v.data_entrada)) / 86400000)

    const tempoMedioConversao = temposMedio.length > 0
      ? temposMedio.reduce((a, b) => a + b, 0) / temposMedio.length
      : null

    return {
      totalLeads,
      totalVendas,
      receita,
      investimento: investTotal,
      cpl:          totalLeads > 0 ? investTotal / totalLeads : null,
      cac:          totalVendas > 0 ? investTotal / totalVendas : null,
      // ROAS calculado sobre a comissão real da Altezza (5% da VGV), não a VGV bruta —
      // reflete o retorno real em dinheiro que entra pra empresa por real investido em ads.
      roas:         investTotal > 0 ? (receitaPaga * COMISSAO_PCT) / investTotal : null,
      roi:          custoTotal > 0 ? (receita - custoTotal) / custoTotal : null,
      // Só considera "com custos" quando há custos reais da empresa cadastrados no
      // Admin (aluguel, salários etc) — investimento em ads sozinho não conta,
      // senão o ROI fica distorcido (custoTotal nunca seria zero).
      temCustos:    custos.length > 0,
      ticketMedio:  totalVendas > 0 ? receita / totalVendas : null,
      taxaConversao:totalLeads > 0 ? totalVendas / totalLeads : null,
      tempoMedioConversao,
    }
  }, [leads, vendas, investimentos, custos, loading])

  return { kpis, loading, error }
}
