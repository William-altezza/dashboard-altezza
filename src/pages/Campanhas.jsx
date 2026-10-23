import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFilters } from '../hooks/useFilters'
import { Tile } from '../components/ui/Tile'
import { KPICard } from '../components/ui/KPICard'
import { ExportCSVButton } from '../components/ui/ExportCSVButton'
import { formatBRL, formatNumber, formatPct } from '../lib/formatters'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { hasTagPotencial, motivoPerdaLabel } from '../lib/funnel'
import { useAuth } from '../hooks/useAuth'

// Como o corretor tratou o lead no C2S (quem entrou no período selecionado).
// Fechado > Arquivado > Potencial; o resto está "em andamento".
function classe(l) {
  if (l.funnel_status_atual === 'converted') return 'fechado'
  if (l.funnel_status_atual === 'lost' || l.arquivado) return 'arquivado'
  if (hasTagPotencial(l)) return 'potencial'
  return 'aberto'
}

const BOLA = {
  fechado:   { cor: '#34D399', rotulo: 'Negócio fechado' },
  potencial: { cor: '#FACC15', rotulo: 'Potencial' },
  arquivado: { cor: '#F87171', rotulo: 'Arquivado/perdido' },
}

// Bolinhas de qualidade: uma por categoria presente, com a contagem dentro.
// Passar o mouse abre a lista dos leads daquela categoria.
function Bolinhas({ leads, titulo, onHover }) {
  if (!leads || leads.length === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const por = { fechado: [], potencial: [], arquivado: [] }
  for (const l of leads) { const c = classe(l); if (por[c]) por[c].push(l) }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
      <span style={{ color: 'var(--text-secondary)', marginRight: 2 }}>{leads.length}</span>
      {Object.entries(por).map(([k, arr]) => arr.length > 0 && (
        <span key={k}
          onMouseEnter={e => onHover({ x: e.clientX, y: e.clientY, titulo, tipo: k, leads: arr })}
          onMouseMove={e => onHover({ x: e.clientX, y: e.clientY, titulo, tipo: k, leads: arr })}
          onMouseLeave={() => onHover(null)}
          style={{
            width: 18, height: 18, borderRadius: '50%', background: BOLA[k].cor, color: '#0a1f1a',
            fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'default',
          }}>
          {arr.length}
        </span>
      ))}
    </span>
  )
}

const STATUS_LABEL = {
  ACTIVE: 'Ativa', PAUSED: 'Pausada', CAMPAIGN_PAUSED: 'Campanha pausada', ADSET_PAUSED: 'Conj. pausado',
  ARCHIVED: 'Arquivada', DELETED: 'Excluída', WITH_ISSUES: 'Com problemas',
  IN_PROCESS: 'Em análise', PENDING_REVIEW: 'Em análise', DISAPPROVED: 'Reprovada',
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function paginar(build) {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}

// Soma as linhas diárias por entidade (campanha, conjunto ou anúncio).
function agregar(dias, idKey) {
  const m = {}
  for (const r of dias) {
    const id = r[idKey]
    const x = (m[id] ||= { id, nome: r.nome, gasto: 0, impressoes: 0, alcance: 0, cliques: 0, leads: 0, conversas: 0 })
    x.gasto += Number(r.gasto_brl) || 0
    x.impressoes += Number(r.impressoes) || 0
    x.alcance += Number(r.alcance) || 0
    x.cliques += Number(r.cliques_link) || 0
    x.leads += r.leads || 0
    x.conversas += r.conversas || 0
  }
  return m
}

function derivar(x, cad = {}) {
  const resultados = x.leads + x.conversas
  return {
    ...x,
    nome: x.nome || cad.nome,
    status: cad.status_efetivo || '—',
    orcamento: cad.orcamento_diario ?? null,
    objetivo: cad.objetivo || '',
    thumb: cad.thumbnail_url || null,
    ctr: x.impressoes > 0 ? x.cliques / x.impressoes : null,
    cpc: x.cliques > 0 ? x.gasto / x.cliques : null,
    cpm: x.impressoes > 0 ? (x.gasto / x.impressoes) * 1000 : null,
    resultados,
    custoResultado: resultados > 0 ? x.gasto / resultados : null,
  }
}

const vazio = id => ({ id, nome: null, gasto: 0, impressoes: 0, alcance: 0, cliques: 0, leads: 0, conversas: 0 })

export function Campanhas() {
  const { dateRange } = useFilters()
  const [dias, setDias] = useState(null)
  const [camps, setCamps] = useState({})
  const [erro, setErro] = useState(null)
  const [mostrar, setMostrar] = useState('com_gasto')   // com_gasto | ativas | todas
  const [ordem, setOrdem] = useState({ col: 'gasto', dir: 'desc' })
  const [abertos, setAbertos] = useState({})            // { 'c:ID': true, 'a:ID': true }
  const [filhos, setFilhos] = useState({})              // { 'c:ID': [conjuntos], 'a:ID': [anúncios] }
  const [leadsAd, setLeadsAd] = useState([])            // leads do C2S que vieram de anúncio, no período
  const [anuncios, setAnuncios] = useState({})          // ad_id → { adset_id, campaign_id }
  const [popup, setPopup] = useState(null)
  const { isAdmin } = useAuth()
  const [modal, setModal] = useState(null)              // confirmação do liga/desliga: { tipo, id, nome, acao }
  const [executando, setExecutando] = useState(false)
  const [resultado, setResultado] = useState(null)      // { ok, texto }
  const [overrides, setOverrides] = useState({})        // alterações já feitas: id → { status?, orcamento? }
  const [editOrc, setEditOrc] = useState(null)          // edição inline do orçamento: { id, tipo, atual, valor }
  const [salvandoOrc, setSalvandoOrc] = useState(false)
  const [toast, setToast] = useState(null)              // { ok, texto }
  const ncol = 13

  function mostrarToast(ok, texto) {
    setToast({ ok, texto })
    setTimeout(() => setToast(null), ok ? 3000 : 7000)
  }

  // Chama a função segura do servidor (confere admin, limites e registra no histórico).
  async function chamarMeta(tipo, id, acao, valor) {
    const { data, error } = await supabase.functions.invoke('meta-acao', { body: { tipo, id, acao, valor } })
    if (data?.ok) {
      setOverrides(o => ({
        ...o,
        [id]: {
          ...(o[id] || {}),
          ...(acao === 'pausar' ? { status: 'PAUSED' } : {}),
          ...(acao === 'ativar' ? { status: 'ACTIVE' } : {}),
          ...(acao === 'orcamento' ? { orcamento: valor } : {}),
        },
      }))
      return { ok: true }
    }
    // erros de negócio vêm no corpo (status != 2xx faz o invoke devolver `error`)
    let msg = data?.erro
    if (!data && error) {
      try { msg = (await error.context?.json?.())?.erro } catch { /* ignora */ }
      msg = msg || error.message
    }
    return { ok: false, msg: msg || 'Não foi possível concluir a ação.' }
  }

  async function executar() {
    if (!modal) return
    setExecutando(true); setResultado(null)
    const r = await chamarMeta(modal.tipo, modal.id, modal.acao)
    setExecutando(false)
    if (r.ok) {
      setResultado({ ok: true, texto: 'Feito. A alteração já foi aplicada no Meta.' })
      setTimeout(() => { setModal(null); setResultado(null) }, 1200)
    } else {
      setResultado({ ok: false, texto: r.msg })
    }
  }

  async function salvarOrc() {
    if (!editOrc) return
    const valor = Number(String(editOrc.valor).replace(',', '.'))
    setSalvandoOrc(true)
    const r = await chamarMeta(editOrc.tipo, editOrc.id, 'orcamento', valor)
    setSalvandoOrc(false)
    if (r.ok) { mostrarToast(true, `Orçamento alterado para ${formatBRL(valor)} no Meta.`); setEditOrc(null) }
    else mostrarToast(false, r.msg)
  }

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    let cancelled = false
    setDias(null); setFilhos({}); setAbertos({})
    ;(async () => {
      try {
        const [d, c, ld, an] = await Promise.all([
          paginar(() => supabase.from('meta_campanhas_dia').select('*')
            .gte('data', iso(dateRange[0])).lte('data', iso(dateRange[1]))
            .order('data').order('campaign_id')),
          paginar(() => supabase.from('meta_campanhas').select('*').order('campaign_id')),
          paginar(() => supabase.from('leads')
            .select('id_lead,nome_cliente,corretor,funnel_status_atual,tags,arquivado,arquivado_por,motivo_perda,valor_venda,meta_ad_id,data_entrada')
            .not('meta_ad_id', 'is', null)
            .gte('data_entrada', `${iso(dateRange[0])}T00:00:00-03:00`)
            .lte('data_entrada', `${iso(dateRange[1])}T23:59:59-03:00`)
            .order('data_entrada').order('id_lead')),
          paginar(() => supabase.from('meta_anuncios').select('ad_id,adset_id,campaign_id').order('ad_id')),
        ])
        if (cancelled) return
        setDias(d)
        setCamps(Object.fromEntries(c.map(x => [x.campaign_id, x])))
        setLeadsAd(ld)
        setAnuncios(Object.fromEntries(an.map(x => [x.ad_id, x])))
      } catch (e) { if (!cancelled) setErro(e.message) }
    })()
    return () => { cancelled = true }
  }, [dateRange])

  // Carrega sob demanda os conjuntos de uma campanha / anúncios de um conjunto.
  async function alternar(chave, tipo, id) {
    const abrir = !abertos[chave]
    setAbertos(a => ({ ...a, [chave]: abrir }))
    if (!abrir || filhos[chave]) return
    try {
      const de = iso(dateRange[0]), ate = iso(dateRange[1])
      if (tipo === 'c') {
        const [d, cad] = await Promise.all([
          paginar(() => supabase.from('meta_conjuntos_dia').select('*').eq('campaign_id', id)
            .gte('data', de).lte('data', ate).order('data').order('adset_id')),
          paginar(() => supabase.from('meta_conjuntos').select('*').eq('campaign_id', id).order('adset_id')),
        ])
        const ag = agregar(d, 'adset_id')
        for (const c of cad) {
          if (!ag[c.adset_id] && (c.status_efetivo === 'ACTIVE' || idx.porAdset[c.adset_id])) ag[c.adset_id] = vazio(c.adset_id)
        }
        const cadMap = Object.fromEntries(cad.map(c => [c.adset_id, c]))
        setFilhos(f => ({ ...f, [chave]: Object.values(ag).map(x => derivar(x, cadMap[x.id])) }))
      } else {
        const [d, cad] = await Promise.all([
          paginar(() => supabase.from('meta_anuncios_dia').select('*').eq('adset_id', id)
            .gte('data', de).lte('data', ate).order('data').order('ad_id')),
          paginar(() => supabase.from('meta_anuncios').select('*').eq('adset_id', id).order('ad_id')),
        ])
        const ag = agregar(d, 'ad_id')
        for (const c of cad) {
          if (!ag[c.ad_id] && (c.status_efetivo === 'ACTIVE' || idx.porAd[c.ad_id])) ag[c.ad_id] = vazio(c.ad_id)
        }
        const cadMap = Object.fromEntries(cad.map(c => [c.ad_id, c]))
        setFilhos(f => ({ ...f, [chave]: Object.values(ag).map(x => derivar(x, cadMap[x.id])) }))
      }
    } catch (e) { setErro(e.message) }
  }

  // Leads do C2S ligados a cada campanha / conjunto / anúncio (pelo ad_id do Meta).
  const idx = useMemo(() => {
    const porCamp = {}, porAdset = {}, porAd = {}
    let semLigacao = 0
    for (const l of leadsAd) {
      const a = anuncios[l.meta_ad_id]
      if (!a || a.campaign_id === 'desconhecida') { semLigacao++; continue }
      ;(porAd[l.meta_ad_id] ||= []).push(l)
      if (a.adset_id) (porAdset[a.adset_id] ||= []).push(l)
      ;(porCamp[a.campaign_id] ||= []).push(l)
    }
    return { porCamp, porAdset, porAd, semLigacao }
  }, [leadsAd, anuncios])

  const linhas = useMemo(() => {
    if (!dias) return []
    const m = agregar(dias, 'campaign_id')
    for (const c of Object.values(camps)) {
      if (!m[c.campaign_id] && (c.status_efetivo === 'ACTIVE' || idx.porCamp[c.campaign_id])) {
        m[c.campaign_id] = vazio(c.campaign_id)
      }
    }
    return Object.values(m).map(x => derivar(x, camps[x.id]))
  }, [dias, camps, idx])

  const ordenar = lista => {
    const { col, dir } = ordem
    return [...lista].sort((a, b) => {
      const va = a[col] ?? -Infinity, vb = b[col] ?? -Infinity
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb
      return dir === 'asc' ? cmp : -cmp
    })
  }

  const visiveis = useMemo(() => ordenar(linhas.filter(l =>
    mostrar === 'todas' ? true : mostrar === 'ativas' ? l.status === 'ACTIVE'
      : (l.gasto > 0 || (idx.porCamp[l.id] || []).length > 0))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [linhas, mostrar, ordem, idx])

  const ultimaAtualizacao = useMemo(() => {
    const ts = Object.values(camps).map(c => c.atualizado_em).filter(Boolean).sort()
    if (!ts.length) return null
    return new Date(ts[ts.length - 1]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }, [camps])

  const qualidade = useMemo(() => {
    const q = { potencial: 0, arquivado: 0, fechado: 0 }
    for (const l of leadsAd) { const c = classe(l); if (q[c] !== undefined) q[c]++ }
    return q
  }, [leadsAd])

  const tot = useMemo(() => {
    const t = linhas.reduce((s, l) => ({
      gasto: s.gasto + l.gasto, impressoes: s.impressoes + l.impressoes,
      cliques: s.cliques + l.cliques, resultados: s.resultados + l.resultados,
    }), { gasto: 0, impressoes: 0, cliques: 0, resultados: 0 })
    return {
      ...t,
      ativas: linhas.filter(l => l.status === 'ACTIVE').length,
      ctr: t.impressoes > 0 ? t.cliques / t.impressoes : null,
      custo: t.resultados > 0 ? t.gasto / t.resultados : null,
    }
  }, [linhas])

  const porDia = useMemo(() => {
    const m = {}
    for (const r of dias || []) m[r.data] = (m[r.data] || 0) + (Number(r.gasto_brl) || 0)
    return Object.entries(m).sort().map(([data, gasto]) => ({ data: data.slice(5).split('-').reverse().join('/'), gasto }))
  }, [dias])

  function ordenarPor(col) {
    setOrdem(o => o.col === col ? { col, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' })
  }
  const seta = col => ordem.col === col ? (ordem.dir === 'asc' ? ' ↑' : ' ↓') : ''
  const th = { cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap', padding: '6px 8px' }

  // Uma linha da tabela, em qualquer nível (0 campanha, 1 conjunto, 2 anúncio).
  // É uma FUNÇÃO (não um componente): assim as linhas não são recriadas a cada
  // movimento do mouse e o popup das bolinhas some corretamente.
  function renderLinha(l, nivel) {
    const tipo = nivel === 0 ? 'c' : 'a'
    const chave = `${tipo}:${l.id}`
    const expansivel = nivel < 2
    const aberto = !!abertos[chave]
    const lista = filhos[chave]
    const ov = overrides[l.id] || {}
    const status = ov.status ?? l.status
    const orcamento = ov.orcamento ?? l.orcamento
    const tipoApi = nivel === 0 ? 'campanha' : nivel === 1 ? 'conjunto' : 'anuncio'
    const podeLigar = isAdmin && (status === 'ACTIVE' || status === 'PAUSED')
    const editando = editOrc?.id === l.id
    const valorEd = editando ? Number(String(editOrc.valor).replace(',', '.')) : null
    const varEd = editando && orcamento > 0 && isFinite(valorEd) ? (valorEd - orcamento) / orcamento : null
    const edInvalido = editando && (!isFinite(valorEd) || valorEd < 5 || (varEd != null && varEd > 0.5))
    const pequeno = { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 11, padding: '1px 6px', cursor: 'pointer', marginLeft: 4 }

    return (
      <Fragment key={l.id}>
        <tr
          style={{
            borderTop: '1px solid var(--border)', textAlign: 'right',
            background: nivel === 1 ? 'rgba(255,255,255,0.025)' : nivel === 2 ? 'rgba(255,255,255,0.05)' : 'transparent',
            cursor: expansivel ? 'pointer' : 'default',
          }}
          onClick={expansivel ? () => alternar(chave, tipo, l.id) : undefined}
        >
          <td style={{ textAlign: 'left', padding: '6px 8px', maxWidth: 320, paddingLeft: 8 + nivel * 22 }}>
            <span style={{ display: 'inline-block', width: 14, color: 'var(--gold)' }}>
              {expansivel ? (aberto ? '▾' : '▸') : ''}
            </span>
            {nivel === 2 && l.thumb && (
              <img src={l.thumb} alt="" width={28} height={28}
                style={{ borderRadius: 3, objectFit: 'cover', verticalAlign: 'middle', marginRight: 6 }}
                onError={e => { e.currentTarget.style.display = 'none' }} />
            )}
            {l.nome}
          </td>

          {/* Status com liga/desliga, como no Gerenciador de Anúncios */}
          <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
            {podeLigar ? (
              <button
                role="switch" aria-checked={status === 'ACTIVE'}
                title={status === 'ACTIVE' ? 'Ativa — clique para pausar' : 'Pausada — clique para ativar'}
                onClick={() => { setResultado(null); setModal({ tipo: tipoApi, id: l.id, nome: l.nome, acao: status === 'ACTIVE' ? 'pausar' : 'ativar' }) }}
                style={{
                  width: 34, height: 18, borderRadius: 9, border: 'none', padding: 2, cursor: 'pointer',
                  background: status === 'ACTIVE' ? 'var(--positive)' : 'var(--border)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: status === 'ACTIVE' ? 'flex-end' : 'flex-start',
                  verticalAlign: 'middle', marginRight: 8,
                }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', display: 'block' }} />
              </button>
            ) : null}
            <span style={{ color: status === 'ACTIVE' ? 'var(--positive)' : 'var(--text-muted)', verticalAlign: 'middle' }}>
              {STATUS_LABEL[status] || status}
            </span>
          </td>

          <td style={{ whiteSpace: 'nowrap' }}>
            <Bolinhas
              leads={(nivel === 0 ? idx.porCamp : nivel === 1 ? idx.porAdset : idx.porAd)[l.id]}
              titulo={l.nome}
              onHover={setPopup}
            />
          </td>

          {/* Orçamento: admin clica no valor para editar na própria célula */}
          <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
            {orcamento == null ? '—' : editando ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  autoFocus value={editOrc.valor} inputMode="decimal" disabled={salvandoOrc}
                  onChange={e => setEditOrc(o => ({ ...o, valor: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && !edInvalido) salvarOrc(); if (e.key === 'Escape') setEditOrc(null) }}
                  style={{ width: 70, background: 'var(--bg-deep)', color: 'var(--text-primary)', border: `1px solid ${edInvalido ? 'var(--negative)' : 'var(--gold)'}`, borderRadius: 4, padding: '2px 6px', fontSize: 12, textAlign: 'right' }} />
                <button style={{ ...pequeno, color: 'var(--positive)', opacity: edInvalido || salvandoOrc ? 0.4 : 1 }}
                  disabled={edInvalido || salvandoOrc} title="Salvar no Meta" onClick={salvarOrc}>✓</button>
                <button style={pequeno} disabled={salvandoOrc} title="Cancelar" onClick={() => setEditOrc(null)}>✕</button>
                {varEd != null && (
                  <span style={{ fontSize: 10, color: varEd > 0.5 ? 'var(--negative)' : 'var(--text-muted)' }}>
                    {varEd >= 0 ? '▲' : '▼'}{Math.abs(varEd * 100).toFixed(0)}%{varEd > 0.5 ? ' máx. +50%' : ''}
                  </span>
                )}
              </span>
            ) : isAdmin ? (
              <span
                title="Clique para alterar o orçamento diário"
                onClick={() => setEditOrc({ id: l.id, tipo: tipoApi, valor: String(orcamento) })}
                style={{ cursor: 'pointer', borderBottom: '1px dashed var(--text-muted)' }}>
                {formatBRL(orcamento)} <span style={{ color: 'var(--gold)', fontSize: 10 }}>✎</span>
              </span>
            ) : formatBRL(orcamento)}
          </td>

          <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{formatBRL(l.gasto)}</td>
          <td>{formatNumber(l.impressoes)}</td>
          <td>{formatNumber(l.cliques)}</td>
          <td>{formatPct(l.ctr)}</td>
          <td>{formatBRL(l.cpc)}</td>
          <td>{formatBRL(l.cpm)}</td>
          <td>{formatNumber(l.leads)}</td>
          <td>{formatNumber(l.conversas)}</td>
          <td>{formatBRL(l.custoResultado)}</td>
        </tr>
        {aberto && !lista && (
          <tr><td colSpan={ncol} style={{ padding: '6px 8px', paddingLeft: 30 + nivel * 22, color: 'var(--text-muted)' }}>Carregando...</td></tr>
        )}
        {aberto && lista && lista.length === 0 && (
          <tr><td colSpan={ncol} style={{ padding: '6px 8px', paddingLeft: 30 + nivel * 22, color: 'var(--text-muted)' }}>
            Sem dados neste período.
          </td></tr>
        )}
        {aberto && lista && ordenar(lista).map(f => renderLinha(f, nivel + 1))}
      </Fragment>
    )
  }

  const popupEl = popup && (
    <div style={{
      position: 'fixed', left: Math.min(popup.x + 14, window.innerWidth - 380), top: Math.max(popup.y - 10, 8),
      width: 360, zIndex: 999, pointerEvents: 'none', background: 'var(--surface)',
      border: `1px solid ${BOLA[popup.tipo].cor}`, borderRadius: 'var(--radius)', padding: '10px 12px',
      fontSize: 11, color: 'var(--text-primary)', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
    }}>
      <div style={{ color: BOLA[popup.tipo].cor, fontWeight: 700, marginBottom: 2 }}>
        {popup.leads.length} {BOLA[popup.tipo].rotulo.toLowerCase()}{popup.leads.length > 1 && popup.tipo === 'fechado' ? 's' : ''}
      </div>
      <div style={{ color: 'var(--text-muted)', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {popup.titulo}
      </div>
      {popup.leads.slice(0, 10).map(l => (
        <div key={l.id_lead} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '1px 0' }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {l.nome_cliente || '(sem nome)'}
            {popup.tipo === 'arquivado' && (
              <span style={{ color: BOLA.arquivado.cor }}> ({motivoPerdaLabel(l)})</span>
            )}
          </span>
          <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {(l.corretor || '').split(' ')[0]}
            {popup.tipo === 'fechado' && l.valor_venda ? ` · ${formatBRL(l.valor_venda, { compact: true })}` : ''}
          </span>
        </div>
      ))}
      {popup.leads.length > 10 && (
        <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>+ {popup.leads.length - 10} outros</div>
      )}
    </div>
  )

  const TIPO_TXT = { campanha: 'a campanha', conjunto: 'o conjunto', anuncio: 'o anúncio' }

  const modalEl = modal && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => !executando && setModal(null)}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 420, maxWidth: '92vw', background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 20, color: 'var(--text-primary)', fontSize: 13,
      }}>
        <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>
          {modal.acao === 'pausar' ? 'Pausar' : 'Ativar'} — confirmar
        </div>
        <div style={{ marginBottom: 12 }}>
          Você vai {modal.acao === 'pausar' ? 'pausar' : 'ativar'} {TIPO_TXT[modal.tipo]} <strong>{modal.nome}</strong> direto no Meta.
        </div>
        {resultado && (
          <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 4, fontSize: 12,
            border: `1px solid ${resultado.ok ? 'var(--positive)' : 'var(--negative)'}`,
            color: resultado.ok ? 'var(--positive)' : 'var(--negative)' }}>
            {resultado.texto}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button disabled={executando} onClick={() => setModal(null)}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, padding: '6px 14px', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button disabled={executando || resultado?.ok} onClick={executar}
            style={{ background: 'var(--gold)', border: 'none', color: '#0a1f1a', fontWeight: 700, borderRadius: 4, padding: '6px 16px',
              cursor: executando ? 'default' : 'pointer', opacity: executando ? 0.5 : 1 }}>
            {executando ? 'Aplicando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )

  const toastEl = toast && (
    <div style={{
      position: 'fixed', right: 20, bottom: 20, zIndex: 1001, maxWidth: 380, padding: '10px 14px',
      background: 'var(--surface)', borderRadius: 'var(--radius)', fontSize: 12,
      border: `1px solid ${toast.ok ? 'var(--positive)' : 'var(--negative)'}`,
      color: toast.ok ? 'var(--positive)' : 'var(--negative)', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
    }}>
      {toast.texto}
    </div>
  )

  if (erro) return <div style={{ color: 'var(--negative)' }}>Erro ao carregar campanhas: {erro}</div>
  const carregando = dias === null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      {popupEl}
      {modalEl}
      {toastEl}
      <div className="tile-grid-4">
        <KPICard title="GASTO NO PERÍODO" value={formatBRL(tot.gasto)} loading={carregando}
          tooltip="Soma das campanhas, direto do Gerenciador de Anúncios" />
        <KPICard title="CUSTO POR RESULTADO (CPL)" value={formatBRL(tot.custo)} loading={carregando}
          tooltip="Gasto ÷ (leads de formulário + conversas iniciadas), na visão do Meta. O CPL da Visão Geral usa os leads que chegaram ao C2S." />
        <KPICard title="POTENCIAIS NO PERÍODO" value={formatNumber(qualidade.potencial)} loading={carregando}
          tooltip="Leads de anúncio que entraram no período, ainda abertos e com a etiqueta Potencial no C2S" />
        <KPICard title="ARQUIVADOS NO PERÍODO" value={formatNumber(qualidade.arquivado)} loading={carregando}
          tooltip="Leads de anúncio que entraram no período e foram arquivados ou perdidos no C2S" />
      </div>

      <Tile title="GASTO DIÁRIO" subtitle="todas as campanhas">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={porDia} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="data" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => formatBRL(v, { compact: true })} width={60} />
            <Tooltip
              formatter={v => [formatBRL(v), 'Gasto']}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11 }}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
            <Bar dataKey="gasto" fill="var(--gold)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Tile>

      <Tile title="CAMPANHAS → CONJUNTOS → ANÚNCIOS" subtitle={`espelho do Meta Ads · clique na linha para abrir · atualiza a cada 10 min${ultimaAtualizacao ? ` · última: ${ultimaAtualizacao}` : ''}`}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <select value={mostrar} onChange={e => setMostrar(e.target.value)}
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, padding: '5px 8px' }}>
            <option value="com_gasto">Com gasto no período</option>
            <option value="ativas">Só ativas</option>
            <option value="todas">Todas</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visiveis.length} campanhas</span>
          <button onClick={() => window.location.reload()}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
            ↻ Recarregar
          </button>
        </div>

        <ExportCSVButton nome="campanhas-meta" rows={visiveis.map(l => ({
          campanha: l.nome, status: STATUS_LABEL[l.status] || l.status, objetivo: l.objetivo,
          orcamento_diario: l.orcamento ?? '', gasto: l.gasto.toFixed(2), impressoes: l.impressoes,
          alcance: l.alcance, cliques_link: l.cliques,
          ctr_pct: l.ctr != null ? (l.ctr * 100).toFixed(2) : '',
          cpc: l.cpc != null ? l.cpc.toFixed(2) : '', cpm: l.cpm != null ? l.cpm.toFixed(2) : '',
          leads_formulario: l.leads, conversas_iniciadas: l.conversas,
          custo_por_resultado: l.custoResultado != null ? l.custoResultado.toFixed(2) : '',
          leads_c2s: (idx.porCamp[l.id] || []).length,
          c2s_fechados: (idx.porCamp[l.id] || []).filter(x => classe(x) === 'fechado').length,
          c2s_potenciais: (idx.porCamp[l.id] || []).filter(x => classe(x) === 'potencial').length,
          c2s_arquivados: (idx.porCamp[l.id] || []).filter(x => classe(x) === 'arquivado').length,
        }))} />

        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => ordenarPor('nome')}>Nome{seta('nome')}</th>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => ordenarPor('status')}>Status{seta('status')}</th>
                <th style={{ ...th, cursor: 'default' }} title="Leads do C2S que vieram deste item (entraram no período). Verde = fechado · Amarelo = potencial · Vermelho = arquivado/perdido. Passe o mouse na bolinha.">
                  Leads C2S ⓘ
                </th>
                <th style={th} onClick={() => ordenarPor('orcamento')}>Orç./dia{seta('orcamento')}</th>
                <th style={th} onClick={() => ordenarPor('gasto')}>Gasto{seta('gasto')}</th>
                <th style={th} onClick={() => ordenarPor('impressoes')}>Impressões{seta('impressoes')}</th>
                <th style={th} onClick={() => ordenarPor('cliques')}>Cliques{seta('cliques')}</th>
                <th style={th} onClick={() => ordenarPor('ctr')}>CTR{seta('ctr')}</th>
                <th style={th} onClick={() => ordenarPor('cpc')}>CPC{seta('cpc')}</th>
                <th style={th} onClick={() => ordenarPor('cpm')}>CPM{seta('cpm')}</th>
                <th style={th} onClick={() => ordenarPor('leads')}>Leads{seta('leads')}</th>
                <th style={th} onClick={() => ordenarPor('conversas')}>Conversas{seta('conversas')}</th>
                <th style={th} onClick={() => ordenarPor('custoResultado')}>Custo/result.{seta('custoResultado')}</th>
              </tr>
            </thead>
            <tbody>
              {carregando && <tr><td colSpan={ncol} style={{ padding: 12 }}>Carregando...</td></tr>}
              {!carregando && visiveis.length === 0 && (
                <tr><td colSpan={ncol} style={{ padding: 12, color: 'var(--text-muted)' }}>Nenhuma campanha para este filtro e período.</td></tr>
              )}
              {visiveis.map(l => renderLinha(l, 0))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: 'var(--text-secondary)', marginTop: 10, flexWrap: 'wrap' }}>
          <span>Leads do C2S por item (entraram no período):</span>
          {Object.entries(BOLA).map(([k, b]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: b.cor, display: 'inline-block' }} />
              {b.rotulo}
            </span>
          ))}
          <span style={{ color: 'var(--text-muted)' }}>
            {idx.semLigacao > 0 && `· ${formatNumber(idx.semLigacao)} lead(s) do período sem anúncio identificado (anúncio removido ou orgânico)`}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          Para ver negócios fechados de leads mais antigos, amplie o período (ex.: Últimos 6 meses ou Este ano).
          Orçamento/dia aparece onde está definido (campanha CBO ou conjunto); fora disso mostra "—".
          Anúncios e conjuntos só aparecem com dados a partir de 01/09/2026. Alcance somado entre dias pode repetir pessoas.
        </div>
      </Tile>
    </div>
  )
}
