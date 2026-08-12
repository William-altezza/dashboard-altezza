import { useMemo, useState, useEffect } from 'react'
import { Tile } from '../components/ui/Tile'
import { useLeads, useVendas } from '../hooks/useMetrics'
import { supabase } from '../lib/supabase'
import { useFilters } from '../hooks/useFilters'
import { formatNumber, formatDays } from '../lib/formatters'
import { format, parseISO, startOfMonth } from 'date-fns'
import styles from './CohortCiclo.module.css'

const STAGE_LABELS = {
  new:             'Novo Lead',
  in_attendance:   'Em Atendimento',
  scheduled_visit: 'Visita Agendada',
  done_visit:      'Visita Realizada',
  created_offer:   'Proposta',
  converted:       'Fechado',
}

const STAGE_ORDER = ['new','in_attendance','scheduled_visit','done_visit','created_offer','converted']

function buildCohortMatrix(leads, vendas) {
  // Agrupa por mês de entrada × mês de fechamento
  const matrixMap = {}  // entrada_mes → fechamento_mes → count

  // Coleta todos os meses de entrada únicos
  const entradaMeses = new Set()
  const fechamentoMeses = new Set()

  for (const v of vendas) {
    if (!v.data_entrada || !v.done_deal_at) continue
    const entMes  = format(startOfMonth(parseISO(v.data_entrada)), 'yyyy-MM')
    const fechMes = format(startOfMonth(parseISO(v.done_deal_at)), 'yyyy-MM')
    entradaMeses.add(entMes)
    fechamentoMeses.add(fechMes)
    if (!matrixMap[entMes]) matrixMap[entMes] = {}
    matrixMap[entMes][fechMes] = (matrixMap[entMes][fechMes] || 0) + 1
  }

  // Também adiciona meses de entrada sem vendas
  for (const l of leads) {
    if (!l.data_entrada) continue
    const mes = format(startOfMonth(parseISO(l.data_entrada)), 'yyyy-MM')
    entradaMeses.add(mes)
  }

  const entradas  = [...entradaMeses].sort()
  const fechamentos = [...fechamentoMeses].sort()

  return { matrixMap, entradas, fechamentos }
}

function calcVelocidade(eventos) {
  const PAIRS = [
    ['new','in_attendance'],
    ['in_attendance','scheduled_visit'],
    ['scheduled_visit','done_visit'],
    ['done_visit','created_offer'],
    ['created_offer','converted'],
  ]

  const result = PAIRS.map(([from, to]) => {
    const byLead = {}
    for (const e of eventos) {
      if (!byLead[e.id_lead]) byLead[e.id_lead] = {}
      if (!byLead[e.id_lead][e.funnel_status]) {
        byLead[e.id_lead][e.funnel_status] = e.data_evento
      }
    }
    const diffs = []
    for (const lead of Object.values(byLead)) {
      if (lead[from] && lead[to]) {
        const diff = (new Date(lead[to]) - new Date(lead[from])) / 86400000
        if (diff >= 0) diffs.push(diff)
      }
    }
    const avg = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null
    return { from, to, avg, count: diffs.length }
  })

  return result
}

export function CohortCiclo() {
  const { leads }          = useLeads()
  const { vendas }         = useVendas()
  const { dateRange }      = useFilters()
  const [eventos, setEventos] = useState([])

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    supabase
      .from('lead_eventos')
      .select('id_lead, funnel_status, data_evento, corretor')
      .gte('data_evento', dateRange[0].toISOString())
      .lte('data_evento', dateRange[1].toISOString())
      .then(({ data }) => setEventos(data || []))
  }, [dateRange])

  const { matrixMap, entradas, fechamentos } = useMemo(
    () => buildCohortMatrix(leads, vendas),
    [leads, vendas]
  )

  const velocidade = useMemo(() => calcVelocidade(eventos), [eventos])

  // Maior valor para normalizar cores
  const maxCell = Math.max(
    ...entradas.flatMap(e => fechamentos.map(f => matrixMap[e]?.[f] || 0)),
    1
  )

  // Leads do período ainda em aberto (não converted e não lost)
  const emAberto = leads.filter(l => !['converted','lost'].includes(l.funnel_status_atual)).length

  return (
    <div className={styles.page}>
      {/* Matriz Cohort */}
      <Tile title="COHORT" subtitle="mês de entrada × mês de fechamento">
        <div className={styles.cohortWrap}>
          <table className={styles.cohortTable}>
            <thead>
              <tr>
                <th className={styles.cornerCell}>Entrada ↓ / Fechamento →</th>
                {fechamentos.map(f => (
                  <th key={f}>{format(parseISO(f + '-01'), 'MMM/yy')}</th>
                ))}
                <th>Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {entradas.map(entMes => {
                const totalRow = fechamentos.reduce((s, f) => s + (matrixMap[entMes]?.[f] || 0), 0)
                const entLeads = leads.filter(l =>
                  l.data_entrada && format(startOfMonth(parseISO(l.data_entrada)), 'yyyy-MM') === entMes
                )
                const entEmAberto = entLeads.filter(l => !['converted','lost'].includes(l.funnel_status_atual)).length

                return (
                  <tr key={entMes}>
                    <td className={styles.rowHeader}>{format(parseISO(entMes + '-01'), 'MMM/yy')}</td>
                    {fechamentos.map(fechMes => {
                      const val = matrixMap[entMes]?.[fechMes] || 0
                      const intensity = val / maxCell
                      return (
                        <td
                          key={fechMes}
                          className={styles.cell}
                          style={{
                            background: val > 0
                              ? `rgba(201,169,122,${0.1 + intensity * 0.7})`
                              : 'transparent',
                            color: intensity > 0.6 ? 'var(--bg-deep)' : 'var(--text-primary)',
                            fontWeight: val > 0 ? 600 : 400,
                          }}
                          title={val > 0 ? `${val} venda(s) — entrada ${entMes}, fechamento ${fechMes}` : '—'}
                        >
                          {val > 0 ? val : '·'}
                        </td>
                      )
                    })}
                    <td className={styles.openCell}>{entEmAberto > 0 ? entEmAberto : '—'}</td>
                  </tr>
                )
              })}
              <tr className={styles.totalRow}>
                <td>TOTAL</td>
                {fechamentos.map(f => {
                  const total = entradas.reduce((s, e) => s + (matrixMap[e]?.[f] || 0), 0)
                  return <td key={f} style={{ fontWeight: 700 }}>{total > 0 ? total : '—'}</td>
                })}
                <td>{emAberto}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Tile>

      {/* Velocidade entre etapas */}
      <Tile title="VELOCIDADE ENTRE ETAPAS" subtitle="tempo médio de transição em dias">
        <div className={styles.velocidades}>
          {velocidade.map((v, i) => (
            <div key={i} className={styles.velRow}>
              <div className={styles.velStages}>
                <span className={styles.velFrom}>{STAGE_LABELS[v.from]}</span>
                <span className={styles.velArrow}>→</span>
                <span className={styles.velTo}>{STAGE_LABELS[v.to]}</span>
              </div>
              <div className={styles.velValue}>
                {v.avg != null ? formatDays(v.avg) : '—'}
                {v.count > 0 && (
                  <span className={styles.velCount}>({v.count} transições)</span>
                )}
              </div>
              {v.avg != null && (
                <div className={styles.velBar}>
                  <div
                    style={{
                      width: `${Math.min((v.avg / 60) * 100, 100)}%`,
                      height: '100%',
                      background: 'var(--gold)',
                      opacity: 0.5,
                      borderRadius: 2,
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </Tile>

      {/* Mais rápido e mais lento */}
      <div className="tile-grid-2">
        <Tile title="CONVERSÃO MAIS RÁPIDA">
          {(() => {
            const fastest = vendas
              .filter(v => v.done_deal_at && v.data_entrada)
              .sort((a, b) =>
                (new Date(a.done_deal_at) - new Date(a.data_entrada)) -
                (new Date(b.done_deal_at) - new Date(b.data_entrada))
              )[0]
            if (!fastest) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Sem dados</div>
            const dias = Math.round((new Date(fastest.done_deal_at) - new Date(fastest.data_entrada)) / 86400000)
            return (
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--positive)' }}>{dias} dias</div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4 }}>{fastest.nome_cliente}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fastest.corretor}</div>
              </div>
            )
          })()}
        </Tile>

        <Tile title="CONVERSÃO MAIS DEMORADA">
          {(() => {
            const slowest = vendas
              .filter(v => v.done_deal_at && v.data_entrada)
              .sort((a, b) =>
                (new Date(b.done_deal_at) - new Date(b.data_entrada)) -
                (new Date(a.done_deal_at) - new Date(a.data_entrada))
              )[0]
            if (!slowest) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Sem dados</div>
            const dias = Math.round((new Date(slowest.done_deal_at) - new Date(slowest.data_entrada)) / 86400000)
            return (
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--warning)' }}>{dias} dias</div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4 }}>{slowest.nome_cliente}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{slowest.corretor}</div>
              </div>
            )
          })()}
        </Tile>
      </div>
    </div>
  )
}
