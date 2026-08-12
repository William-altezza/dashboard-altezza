import { theme } from '../../styles/theme'

const FUNNEL_STAGES = [
  { key: 'new',             label: 'Novo Lead' },
  { key: 'in_attendance',   label: 'Em Atendimento' },
  { key: 'scheduled_visit', label: 'Visita Agendada' },
  { key: 'done_visit',      label: 'Visita Realizada' },
  { key: 'created_offer',   label: 'Proposta' },
  { key: 'converted',       label: 'Fechado' },
]

export function FunnelChart({ leads, onStageClick }) {
  if (!leads || leads.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Sem dados</div>

  const counts = {}
  for (const stage of FUNNEL_STAGES) {
    counts[stage.key] = leads.filter(l => l.funnel_status_atual === stage.key).length
  }

  const maxCount = Math.max(...Object.values(counts), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {FUNNEL_STAGES.map((stage, i) => {
        const count = counts[stage.key] || 0
        const pct   = (count / maxCount) * 100
        const prevCount = i > 0 ? (counts[FUNNEL_STAGES[i - 1].key] || 0) : count
        const convRate  = prevCount > 0 ? ((count / prevCount) * 100).toFixed(0) : '—'
        const color     = theme.funnelColors[stage.key] || theme.gold

        return (
          <div
            key={stage.key}
            style={{ cursor: onStageClick ? 'pointer' : 'default' }}
            onClick={() => onStageClick?.(stage.key)}
            title={`${stage.label}: ${count} leads${i > 0 ? ` (${convRate}% da etapa anterior)` : ''}`}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 3,
            }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 110, flexShrink: 0 }}>
                {stage.label}
              </span>
              <div style={{
                flex: 1,
                height: 18,
                background: 'var(--surface-hover)',
                borderRadius: 2,
                overflow: 'hidden',
                position: 'relative',
              }}>
                <div style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: color,
                  opacity: 0.8,
                  borderRadius: 2,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color, width: 36, textAlign: 'right' }}>
                {count}
              </span>
              {i > 0 && (
                <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 32 }}>
                  {convRate}%
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
