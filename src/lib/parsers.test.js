import { describe, it, expect } from 'vitest'
import { parseDate, parseCurrency, parsePhone } from './parsers.js'

// ────────────────────────────────────────────────────────────
// parseDate
// ────────────────────────────────────────────────────────────
describe('parseDate', () => {
  it('parseia formato ISO com timezone', () => {
    const d = parseDate('2025-12-29T06:54:53.000-03:00')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(11) // dezembro
    expect(d.getUTCDate()).toBe(29)
  })

  it('parseia formato YYYY/MM/DD HH:MM:SS', () => {
    const d = parseDate('2025/11/21 19:54:54')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(10) // novembro
    expect(d.getUTCDate()).toBe(21)
    // 19:54 BRT = 22:54 UTC
    expect(d.getUTCHours()).toBe(22)
    expect(d.getUTCMinutes()).toBe(54)
  })

  it('parseia formato DD/MM/YYYY, HH:MM:SS', () => {
    const d = parseDate('23/11/2025, 21:11:17')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(10)
    expect(d.getUTCDate()).toBe(24) // 21:11 -03 = 00:11 UTC do dia seguinte
  })

  it('parseia DD/MM/YYYY sem vírgula', () => {
    const d = parseDate('23/11/2025 21:11:17')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2025)
  })

  it('retorna null para string vazia', () => {
    expect(parseDate('')).toBeNull()
    expect(parseDate(null)).toBeNull()
    expect(parseDate('lixo')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
// parseCurrency
// ────────────────────────────────────────────────────────────
describe('parseCurrency', () => {
  it('parseia formato BR com milhar e vírgula decimal', () => {
    expect(parseCurrency('1.050.000,00')).toBe(1050000)
    expect(parseCurrency('700.000,00')).toBe(700000)
    expect(parseCurrency('1.234.567,89')).toBeCloseTo(1234567.89)
  })

  it('parseia formato US com ponto decimal simples', () => {
    expect(parseCurrency('531325.00')).toBe(531325)
    expect(parseCurrency('1234.56')).toBeCloseTo(1234.56)
  })

  it('parseia com prefixo R$', () => {
    expect(parseCurrency('R$ 700.000,00')).toBe(700000)
    expect(parseCurrency('R$700.000,00')).toBe(700000)
  })

  it('lida com number diretamente', () => {
    expect(parseCurrency(1050000)).toBe(1050000)
    expect(parseCurrency(0)).toBe(0)
  })

  it('retorna null para vazio/inválido', () => {
    expect(parseCurrency('')).toBeNull()
    expect(parseCurrency(null)).toBeNull()
    expect(parseCurrency('abc')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
// parsePhone
// ────────────────────────────────────────────────────────────
describe('parsePhone', () => {
  it('detecta Brasil (+55)', () => {
    const r = parsePhone('+5548999001234')
    expect(r.pais_iso).toBe('BR')
    expect(r.regiao).toBe('Brasil')
  })

  it('detecta EUA (+1) — não confunde com código 17xx', () => {
    const r = parsePhone('+17742001234')
    expect(r.pais_iso).toBe('US')
    expect(r.regiao).toBe('América do Norte')
  })

  it('detecta Canada (+1)', () => {
    const r = parsePhone('+14165551234')
    expect(r.pais_iso).toBe('CA')
    expect(r.regiao).toBe('América do Norte')
  })

  it('detecta Reino Unido (+44) — número de Londres', () => {
    const r = parsePhone('+442012345678')
    expect(r.pais_iso).toBe('GB')
    expect(r.regiao).toBe('Europa')
  })

  it('detecta Guernsey (+44 GG) como Europa', () => {
    const r = parsePhone('+447911123456')
    expect(r.regiao).toBe('Europa') // GG ou GB, ambos Europa
  })

  it('detecta Irlanda (+353)', () => {
    const r = parsePhone('+353851234567')
    expect(r.pais_iso).toBe('IE')
    expect(r.regiao).toBe('Europa')
  })

  it('detecta Portugal (+351)', () => {
    const r = parsePhone('+351912345678')
    expect(r.pais_iso).toBe('PT')
    expect(r.regiao).toBe('Europa')
  })

  it('detecta Alemanha (+49)', () => {
    const r = parsePhone('+4915123456789')
    expect(r.pais_iso).toBe('DE')
    expect(r.regiao).toBe('Europa')
  })

  it('lida com número sem + no início', () => {
    const r = parsePhone('5548999001234')
    expect(r.pais_iso).toBe('BR')
  })

  it('retorna Outros para número inválido', () => {
    const r = parsePhone('123')
    expect(r.pais_iso).toBeNull()
    expect(r.regiao).toBe('Outros')
  })

  it('retorna Outros para null', () => {
    const r = parsePhone(null)
    expect(r.pais_iso).toBeNull()
    expect(r.regiao).toBe('Outros')
  })
})
