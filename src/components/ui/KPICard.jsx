import { Tile } from './Tile'
import styles from './KPICard.module.css'

export function KPICard({ title, value, variation, prefix = '', suffix = '', tooltip, loading }) {
  const isPositive = variation?.positive
  const variationLabel = variation?.label

  if (loading) {
    return (
      <Tile title={title}>
        <div className={styles.skeleton} />
      </Tile>
    )
  }

  return (
    <Tile title={title}>
      <div className={styles.value} title={tooltip}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        {value ?? '—'}
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {variationLabel && (
        <div
          className={`${styles.variation} ${isPositive ? styles.positive : styles.negative}`}
        >
          {variationLabel}
        </div>
      )}
    </Tile>
  )
}
