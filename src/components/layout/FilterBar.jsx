import { useFilters, PERIOD_PRESETS } from '../../hooks/useFilters'
import { FilterChips } from '../ui/FilterChips'
import { DateRangePicker } from '../ui/DateRangePicker'
import styles from './FilterBar.module.css'

export function FilterBar() {
  const {
    presetId, dateRange, setPeriodPreset, setDateRange, hasActiveFilters,
  } = useFilters()

  function handlePreset(id) {
    setPeriodPreset(id)
  }

  function handleCustomRange(range) {
    if (!range || !range[0]) return
    setDateRange(range)
  }

  return (
    <div className={styles.bar}>
      <div className={styles.presets}>
        {PERIOD_PRESETS.filter(p => p.id !== 'personalizado').map(p => (
          <button
            key={p.id}
            className={`${styles.preset} ${presetId === p.id ? styles.active : ''}`}
            onClick={() => handlePreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <DateRangePicker
        value={presetId === 'personalizado' ? dateRange : null}
        onChange={(range) => {
          setPeriodPreset('personalizado')
          handleCustomRange(range)
        }}
      />

      {hasActiveFilters && (
        <div className={styles.chips}>
          <FilterChips />
        </div>
      )}
    </div>
  )
}
