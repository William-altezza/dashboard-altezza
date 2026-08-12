import { parsePhoneNumberFromString } from 'libphonenumber-js'

// ────────────────────────────────────────────────────────────
// DATE PARSER
// Suporta os 3 formatos misturados nos dados do C2S:
//   1. "2025/11/21 19:54:54"
//   2. "23/11/2025, 21:11:17"
//   3. "2025-12-29T06:54:53.000-03:00" (ISO com timezone)
// Retorna Date ou null (nunca lança)
// ────────────────────────────────────────────────────────────

const FORMAT_ISO = /^\d{4}-\d{2}-\d{2}T/
const FORMAT_SLASH_YMD = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
const FORMAT_DMY = /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/

export function parseDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()

  if (FORMAT_ISO.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }

  let m = FORMAT_SLASH_YMD.exec(s)
  if (m) {
    // "2025/11/21 19:54:54" — interpreta como America/Sao_Paulo (-03:00)
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-03:00`
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d
  }

  m = FORMAT_DMY.exec(s)
  if (m) {
    // "23/11/2025, 21:11:17" — DD/MM/YYYY
    const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d
  }

  return null
}

// ────────────────────────────────────────────────────────────
// CURRENCY PARSER
// Suporta:
//   "1.050.000,00" (BR)  → 1050000.00
//   "531325.00"   (US)   → 531325.00
//   "R$ 700.000,00"      → 700000.00
// Retorna number ou null
// ────────────────────────────────────────────────────────────

export function parseCurrency(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return isNaN(raw) ? null : raw

  let s = String(raw).trim().replace(/^R\$\s*/, '').trim()

  // BR: usa vírgula como decimal e ponto como milhar
  // Detecta: contém vírgula OU tem pontos de milhar (ex: 1.050.000)
  const hasBrDecimal = s.includes(',')
  const hasMultipleDots = (s.match(/\./g) || []).length > 1

  if (hasBrDecimal || hasMultipleDots) {
    // Remove pontos de milhar, substitui vírgula por ponto decimal
    s = s.replace(/\./g, '').replace(',', '.')
  }

  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// ────────────────────────────────────────────────────────────
// PHONE → COUNTRY PARSER
// Usa libphonenumber-js para extrair pais_iso e regiao
// Nunca tenta inferir só pelos primeiros dígitos
// ────────────────────────────────────────────────────────────

const REGION_MAP = {
  BR: 'Brasil',
  US: 'América do Norte',
  CA: 'América do Norte',
  GB: 'Europa',
  GG: 'Europa', // Guernsey (dependência da coroa, +44)
  JE: 'Europa', // Jersey
  IM: 'Europa', // Isle of Man
  IE: 'Europa',
  CH: 'Europa',
  IT: 'Europa',
  PT: 'Europa',
  DE: 'Europa',
  BE: 'Europa',
  ES: 'Europa',
  NO: 'Europa',
  FR: 'Europa',
  NL: 'Europa',
  AT: 'Europa',
  SE: 'Europa',
  DK: 'Europa',
  FI: 'Europa',
  PL: 'Europa',
  LU: 'Europa',
}

export function parsePhone(raw) {
  if (!raw) return { pais_iso: null, regiao: 'Outros' }

  const s = String(raw).trim()
  // Garantir que começa com + para E.164
  const normalized = s.startsWith('+') ? s : `+${s}`

  try {
    const phone = parsePhoneNumberFromString(normalized)
    if (!phone || !phone.isValid()) {
      return { pais_iso: null, regiao: 'Outros' }
    }
    const pais_iso = phone.country
    const regiao = REGION_MAP[pais_iso] || 'Outros'
    return { pais_iso, regiao }
  } catch {
    return { pais_iso: null, regiao: 'Outros' }
  }
}
