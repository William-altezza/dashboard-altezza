import { useMemo } from 'react'
import { Tile } from '../components/ui/Tile'
import { useLeads, useVendas, useInvestimentos } from '../hooks/useMetrics'
import { useFilters } from '../hooks/useFilters'
import { formatBRL, formatNumber, formatPct, formatDays } from '../lib/formatters'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { theme } from '../styles/theme'
import { FunnelChart } from '../components/charts/FunnelChart'
import { effectiveStage } from '../lib/funnel'
import styles from './Corretores.module.css'

const FUNNEL_STAGES = ['new','in_attendance','potencial','scheduled_visit','done_visit','created_offer','converted','lost']

function calcCorretorStats(corretor, leads, vendas, cplGeral) {
  const myLeads  = leads.filter(l => l.corretor === corretor)
  const myVendas = vendas.filter(v => v.corretor === corretor)
  const receita  = myVendas.reduce((s, v) => s + (v.valor_venda || 0), 0)
  const tempos   = myVendas
    .filter(v => v.done_deal_at && v.data_entrada)
    .map(v => (new Date(v.done_deal_at) - new Date(v.data_entrada)) / 86400000)
  const tempoMedio = tempos.length > 0 ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null
  const investDir  = (cplGeral || 0) * myLeads.length
  const pipeline   = myLeads.filter(l => !['converted','lost'].includes(l.funnel_status_atual))
    .reduce((s, l) => s + (l.valor_potencial || 0), 0)

  const porEtapa = {}
  for (const s of FUNNEL_STAGES) porEtapa[s] = 0
  for (const l of myLeads) {
    const stage = l.funnel_status_atual === 'lost' ? 'lost' : effectiveStage(l)
    if (porEtapa[stage] !== undefined) porEtapa[stage]++
  }

  return {
    corretor,
    leads:     myLeads.length,
    vendas:    myVendas.length,
    receita,
    investDir,
    cpl:       myLeads.length > 0 ? investDir / myLeads.length : null,
    cac:       myVendas.length > 0 ? investDir / myVendas.length : null,
    taxaConv:  myLeads.length > 0 ? myVendas.length / myLeads.length : null,
    ticketMedio: myVendas.length > 0 ? receita / myVendas.length : null,
    tempoMedio,
    pipeline,
    porEtapa,
    myLeads,
  }
}

export function Corretores() {
  const { leads }               = useLeads()
  const { vendas }              = useVendas()
  const { investimentos }       = useInvestimentos()
  const { addCrossFilter, crossFilters } = useFilters()

  const investTotal = investimentos.reduce((s, i) => s + (i.valor || 0), 0)
  const cplGeral    = leads.length > 0 ? investTotal / leads.length : 0

  const stats = useMemo(() => {
    const corretoresSet = new Set([
      ...leads.map(l => l.corretor || 'Sem atribuição'),
      ...vendas.map(v => v.corretor || 'Sem atribuição'),
    ])
    return [...corretoresSet].map(c =>
      calcCorretorStats(c === 'Sem atribuição' ? null : c, leads, vendas, cplGeral)
    ).sort((a, b) => b.receita - a.receita)
  }, [leads, vendas, cplGeral])

  const selected = crossFilters.corretor

  const chartData = stats.map(s => ({
    name: (s.corretor || 'Sem atribuição').split(' ')[0], // primeiro nome
    fullName: s.corretor || 'Sem atribuição',
    receita: s.receita,
    leads: s.leads,
    vendas: s.vendas,
  }))

  return (
    <div className={styles.page}>
      {/* Gráfico comparativo */}
      <Tile title="RECEITA POR CORRETOR" subtitle="clique para filtrar">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => formatBRL(v, { compact: true })} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              formatter={(v, name, props) => [
                formatBRL(v),
                `Receita — ${props.payload.fullName}`,
              ]}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11 }}
            />
            <Bar dataKey="receita" radius={[3,3,0,0]} onClick={d => addCrossFilter('corretor', d.fullName)}>
              {chartData.map((_, i) => (
                <Cell
                  key={i}
                  fill={theme.chartColors[i % theme.chartColors.length]}
                  opacity={selected && chartData[i].fullName !== selected ? 0.35 : 1}
                  style={{ cursor: 'pointer' }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Tile>

      {/* Tabela comparativa */}
      <Tile title="COMPARATIVO DE CORRETORES">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Corretor</th>
                <th>Leads</th>
                <th>Vendas</th>
                <th>Taxa Conv.</th>
                <th>Receita</th>
                <th>Ticket Médio</th>
                <th>CAC</th>
                <th>Tempo Médio</th>
                <th>Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr
                  key={s.corretor || 'sem'}
                  className={selected === s.corretor ? styles.rowActive : ''}
                  onClick={() => addCrossFilter('corretor', s.corretor)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className={styles.corretorName} style={{ color: theme.chartColors[i % theme.chartColors.length] }}>
                    {s.corretor || 'Sem atribuição'}
                  </td>
                  <td>{formatNumber(s.leads)}</td>
                  <td style={{ fontWeight: 600 }}>{formatNumber(s.vendas)}</td>
                  <td>{formatPct(s.taxaConv)}</td>
                  <td style={{ color: 'var(--gold)' }}>{formatBRL(s.receita, { compact: true })}</td>
                  <td>{formatBRL(s.ticketMedio, { compact: true })}</td>
                  <td>{formatBRL(s.cac, { compact: true })}</td>
                  <td>{formatDays(s.tempoMedio)}</td>
                  <td>{formatBRL(s.pipeline, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={styles.totalRow}>
                <td>TOTAL</td>
                <td>{formatNumber(leads.length)}</td>
                <td>{formatNumber(vendas.length)}</td>
                <td>{leads.length > 0 ? formatPct(vendas.length / leads.length) : '—'}</td>
                <td>{formatBRL(vendas.reduce((s, v) => s + (v.valor_venda || 0), 0), { compact: true })}</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Tile>

      {/* Cards individuais com funil */}
      <div className="tile-grid-3">
        {stats.filter(s => s.leads > 0).map((s, i) => (
          <Tile
            key={s.corretor || 'sem'}
            title={s.corretor || 'SEM ATRIBUIÇÃO'}
            subtitle={`${formatNumber(s.leads)} leads · ${formatNumber(s.vendas)} vendas`}
            onClick={() => addCrossFilter('corretor', s.corretor)}
          >
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: theme.chartColors[i % theme.chartColors.length] }}>
                  {formatBRL(s.receita, { compact: true })}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>receita</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formatPct(s.taxaConv)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>conversão</div>
              </div>
            </div>
            <FunnelChart leads={s.myLeads} />
          </Tile>
        ))}
      </div>
    </div>
  )
}
