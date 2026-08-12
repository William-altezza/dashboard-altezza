// Formata valor BRL: R$ 1.234.567,89
// Compact: R$ 19,6 mi / R$ 1,2 bi
export function formatBRL(value, { compact = false } = {}) {
  if (value === null || value === undefined || isNaN(value)) return '—'

  if (compact) {
    if (Math.abs(value) >= 1e9)
      return `R$ ${(value / 1e9).toFixed(1).replace('.', ',')} bi`
    if (Math.abs(value) >= 1e6)
      return `R$ ${(value / 1e6).toFixed(1).replace('.', ',')} mi`
    if (Math.abs(value) >= 1e3)
      return `R$ ${(value / 1e3).toFixed(0)} mil`
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// Formata número inteiro compacto: 1.234 / 12,5 mil / 1,2 mi
export function formatNumber(value, { compact = false } = {}) {
  if (value === null || value === undefined || isNaN(value)) return '—'
  if (!compact) return new Intl.NumberFormat('pt-BR').format(value)
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1).replace('.', ',')} mi`
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1).replace('.', ',')} mil`
  return String(value)
}

// Formata percentual: 12,5%
export function formatPct(value) {
  if (value === null || value === undefined || isNaN(value)) return '—'
  return `${(value * 100).toFixed(1).replace('.', ',')}%`
}

// Formata dias: 45 dias / 1 dia
export function formatDays(value) {
  if (value === null || value === undefined || isNaN(value)) return '—'
  const d = Math.round(value)
  return `${d} dia${d !== 1 ? 's' : ''}`
}

// Variação % com seta ▲▼
export function formatVariation(value) {
  if (value === null || value === undefined || isNaN(value)) return null
  const pct = (value * 100).toFixed(1).replace('.', ',')
  const positive = value >= 0
  return {
    label: `${positive ? '▲' : '▼'} ${Math.abs(parseFloat(pct)).toFixed(1).replace('.', ',')}%`,
    positive,
  }
}
