#!/usr/bin/env node
/**
 * Full load do C2S → Supabase
 * Uso: node scripts/full-load.js [--resume]
 *
 * A API retorna JSON:API com campos em item.attributes.*
 * Paginação: data.meta.total / perPage
 * Rate limit: 10 req/min → sleep de 6,2s entre páginas
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { writeFileSync, readFileSync, existsSync } from 'fs'

const C2S_TOKEN        = process.env.C2S_TOKEN
const SUPABASE_URL     = process.env.SUPABASE_URL
const SUPABASE_SRV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PER_PAGE         = 50
const SLEEP_MS         = 6200
const PROGRESS_FILE    = '.full-load-progress.json'

if (!C2S_TOKEN || !SUPABASE_URL || !SUPABASE_SRV_KEY) {
  console.error('Variáveis de ambiente necessárias: C2S_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SRV_KEY, {
  auth: { persistSession: false }
})

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) } catch { /**/ }
  }
  return { lastPage: 0, totalProcessed: 0, startedAt: new Date().toISOString() }
}

function saveProgress(p) { writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)) }

// ── Mapeamento de funnel_status raw → normalizado ──────────────────────────
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
  const m = { new: 'Novo', in_attendance: 'Em negociação', scheduled_visit: 'Em negociação',
    done_visit: 'Em negociação', created_offer: 'Em negociação', converted: 'Negócio fechado', lost: 'Arquivado' }
  return m[funnel] ?? funnel
}

// ── Parser de data (ISO já vem da API, mas mantém suporte aos 3 formatos) ──
function parseDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  const m1 = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s)
  if (m1) { const d = new Date(`${m1[1]}-${m1[2]}-${m1[3]}T${m1[4]}:${m1[5]}:${m1[6]}-03:00`); return isNaN(d.getTime()) ? null : d }
  const m2 = /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s)
  if (m2) { const d = new Date(`${m2[3]}-${m2[2]}-${m2[1]}T${m2[4]}:${m2[5]}:${m2[6]}-03:00`); return isNaN(d.getTime()) ? null : d }
  return null
}

// ── País via libphonenumber-js ─────────────────────────────────────────────
const REGION_MAP = {
  BR: 'Brasil', US: 'América do Norte', CA: 'América do Norte',
  GB: 'Europa', GG: 'Europa', JE: 'Europa', IM: 'Europa',
  IE: 'Europa', CH: 'Europa', IT: 'Europa', PT: 'Europa',
  DE: 'Europa', BE: 'Europa', ES: 'Europa', NO: 'Europa',
  FR: 'Europa', NL: 'Europa', AT: 'Europa', SE: 'Europa',
  DK: 'Europa', FI: 'Europa', PL: 'Europa', LU: 'Europa',
}

function parsePhone(raw) {
  if (!raw) return { pais_iso: null, regiao: 'Outros' }
  const s = String(raw).trim()
  const normalized = s.startsWith('+') ? s : `+${s}`
  try {
    const phone = parsePhoneNumberFromString(normalized)
    if (!phone?.isValid()) return { pais_iso: null, regiao: 'Outros' }
    const pais_iso = phone.country
    return { pais_iso, regiao: REGION_MAP[pais_iso] || 'Outros' }
  } catch { return { pais_iso: null, regiao: 'Outros' } }
}

// ── Parser de moeda ────────────────────────────────────────────────────────
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

// ── Transforma item JSON:API → linha da tabela leads ───────────────────────
function transformLead(item) {
  const a = item.attributes || {}
  const customer  = a.customer || {}
  const seller    = a.seller || {}
  const source    = a.lead_source || {}
  const channel   = a.channel || {}
  const funnelObj = a.funnel_status || {}
  const doneObj   = a.done_details || {}
  const archObj   = a.archive_details || {}
  const product   = a.product || {}

  const telefone = customer.phone_global || customer.phone || null
  const { pais_iso, regiao } = parsePhone(telefone)

  const funnel_status_atual = normalizeFunnel(funnelObj.status)
  const arquivado = archObj.archived === true || funnel_status_atual === 'lost'

  const data_entrada = parseDate(a.created_at)
  const done_deal_at = parseDate(a.done_deal_at)

  return {
    id_lead:              String(item.id),
    data_entrada:         data_entrada?.toISOString() ?? null,
    origem:               source.name || null,
    canal:                channel.name || null,
    nome_cliente:         customer.name || null,
    telefone,
    pais_iso,
    regiao,
    corretor:             seller.name || null,
    status_atual:         a.lead_status?.name || funnelToStatus(funnel_status_atual),
    funnel_status_atual,
    tags:                 Array.isArray(a.tags) ? a.tags.map(t => (t.tag_name || t.name || t)?.trim?.() || t).filter(Boolean) : [],
    valor_potencial:      parseCurrency(product.price_float || product.price),
    done_deal_at:         done_deal_at?.toISOString() ?? null,
    valor_venda:          parseCurrency(doneObj.done_price),
    arquivado,
    motivo_arquivamento:  archObj.archive_notes || null,
    foi_recuperado:       false,
    empreendimento:       product.description || a.description || null,
    created_at_c2s:       data_entrada?.toISOString() ?? null,
    updated_at_c2s:       parseDate(a.updated_at)?.toISOString() ?? null,
    raw:                  item,
    synced_at:            new Date().toISOString(),
  }
}

// ── Evento para lead_eventos (estado atual) ────────────────────────────────
function makeEvento(lead) {
  if (!lead.funnel_status_atual || !lead.data_entrada) return null
  return {
    id_lead:       lead.id_lead,
    status:        lead.status_atual,
    funnel_status: lead.funnel_status_atual,
    corretor:      lead.corretor,
    data_evento:   lead.data_entrada,
  }
}

async function logQI(id_lead, problema, detalhe) {
  await supabase.from('data_quality_issues').insert({ id_lead, problema, detalhe })
}

async function upsertBatch(leads, eventos) {
  const { error: e1 } = await supabase.from('leads').upsert(leads, { onConflict: 'id_lead' })
  if (e1) throw new Error(`upsert leads: ${e1.message}`)

  if (eventos.length > 0) {
    const { error: e2 } = await supabase
      .from('lead_eventos')
      .upsert(eventos, { onConflict: 'id_lead,funnel_status,data_evento', ignoreDuplicates: true })
    if (e2) console.warn('[eventos]', e2.message)
  }
}

async function fetchPage(page) {
  const url = `https://api.contact2sale.com/integration/leads?page=${page}&perpage=${PER_PAGE}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${C2S_TOKEN}` } })
  if (!res.ok) throw new Error(`C2S HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  const resume   = process.argv.includes('--resume')
  let progress   = resume ? loadProgress() : { lastPage: 0, totalProcessed: 0, startedAt: new Date().toISOString() }

  const { data: logRow } = await supabase
    .from('sync_log').insert({ tipo: 'full_load', iniciado_em: new Date().toISOString(), status: 'running' })
    .select('id').single()
  const logId = logRow?.id

  try {
    // Descobre total de páginas na primeira chamada
    const firstPage = progress.lastPage + 1
    const firstData = await fetchPage(firstPage)
    const total      = firstData.meta?.total || 0
    const totalPages = Math.ceil(total / PER_PAGE)

    console.log(`Total de leads: ${total} | Páginas: ${totalPages} | Iniciando na página ${firstPage}`)

    let page = firstPage
    let responseData = firstData

    while (page <= totalPages) {
      const items = Array.isArray(responseData) ? responseData : (responseData.data || [])

      if (items.length === 0) break

      const validLeads  = []
      const validEvts   = []

      for (const item of items) {
        const idLead = String(item.id || '')
        if (!idLead) { await logQI(null, 'id ausente', { item }); continue }

        let lead
        try { lead = transformLead(item) }
        catch (e) { await logQI(idLead, 'erro ao transformar', { erro: e.message }); continue }

        if (!lead.data_entrada) {
          await logQI(idLead, 'data_entrada não parseável', { created_at: item.attributes?.created_at })
          // usa synced_at como fallback para não perder o lead
          lead.data_entrada = lead.synced_at
        }

        validLeads.push(lead)
        const evt = makeEvento(lead)
        if (evt) validEvts.push(evt)
      }

      if (validLeads.length > 0) await upsertBatch(validLeads, validEvts)

      progress.lastPage = page
      progress.totalProcessed += validLeads.length
      saveProgress(progress)

      const pct = ((page / totalPages) * 100).toFixed(1)
      console.log(`Página ${page}/${totalPages} (${pct}%) — ${validLeads.length} leads | total acumulado: ${progress.totalProcessed}`)

      if (page >= totalPages) break
      page++
      await sleep(SLEEP_MS)
      responseData = await fetchPage(page)
    }

    await supabase.rpc('marcar_recuperados')

    await supabase.from('sync_log').update({
      finalizado_em: new Date().toISOString(),
      registros: progress.totalProcessed,
      status: 'completed',
    }).eq('id', logId)

    console.log(`\n✓ Full load concluído: ${progress.totalProcessed} leads processados.`)
    if (existsSync(PROGRESS_FILE)) writeFileSync(PROGRESS_FILE, JSON.stringify({ done: true, ...progress }))

  } catch (err) {
    console.error('\n✗ Erro fatal:', err.message)
    await supabase.from('sync_log')
      .update({ status: 'error', erro: err.message, finalizado_em: new Date().toISOString() })
      .eq('id', logId)
    console.log('Progresso salvo. Use --resume para continuar.')
    process.exit(1)
  }
}

main()
