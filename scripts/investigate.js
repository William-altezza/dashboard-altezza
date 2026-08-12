/**
 * Investigação — Itens 4 e 5 (versão sem migração 003)
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const JUNHO_START = '2026-06-01T00:00:00-03:00'
const JUNHO_END   = '2026-06-30T23:59:59-03:00'

// ── Item 4: Divergência de gasto Meta ────────────────────────────────────────
async function investigarGasto() {
  console.log('\n══════════════════════════════════════════')
  console.log('ITEM 4 — DIVERGÊNCIA DE GASTO META (JUNHO)')
  console.log('══════════════════════════════════════════')

  const { data: inv, error } = await supabase
    .from('investimentos')
    .select('id, data, canal, conta_id, valor, fonte')
    .gte('data', '2026-06-01')
    .lte('data', '2026-06-30')
    .order('data')
    .order('conta_id')

  if (error) { console.error(error); return }

  console.log(`\nTotal de registros em junho: ${inv.length}`)

  // Busca contas para mapear nome
  const { data: contas } = await supabase.from('contas_anuncio').select('id, nome, ativa, moeda')
  const contaMap = Object.fromEntries((contas || []).map(c => [c.id, c]))

  console.log('\n── Contas cadastradas ──')
  for (const c of (contas || [])) {
    console.log(`  ${c.id} | ${c.nome} | ativa: ${c.ativa} | moeda: ${c.moeda || 'não detectada'}`)
  }

  // Verifica duplicatas
  const seen = new Map()
  const duplicatas = []
  for (const r of inv) {
    const key = `${r.data}|${r.conta_id}|${r.fonte}`
    if (seen.has(key)) duplicatas.push(key)
    else seen.set(key, r)
  }
  if (duplicatas.length > 0) {
    console.log(`\n⚠ Duplicatas: ${duplicatas.length}`)
    duplicatas.forEach(d => console.log('  ', d))
  } else {
    console.log('\n✓ Sem duplicatas (unique constraint OK)')
  }

  // Por conta
  const porConta = {}
  for (const r of inv) {
    const c = r.conta_id || 'sem_conta'
    if (!porConta[c]) porConta[c] = { registros: 0, total: 0, api: 0, manual: 0 }
    porConta[c].registros++
    porConta[c].total += r.valor || 0
    if (r.fonte === 'api') porConta[c].api += r.valor || 0
    else porConta[c].manual += r.valor || 0
  }

  console.log('\n── Por conta ──')
  for (const [contaId, dados] of Object.entries(porConta)) {
    const nome = contaMap[contaId]?.nome || contaId
    const moeda = contaMap[contaId]?.moeda || 'não detectada'
    console.log(`  ${nome} (${moeda}): ${dados.registros} dias | Total: ${dados.total.toFixed(2)} | API: ${dados.api.toFixed(2)} | Manual: ${dados.manual.toFixed(2)}`)
  }

  // View com regra de precedência manual
  const { data: view } = await supabase
    .from('investimento_por_mes')
    .select('*')
    .gte('mes', '2026-06-01')
    .lte('mes', '2026-06-30')

  console.log('\n── investimento_por_mes (view, manual prevalece sobre API) ──')
  let totalView = 0
  for (const r of (view || [])) {
    const val = Number(r.valor)
    totalView += val
    console.log(`  ${r.mes} | ${r.canal} | R$ ${val.toFixed(2)} | fonte: ${r.fonte_utilizada} | duplicidade: ${r.tem_duplicidade}`)
  }
  console.log(`  TOTAL (view): R$ ${totalView.toFixed(2)}`)
  console.log(`  META GERENCIADOR: USD 1386.65`)
  console.log(`  NOTA: se as contas são USD e não há conversão aplicada, o valor na DB está em USD.`)
  console.log(`        Após migração 003 + reprocessamento de câmbio, o valor estará em BRL.`)

  // Tabela dia a dia completa
  console.log('\n── Tabela dia a dia ──')
  for (const r of inv) {
    const nome = contaMap[r.conta_id]?.nome?.slice(0, 20) || 'sem_conta'
    console.log(`  ${r.data} | ${nome} | ${r.fonte} | ${r.valor?.toFixed(2) || '0'}`)
  }

  // Total bruto API sem deduplicação
  const totalApi = inv.filter(r => r.fonte === 'api').reduce((s, r) => s + (r.valor || 0), 0)
  console.log(`\n  TOTAL API bruto (antes deduplicação manual): ${totalApi.toFixed(2)}`)
  console.log(`  HIPÓTESE: se a conta é USD e não houve conversão, ${totalApi.toFixed(2)} USD ≈ R$ ${(totalApi * 5.7).toFixed(2)} @5.70`)
}

// ── Item 5: Reconciliação de leads ───────────────────────────────────────────
async function investigarLeads() {
  console.log('\n══════════════════════════════════════════')
  console.log('ITEM 5 — RECONCILIAÇÃO LEADS JUNHO (C2S 114 vs Dash 110)')
  console.log('══════════════════════════════════════════')

  const { data: leadsNovo } = await supabase
    .from('leads')
    .select('id_lead, nome_cliente, data_entrada, corretor, origem')
    .gte('data_entrada', JUNHO_START)
    .lte('data_entrada', JUNHO_END)
    .order('data_entrada')

  const { data: leadsVelho } = await supabase
    .from('leads')
    .select('id_lead')
    .gte('data_entrada', '2026-06-01')
    .lte('data_entrada', '2026-06-30')

  console.log(`\n  Antes (filtro UTC bare date): ${leadsVelho?.length ?? '?'} leads`)
  console.log(`  Depois (filtro SP 00:00-23:59): ${leadsNovo?.length ?? '?'} leads`)
  console.log(`  C2S: 114 leads`)

  const novoSet = new Set((leadsNovo || []).map(l => l.id_lead))
  const velhoSet = new Set((leadsVelho || []).map(l => l.id_lead))

  const adicionados = (leadsNovo || []).filter(l => !velhoSet.has(l.id_lead))
  const removidos   = (leadsVelho || []).filter(l => !novoSet.has(l.id_lead.id_lead ?? l.id_lead))

  // Leads no limiar de início (June 1 00:00-03:00 UTC = May 31 21:00-24:00 SP)
  const { data: limiteInicio } = await supabase
    .from('leads')
    .select('id_lead, nome_cliente, data_entrada')
    .gte('data_entrada', '2026-06-01T00:00:00+00:00')
    .lte('data_entrada', '2026-06-01T02:59:59+00:00')

  // Leads no limiar de fim (July 1 00:00-03:00 UTC = June 30 21:00-24:00 SP)
  const { data: limiteFim } = await supabase
    .from('leads')
    .select('id_lead, nome_cliente, data_entrada')
    .gte('data_entrada', '2026-07-01T00:00:00+00:00')
    .lte('data_entrada', '2026-07-01T02:59:59+00:00')

  console.log(`\n── Leads no limiar INÍCIO (June 1 00:00-03:00 UTC = May 31 SP 21:00-24:00) ──`)
  console.log(`   Filtro UTC INCLUÍA estes leads em junho (incorreto):`)
  for (const l of (limiteInicio || [])) {
    const sp = new Date(l.data_entrada).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    console.log(`   ${l.id_lead.slice(0,12)} | ${(l.nome_cliente||'?').padEnd(25)} | UTC: ${l.data_entrada.slice(0,19)} | SP: ${sp}`)
  }
  if (!limiteInicio?.length) console.log('   (nenhum)')

  console.log(`\n── Leads no limiar FIM (July 1 00:00-03:00 UTC = June 30 SP 21:00-24:00) ──`)
  console.log(`   Filtro UTC EXCLUÍA estes leads de junho (incorreto):`)
  for (const l of (limiteFim || [])) {
    const sp = new Date(l.data_entrada).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    console.log(`   ${l.id_lead.slice(0,12)} | ${(l.nome_cliente||'?').padEnd(25)} | UTC: ${l.data_entrada.slice(0,19)} | SP: ${sp}`)
  }
  if (!limiteFim?.length) console.log('   (nenhum)')

  const wronglyIncluded = limiteInicio?.length ?? 0
  const wronglyExcluded = limiteFim?.length ?? 0
  console.log(`\n  Incorretamente incluídos (maio SP, junho UTC): ${wronglyIncluded}`)
  console.log(`  Incorretamente excluídos (junho SP, julho UTC): ${wronglyExcluded}`)
  console.log(`  Diferença net: +${wronglyExcluded - wronglyIncluded} = +${wronglyExcluded - wronglyIncluded} leads`)

  // Issues de qualidade
  const { data: issues } = await supabase
    .from('data_quality_issues')
    .select('problema')
  const tipos = {}
  for (const i of (issues || [])) tipos[i.problema] = (tipos[i.problema] || 0) + 1
  console.log('\n── Data quality issues ──')
  for (const [p, n] of Object.entries(tipos)) console.log(`  ${p}: ${n}`)
}

async function main() {
  await investigarGasto()
  await investigarLeads()
  console.log('\n══ FIM ══\n')
}

main().catch(console.error)
