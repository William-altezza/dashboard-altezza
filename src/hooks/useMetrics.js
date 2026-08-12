import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useFilters } from './useFilters'

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

export function useLeads() {
  const { dateRange, corretores, origens, status, crossFilters } = useFilters()
  const [leads, setLeads]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    setLoading(true)
    setError(null)

    let q = supabase
      .from('leads')
      .select('*')
      .gte('data_entrada', spStart(dateRange[0]))
      .lte('data_entrada', spEnd(dateRange[1]))

    if (corretores.length > 0) q = q.in('corretor', corretores)
    if (origens.length > 0)    q = q.in('origem', origens)
    if (status.length > 0)     q = q.in('funnel_status_atual', status)
    if (crossFilters.corretor) q = q.eq('corretor', crossFilters.corretor)
    if (crossFilters.origem)   q = q.eq('origem', crossFilters.origem)
    if (crossFilters.regiao)   q = q.eq('regiao', crossFilters.regiao)
    if (crossFilters.pais)     q = q.eq('pais_iso', crossFilters.pais)

    q.then(({ data, error: err }) => {
      if (err) { setError(err.message); setLoading(false); return }
      setLeads(data || [])
      setLoading(false)
    })
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

    let q = supabase
      .from('leads')
      .select('*')
      .eq('funnel_status_atual', 'converted')
      .not('done_deal_at', 'is', null)
      .gte('done_deal_at', spStart(dateRange[0]))
      .lte('done_deal_at', spEnd(dateRange[1]))

    if (corretores.length > 0) q = q.in('corretor', corretores)
    if (origens.length > 0)    q = q.in('origem', origens)
    if (crossFilters.corretor) q = q.eq('corretor', crossFilters.corretor)
    if (crossFilters.origem)   q = q.eq('origem', crossFilters.origem)

    q.then(({ data, error: err }) => {
      if (err) { setError(err.message); setLoading(false); return }
      setVendas(data || [])
      setLoading(false)
    })
  }, [dateRange, corretores, origens, crossFilters])

  return { vendas, loading, error }
}

export function useInvestimentos() {
  const { dateRange } = useFilters()
  const [investimentos, setInvestimentos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return

    const sinceMonth = isoDate(new Date(dateRange[0].getFullYear(), dateRange[0].getMonth(), 1))
    const untilMonth = isoDate(new Date(dateRange[1].getFullYear(), dateRange[1].getMonth() + 1, 0))

    supabase
      .from('investimento_por_mes')
      .select('*')
      .gte('mes', sinceMonth)
      .lte('mes', untilMonth)
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
    const receitaPaga = vendas
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
      roas:         investTotal > 0 ? receitaPaga / investTotal : null,
      roi:          custoTotal > 0 ? (receita - custoTotal) / custoTotal : null,
      temCustos:    custoTotal > 0,
      ticketMedio:  totalVendas > 0 ? receita / totalVendas : null,
      taxaConversao:totalLeads > 0 ? totalVendas / totalLeads : null,
      tempoMedioConversao,
    }
  }, [leads, vendas, investimentos, custos, loading])

  return { kpis, loading, error }
}
