import { useState, createContext, useContext, useCallback } from 'react'
import { startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subDays, subYears } from 'date-fns'

const FiltersContext = createContext(null)

const TODAY = new Date()

export const PERIOD_PRESETS = [
  { id: 'este_mes',      label: 'Este mês',       getDates: () => [startOfMonth(TODAY), endOfMonth(TODAY)] },
  { id: 'mes_passado',   label: 'Mês passado',    getDates: () => [startOfMonth(subMonths(TODAY, 1)), endOfMonth(subMonths(TODAY, 1))] },
  { id: 'ultimos_3',     label: 'Últimos 3 meses',getDates: () => [subDays(TODAY, 90), TODAY] },
  { id: 'ultimos_6',     label: 'Últimos 6 meses',getDates: () => [subDays(TODAY, 180), TODAY] },
  { id: 'ultimos_12',    label: 'Últimos 12 meses',getDates: () => [subDays(TODAY, 365), TODAY] },
  { id: 'este_ano',      label: 'Este ano',       getDates: () => [startOfYear(TODAY), endOfYear(TODAY)] },
  { id: 'personalizado', label: 'Personalizado',  getDates: () => null },
]

const DEFAULT_PRESET = 'este_mes'

function getDefaultDates() {
  const preset = PERIOD_PRESETS.find(p => p.id === DEFAULT_PRESET)
  return preset.getDates()
}

export function FiltersProvider({ children }) {
  const [presetId, setPresetId]   = useState(DEFAULT_PRESET)
  const [dateRange, setDateRange] = useState(getDefaultDates())
  const [corretores, setCorretores] = useState([])   // [] = todos
  const [origens, setOrigens]     = useState([])
  const [status, setStatus]       = useState([])
  const [crossFilters, setCrossFilters] = useState({}) // { dimension: value }

  const setPeriodPreset = useCallback((id) => {
    setPresetId(id)
    if (id !== 'personalizado') {
      const preset = PERIOD_PRESETS.find(p => p.id === id)
      if (preset) setDateRange(preset.getDates())
    }
  }, [])

  const addCrossFilter = useCallback((dimension, value) => {
    setCrossFilters(prev => ({ ...prev, [dimension]: value }))
  }, [])

  const removeCrossFilter = useCallback((dimension) => {
    setCrossFilters(prev => {
      const next = { ...prev }
      delete next[dimension]
      return next
    })
  }, [])

  const clearAllFilters = useCallback(() => {
    setCrossFilters({})
    setCorretores([])
    setOrigens([])
    setStatus([])
    setPeriodPreset(DEFAULT_PRESET)
  }, [setPeriodPreset])

  const activeFilters = [
    ...Object.entries(crossFilters).map(([dim, val]) => ({ type: 'cross', dim, val })),
    ...corretores.map(c => ({ type: 'corretor', val: c })),
    ...origens.map(o => ({ type: 'origem', val: o })),
    ...status.map(s => ({ type: 'status', val: s })),
  ]

  const hasActiveFilters = activeFilters.length > 0

  return (
    <FiltersContext.Provider value={{
      presetId,
      dateRange,
      corretores,
      origens,
      status,
      crossFilters,
      activeFilters,
      hasActiveFilters,
      setPeriodPreset,
      setDateRange,
      setCorretores,
      setOrigens,
      setStatus,
      addCrossFilter,
      removeCrossFilter,
      clearAllFilters,
    }}>
      {children}
    </FiltersContext.Provider>
  )
}

export function useFilters() {
  const ctx = useContext(FiltersContext)
  if (!ctx) throw new Error('useFilters deve ser usado dentro de FiltersProvider')
  return ctx
}
