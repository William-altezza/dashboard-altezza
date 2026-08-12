#!/usr/bin/env node
/**
 * Corrige funnel_status_atual, status_atual, arquivado, valor_venda e done_deal_at
 * re-processando o campo raw já salvo no Supabase — sem refazer fetch da API.
 * Usa UPDATE em vez de UPSERT para não tocar em data_entrada.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

const FUNNEL_MAP = {
  'new': 'new', 'new lead': 'new',
  'in attendance': 'in_attendance',
  'scheduled visit': 'scheduled_visit',
  'done visit': 'done_visit',
  'created offer': 'created_offer',
  'converted': 'converted',
  'lost': 'lost',
}

function normalizeFunnel(raw) {
  return FUNNEL_MAP[(raw || '').toLowerCase()] ?? (raw || '').toLowerCase() ?? null
}

function funnelToStatus(funnel) {
  const m = {
    new: 'Novo', in_attendance: 'Em negociação', scheduled_visit: 'Em negociação',
    done_visit: 'Em negociação', created_offer: 'Em negociação',
    converted: 'Negócio fechado', lost: 'Arquivado',
  }
  return m[funnel] ?? funnel
}

function determineFunnelStatus(a) {
  if (a.done_details?.done === true)                        return 'converted'
  if (a.archive_details?.archived === true)                 return 'lost'
  const alias = a.lead_status?.alias
  if (alias === 'converted')                                return 'converted'
  if (alias === 'lost' || alias === 'archived')             return 'lost'
  if (alias === 'new')                                      return 'new'
  return normalizeFunnel(a.funnel_status?.status)
}

function parseCurrency(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return isNaN(raw) ? null : raw
  let s = String(raw).trim().replace(/^R\$\s*/, '')
  const hasBrDecimal = s.includes(',')
  const hasMultipleDots = (s.match(/\./g) || []).length > 1
  if (hasBrDecimal || hasMultipleDots) s = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseDate(raw) {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// Busca todas as linhas em lotes de 1000
const FETCH_SIZE = 1000
const CONCURRENT = 20   // updates paralelos por rodada

let allLeads = []
let offset = 0
while (true) {
  const { data, error } = await sb.from('leads').select('id_lead, raw').range(offset, offset + FETCH_SIZE - 1)
  if (error) { console.error('Erro ao buscar:', error.message); process.exit(1) }
  if (!data || data.length === 0) break
  allLeads = allLeads.concat(data)
  if (data.length < FETCH_SIZE) break
  offset += FETCH_SIZE
}

console.log(`Total de leads para re-processar: ${allLeads.length}`)

// Monta array de updates
const updates = allLeads.map(row => {
  const a = row.raw?.attributes || {}
  const funnel_status_atual = determineFunnelStatus(a)
  return {
    id_lead:             row.id_lead,
    funnel_status_atual,
    status_atual:        funnelToStatus(funnel_status_atual),
    arquivado:           a.archive_details?.archived === true || funnel_status_atual === 'lost',
    done_deal_at:        parseDate(a.done_deal_at),
    valor_venda:         parseCurrency(a.done_details?.done_price),
  }
})

// Executa updates em lotes paralelos usando UPDATE ... WHERE id_lead = ANY(array)
// Agrupa por valor de funnel_status para fazer updates em massa
const byStatus = {}
for (const u of updates) {
  const key = `${u.funnel_status_atual}|${u.arquivado}|${u.status_atual}`
  if (!byStatus[key]) byStatus[key] = { funnel_status_atual: u.funnel_status_atual, status_atual: u.status_atual, arquivado: u.arquivado, ids: [] }
  byStatus[key].ids.push(u.id_lead)
}

// Para funnel_status sem done_deal_at/valor_venda, usa update em massa por grupo
let done = 0
const groups = Object.values(byStatus)
console.log(`Grupos de status: ${groups.length}`)

for (const g of groups) {
  // Update em lotes de 500 ids por vez (IN clause)
  for (let i = 0; i < g.ids.length; i += 500) {
    const chunk = g.ids.slice(i, i + 500)
    const { error } = await sb.from('leads').update({
      funnel_status_atual: g.funnel_status_atual,
      status_atual:        g.status_atual,
      arquivado:           g.arquivado,
    }).in('id_lead', chunk)
    if (error) console.error(`Erro update ${g.funnel_status_atual}:`, error.message)
    done += chunk.length
    process.stdout.write(`\r  Corrigidos: ${done}/${allLeads.length}`)
  }
}

// Update de done_deal_at e valor_venda para os que têm (converted e alguns com done_deal_at)
const comDeal = updates.filter(u => u.done_deal_at || u.valor_venda)
console.log(`\n  Atualizando done_deal_at/valor_venda para ${comDeal.length} leads...`)

// Individualmente (são poucos)
const parallelChunks = []
for (let i = 0; i < comDeal.length; i += CONCURRENT) {
  parallelChunks.push(comDeal.slice(i, i + CONCURRENT))
}
for (const chunk of parallelChunks) {
  await Promise.all(chunk.map(u =>
    sb.from('leads').update({ done_deal_at: u.done_deal_at, valor_venda: u.valor_venda }).eq('id_lead', u.id_lead)
  ))
}

// Recalcula recuperados
await sb.rpc('marcar_recuperados')
console.log('  marcar_recuperados() executado')

// Distribuição final
const statuses = ['new','in_attendance','scheduled_visit','done_visit','created_offer','converted','lost']
const counts = await Promise.all(statuses.map(s =>
  sb.from('leads').select('count', { count: 'exact', head: true }).eq('funnel_status_atual', s)
))
const { count: comFechamento } = await sb.from('leads').select('count', { count: 'exact', head: true }).not('done_deal_at', 'is', null)
const { count: comValor }      = await sb.from('leads').select('count', { count: 'exact', head: true }).not('valor_venda', 'is', null)

console.log('\n✓ Re-processamento concluído!')
console.log('Distribuição por funil:')
statuses.forEach((s, i) => console.log(`  ${s.padEnd(20)} ${counts[i].count}`))
console.log(`\nLeads com done_deal_at: ${comFechamento}`)
console.log(`Leads com valor_venda:  ${comValor}`)
