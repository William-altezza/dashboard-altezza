import { useState, useMemo } from 'react'
import { Tile } from '../components/ui/Tile'
import { useLeads } from '../hooks/useMetrics'
import { parseISO, getDay, getHours } from 'date-fns'
import styles from './HeatmapPage.module.css'

const DAYS   = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const HOURS  = Array.from({ length: 24 }, (_, i) => i)  // 0..23 SEMPRE em ordem cronológica
const REGIOES = ['Todas', 'Brasil', 'América do Norte', 'Europa', 'Outros']

export function HeatmapPage() {
  const { leads } = useLeads()
  const [regiao, setRegiao] = useState('Todas')

  const matrix = useMemo(() => {
    const filtered = regiao === 'Todas' ? leads : leads.filter(l => l.regiao === regiao)

    // matrix[dia][hora] = count
    const m = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const l of filtered) {
      if (!l.data_entrada) continue
      try {
        const d = parseISO(l.data_entrada)
        const dia  = getDay(d)     // 0=Dom
        const hora = getHours(d)   // BRT (já ajustado no upsert para UTC)
        m[dia][hora]++
      } catch { /* ignora */ }
    }
    return m
  }, [leads, regiao])

  const maxVal = Math.max(...matrix.flat(), 1)

  function intensity(v) {
    return v / maxVal
  }

  function cellColor(v) {
    const i = intensity(v)
    if (i === 0) return 'transparent'
    const alpha = 0.12 + i * 0.75
    return `rgba(201,169,122,${alpha.toFixed(2)})`
  }

  return (
    <div className={styles.page}>
      <Tile title="HEATMAP DE CADASTROS" subtitle="dia da semana × hora (horário de Brasília)">
        <div className={styles.filters}>
          {REGIOES.map(r => (
            <button
              key={r}
              className={`${styles.regionBtn} ${regiao === r ? styles.active : ''}`}
              onClick={() => setRegiao(r)}
            >
              {r}
            </button>
          ))}
        </div>

        <div className={styles.heatmapWrap}>
          <table className={styles.heatmap}>
            <thead>
              <tr>
                <th className={styles.cornerCell}></th>
                {HOURS.map(h => (
                  <th key={h} className={styles.hourCell}>
                    {h === 0 ? '0h' : h % 4 === 0 ? `${h}h` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, di) => (
                <tr key={day}>
                  <td className={styles.dayLabel}>{day}</td>
                  {HOURS.map(h => {
                    const v = matrix[di][h]
                    return (
                      <td
                        key={h}
                        className={styles.cell}
                        style={{ background: cellColor(v) }}
                        title={`${day} ${h}h: ${v} leads`}
                      >
                        {v > 0 && intensity(v) > 0.5 && (
                          <span className={styles.cellVal}>{v}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.legend}>
          <span className={styles.legendLabel}>Menos</span>
          {[0.1, 0.3, 0.5, 0.7, 0.9].map(i => (
            <div
              key={i}
              className={styles.legendCell}
              style={{ background: `rgba(201,169,122,${0.12 + i * 0.75})` }}
            />
          ))}
          <span className={styles.legendLabel}>Mais</span>
        </div>
      </Tile>
    </div>
  )
}
