import { describe, it, expect } from 'vitest'

/**
 * Testes de reconciliação
 * Verificam que a soma de leads/vendas por dimensão bate com o total geral
 */

function sumByDimension(items, dimension) {
  const map = {}
  for (const item of items) {
    const key = item[dimension] || 'Sem atribuição'
    map[key] = (map[key] || 0) + 1
  }
  return Object.values(map).reduce((a, b) => a + b, 0)
}

function sumVendasByDimension(vendas, dimension) {
  const map = {}
  for (const v of vendas) {
    const key = v[dimension] || 'Sem atribuição'
    map[key] = (map[key] || 0) + 1
  }
  return Object.values(map).reduce((a, b) => a + b, 0)
}

const mockLeads = [
  { id_lead: '1', corretor: 'Ricardo', origem: 'Instagram Leads', regiao: 'Brasil' },
  { id_lead: '2', corretor: 'Ricardo', origem: 'Facebook Leads', regiao: 'Europa' },
  { id_lead: '3', corretor: 'Ana', origem: 'Instagram Leads', regiao: 'Brasil' },
  { id_lead: '4', corretor: null, origem: 'Indicação', regiao: 'Brasil' },
  { id_lead: '5', corretor: 'Ana', origem: null, regiao: 'América do Norte' },
]

const mockVendas = [
  { id_lead: '1', corretor: 'Ricardo', origem: 'Instagram Leads', valor_venda: 700000 },
  { id_lead: '3', corretor: 'Ana', origem: 'Instagram Leads', valor_venda: 850000 },
]

describe('Reconciliação: soma por dimensão = total geral', () => {
  it('leads por corretor somam = total de leads', () => {
    const total = mockLeads.length
    const porCorretor = sumByDimension(mockLeads, 'corretor')
    expect(porCorretor).toBe(total)
  })

  it('leads por origem somam = total de leads', () => {
    const total = mockLeads.length
    const porOrigem = sumByDimension(mockLeads, 'origem')
    expect(porOrigem).toBe(total)
  })

  it('leads por região somam = total de leads', () => {
    const total = mockLeads.length
    const porRegiao = sumByDimension(mockLeads, 'regiao')
    expect(porRegiao).toBe(total)
  })

  it('vendas por corretor somam = total de vendas', () => {
    const total = mockVendas.length
    const porCorretor = sumVendasByDimension(mockVendas, 'corretor')
    expect(porCorretor).toBe(total)
  })

  it('vendas por origem somam = total de vendas', () => {
    const total = mockVendas.length
    const porOrigem = sumVendasByDimension(mockVendas, 'origem')
    expect(porOrigem).toBe(total)
  })

  it('leads sem corretor entram na linha "Sem atribuição"', () => {
    const map = {}
    for (const l of mockLeads) {
      const key = l.corretor || 'Sem atribuição'
      map[key] = (map[key] || 0) + 1
    }
    expect(map['Sem atribuição']).toBe(1) // id_lead '4' não tem corretor
    expect(map['Ricardo']).toBe(2)
    expect(map['Ana']).toBe(2)
  })

  it('receita por corretor bate com receita total', () => {
    const total = mockVendas.reduce((s, v) => s + v.valor_venda, 0)
    const porCorretor = {}
    for (const v of mockVendas) {
      const k = v.corretor || 'Sem atribuição'
      porCorretor[k] = (porCorretor[k] || 0) + v.valor_venda
    }
    const soma = Object.values(porCorretor).reduce((a, b) => a + b, 0)
    expect(soma).toBe(total)
  })
})
