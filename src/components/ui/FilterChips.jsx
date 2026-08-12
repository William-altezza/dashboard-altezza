import { useFilters } from '../../hooks/useFilters'
import styles from './FilterChips.module.css'

const DIM_LABEL = {
  corretor: 'Corretor',
  origem:   'Origem',
  regiao:   'Região',
  pais:     'País',
  status:   'Status',
}

export function FilterChips() {
  const { activeFilters, hasActiveFilters, removeCrossFilter, setCorretores, setOrigens, setStatus, clearAllFilters } = useFilters()

  if (!hasActiveFilters) return null

  function removeFilter(f) {
    if (f.type === 'cross')    removeCrossFilter(f.dim)
    if (f.type === 'corretor') setCorretores(prev => prev.filter(c => c !== f.val))
    if (f.type === 'origem')   setOrigens(prev => prev.filter(o => o !== f.val))
    if (f.type === 'status')   setStatus(prev => prev.filter(s => s !== f.val))
  }

  return (
    <div className={styles.chips}>
      {activeFilters.map((f, i) => {
        const dimLabel = DIM_LABEL[f.dim || f.type] || f.dim || f.type
        return (
          <span key={i} className={styles.chip}>
            <span className={styles.dim}>{dimLabel}:</span>
            <span className={styles.val}>{f.val}</span>
            <button
              className={styles.remove}
              onClick={() => removeFilter(f)}
              aria-label={`Remover filtro ${f.val}`}
            >
              ×
            </button>
          </span>
        )
      })}
      <button className={styles.clear} onClick={clearAllFilters}>
        Limpar filtros
      </button>
    </div>
  )
}
