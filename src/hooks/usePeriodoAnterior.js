import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useFilters } from './useFilters'
import { COMISSAO_PCT } from '../lib/constants'
import { isIndicacao } from '../lib/funnel'

const ORIGENS_PAGAS = ['Instagram Leads', 'Facebook Leads', 'CTWA Facebook - Anúncios',
                       'CTWA Instagram', 'CTWA Postagens', 'Leads Turbo']

const DAY = 86400000

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const ini = d => `${iso(d)}T00:00:00-03:00`
const fim = d => `${iso(d)}T23:59:59-03:00`

// Período imediatamente anterior, com o mesmo número de dias.
export function periodoAnterior(dateRange) {
  const [a, b] = dateRange
  const dias = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
                           new Date(a.getFullYear(), a.getMonth(), a.getDate())) / DAY) + 1
  const fimAnt = new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1)
  const iniAnt = new Date(fimAnt.getFullYear(), fimAnt.getMonth(), fimAnt.getDate() - (dias - 1))
  return [iniAnt, fimAnt]
}

// Variação para o KPICard. `inverso`: quando subir é ruim (CPL, CAC, tempo).
export function variacao(atual, anterior, { inverso = false } = {}) {
  if (atual == null || anterior == null || anterior === 0) return null
  const pct = (atual - anterior) / Math.abs(anterior)
  if (Math.abs(pct) < 0.005) return { label: '= período anterior', positive: true }
  const sobe = pct > 0
  return {
    label: `${sobe ? '▲' : '▼'} ${Math.abs(pct * 100).toFixed(0)}% vs período anterior`,
    positive: inverso ? !sobe : sobe,
  }
}

async function paginar(build) {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) return []
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}

// KPIs do período anterior (mesmos filtros de corretor/origem do atual).
export function useKPIsAnterior() {
  const { dateRange, corretores, origens, crossFilters } = useFilters()
  const [ant, setAnt] = useState(null)

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    let cancelled = false
    const [a, b] = periodoAnterior(dateRange)

    const filtra = q => {
      if (corretores.length > 0) q = q.in('corretor', corretores)
      if (origens.length > 0)    q = q.in('origem', origens)
      if (crossFilters.corretor) q = q.eq('corretor', crossFilters.corretor)
      if (crossFilters.origem)   q = q.eq('origem', crossFilters.origem)
      return q
    }

    ;(async () => {
      const leadsQ = filtra(supabase.from('leads').select('id_lead', { count: 'exact', head: true })
        .gte('data_entrada', ini(a)).lte('data_entrada', fim(b)))
      const vendas = await paginar(() => filtra(
        supabase.from('leads')
          .select('id_lead,origem,tags,valor_venda,done_deal_at,data_entrada')
          .eq('funnel_status_atual', 'converted')
          .gte('done_deal_at', ini(a)).lte('done_deal_at', fim(b))
          .order('id_lead')))
      const inv = await supabase.from('investimento_por_dia').select('valor')
        .gte('dia', iso(a)).lte('dia', iso(b))
      const { count } = await leadsQ
      if (cancelled) return

      const totalLeads  = count || 0
      const totalVendas = vendas.length
      const receita     = vendas.reduce((s, v) => s + (v.valor_venda || 0), 0)
      const investimento = (inv.data || []).reduce((s, i) => s + (Number(i.valor) || 0), 0)
      const receitaPaga = vendas
        .filter(v => !isIndicacao(v))
        .filter(v => ORIGENS_PAGAS.some(o => (v.origem || '').toLowerCase().includes(o.toLowerCase())))
        .reduce((s, v) => s + (v.valor_venda || 0), 0)
      const tempos = vendas.filter(v => v.done_deal_at && v.data_entrada)
        .map(v => (new Date(v.done_deal_at) - new Date(v.data_entrada)) / DAY)

      setAnt({
        totalLeads, totalVendas, receita, investimento,
        cpl: totalLeads > 0 ? investimento / totalLeads : null,
        cac: totalVendas > 0 ? investimento / totalVendas : null,
        roas: investimento > 0 ? (receitaPaga * COMISSAO_PCT) / investimento : null,
        ticketMedio: totalVendas > 0 ? receita / totalVendas : null,
        tempoMedioConversao: tempos.length ? tempos.reduce((x, y) => x + y, 0) / tempos.length : null,
      })
    })()

    return () => { cancelled = true }
  }, [dateRange, corretores, origens, crossFilters])

  return ant
}
