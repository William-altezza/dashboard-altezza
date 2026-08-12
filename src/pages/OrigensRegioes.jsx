import { useMemo } from 'react'
import { Tile } from '../components/ui/Tile'
import { WorldMap } from '../components/charts/WorldMap'
import { useLeads, useVendas, useInvestimentos } from '../hooks/useMetrics'
import { useFilters } from '../hooks/useFilters'
import { formatBRL, formatNumber, formatPct, formatDays } from '../lib/formatters'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { theme } from '../styles/theme'
import { COMISSAO_PCT } from '../lib/constants'
import styles from './OrigensRegioes.module.css'

const ORIGENS_PAGAS = ['Instagram Leads','Facebook Leads','CTWA Facebook - Anúncios',
                       'CTWA Instagram','CTWA Postagens','Leads Turbo']

function buildOrigemStats(leads, vendas, investTotal) {
  const map = {}
  for (const l of leads) {
    const o = l.origem || 'Sem origem'
    if (!map[o]) map[o] = { origem: o, leads: 0, vendas: 0, receita: 0, tempos: [] }
    map[o].leads++
  }
  for (const v of vendas) {
    const o = v.origem || 'Sem origem'
    if (!map[o]) map[o] = { origem: o, leads: 0, vendas: 0, receita: 0, tempos: [] }
    map[o].vendas++
    map[o].receita += v.valor_venda || 0
    if (v.done_deal_at && v.data_entrada) {
      map[o].tempos.push((new Date(v.done_deal_at) - new Date(v.data_entrada)) / 86400000)
    }
  }

  const cplGeral = leads.length > 0 ? investTotal / leads.length : 0

  return Object.values(map).map(o => {
    const isPaga = ORIGENS_PAGAS.some(p => o.origem.toLowerCase().includes(p.toLowerCase()))
    const investDir = cplGeral * o.leads
    const tempoMedio = o.tempos.length > 0 ? o.tempos.reduce((a, b) => a + b, 0) / o.tempos.length : null
    return {
      ...o,
      paga: isPaga,
      taxaConv: o.leads > 0 ? o.vendas / o.leads : null,
      cpl: o.leads > 0 ? investDir / o.leads : null,
      cac: o.vendas > 0 ? investDir / o.vendas : null,
      // Comissão real da Altezza (5% da receita/VGV), não a VGV bruta
      roas: isPaga && investDir > 0 ? (o.receita * COMISSAO_PCT) / investDir : null,
      ticketMedio: o.vendas > 0 ? o.receita / o.vendas : null,
      tempoMedio,
      investDir,
    }
  }).sort((a, b) => b.receita - a.receita)
}

function buildRegiaoStats(leads, vendas, investTotal) {
  const regioes = ['Brasil','América do Norte','Europa','Outros']
  const cplGeral = leads.length > 0 ? investTotal / leads.length : 0

  return regioes.map(r => {
    const rLeads  = leads.filter(l => l.regiao === r)
    const rVendas = vendas.filter(v => v.regiao === r)
    const receita = rVendas.reduce((s, v) => s + (v.valor_venda || 0), 0)
    const investDir = cplGeral * rLeads.length

    return {
      regiao: r,
      leads: rLeads.length,
      vendas: rVendas.length,
      receita,
      taxaConv: rLeads.length > 0 ? rVendas.length / rLeads.length : null,
      cac: rVendas.length > 0 ? investDir / rVendas.length : null,
    }
  })
}

function buildCountryData(leads, vendas) {
  const map = {}
  for (const l of leads) {
    if (!l.pais_iso) continue
    if (!map[l.pais_iso]) map[l.pais_iso] = { pais_iso: l.pais_iso, leads: 0, vendas: 0, receita: 0 }
    map[l.pais_iso].leads++
  }
  for (const v of vendas) {
    if (!v.pais_iso) continue
    if (!map[v.pais_iso]) map[v.pais_iso] = { pais_iso: v.pais_iso, leads: 0, vendas: 0, receita: 0 }
    map[v.pais_iso].vendas++
    map[v.pais_iso].receita += v.valor_venda || 0
  }
  return Object.values(map).map(d => ({
    ...d,
    taxa_conv: d.leads > 0 ? d.vendas / d.leads : null,
  }))
}

export function OrigensRegioes() {
  const { leads }          = useLeads()
  const { vendas }         = useVendas()
  const { investimentos }  = useInvestimentos()
  const { addCrossFilter, crossFilters } = useFilters()

  const investTotal = investimentos.reduce((s, i) => s + (i.valor || 0), 0)

  const origemStats  = useMemo(() => buildOrigemStats(leads, vendas, investTotal), [leads, vendas, investTotal])
  const regiaoStats  = useMemo(() => buildRegiaoStats(leads, vendas, investTotal), [leads, vendas, investTotal])
  const countryData  = useMemo(() => buildCountryData(leads, vendas), [leads, vendas])

  const topOrigem = origemStats[0]

  return (
    <div className={styles.page}>
      {/* Mapa-múndi */}
      <Tile title="DISTRIBUIÇÃO GEOGRÁFICA" subtitle="bolhas por leads · cor por receita · clique para filtrar" span={3}>
        <WorldMap
          data={countryData}
          onCountryClick={iso2 => addCrossFilter('pais', iso2)}
        />
      </Tile>

      {/* Por Região */}
      <Tile title="POR REGIÃO">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Região</th>
                <th>Leads</th>
                <th>Vendas</th>
                <th>Taxa Conv.</th>
                <th>Receita</th>
                <th>CAC</th>
              </tr>
            </thead>
            <tbody>
              {regiaoStats.map((r, i) => (
                <tr
                  key={r.regiao}
                  onClick={() => addCrossFilter('regiao', r.regiao)}
                  style={{ cursor: 'pointer' }}
                  className={crossFilters.regiao === r.regiao ? styles.rowActive : ''}
                >
                  <td style={{ color: theme.chartColors[i], fontWeight: 600 }}>{r.regiao}</td>
                  <td>{formatNumber(r.leads)}</td>
                  <td>{formatNumber(r.vendas)}</td>
                  <td>{formatPct(r.taxaConv)}</td>
                  <td style={{ color: 'var(--gold)' }}>{formatBRL(r.receita, { compact: true })}</td>
                  <td>{formatBRL(r.cac, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      {/* Por Origem */}
      <Tile title="POR ORIGEM" subtitle={topOrigem ? `mais rentável: ${topOrigem.origem}` : ''} span={2}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Origem</th>
                <th>Leads</th>
                <th>Vendas</th>
                <th>Taxa Conv.</th>
                <th>CPL</th>
                <th>Receita</th>
                <th>ROAS</th>
                <th>Ticket</th>
                <th>Tempo</th>
              </tr>
            </thead>
            <tbody>
              {origemStats.map((o, i) => (
                <tr
                  key={o.origem}
                  onClick={() => addCrossFilter('origem', o.origem)}
                  style={{ cursor: 'pointer' }}
                  className={crossFilters.origem === o.origem ? styles.rowActive : ''}
                >
                  <td
                    className={styles.originName}
                    style={{
                      color: i === 0 ? 'var(--gold)' : 'var(--text-primary)',
                      fontWeight: i === 0 ? 700 : 400,
                    }}
                  >
                    {o.paga && <span className={styles.pagaBadge}>pago</span>}
                    {o.origem}
                  </td>
                  <td>{formatNumber(o.leads)}</td>
                  <td>{formatNumber(o.vendas)}</td>
                  <td>{formatPct(o.taxaConv)}</td>
                  <td>{formatBRL(o.cpl, { compact: true })}</td>
                  <td style={{ color: 'var(--gold)' }}>{formatBRL(o.receita, { compact: true })}</td>
                  <td>{o.roas != null ? `${o.roas.toFixed(1)}×` : '—'}</td>
                  <td>{formatBRL(o.ticketMedio, { compact: true })}</td>
                  <td>{formatDays(o.tempoMedio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      {/* Gráfico de barras origens */}
      <Tile title="LEADS POR ORIGEM">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={origemStats.slice(0,8)} layout="vertical" margin={{ left: 80, right: 8 }}>
            <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis dataKey="origem" type="category" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} width={80} />
            <Tooltip
              formatter={(v, name) => [formatNumber(v), 'Leads']}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11 }}
            />
            <Bar dataKey="leads" radius={[0,3,3,0]}>
              {origemStats.slice(0,8).map((_, i) => (
                <Cell key={i} fill={theme.chartColors[i % theme.chartColors.length]} style={{ cursor: 'pointer' }} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Tile>
    </div>
  )
}
