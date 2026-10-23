import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFilters } from '../hooks/useFilters'
import { Tile } from '../components/ui/Tile'
import { KPICard } from '../components/ui/KPICard'
import { ExportCSVButton } from '../components/ui/ExportCSVButton'
import { formatBRL, formatNumber, formatPct } from '../lib/formatters'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

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

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    let cancelled = false
    setDias(null); setFilhos({}); setAbertos({})
    ;(async () => {
      try {
        const [d, c] = await Promise.all([
          paginar(() => supabase.from('meta_campanhas_dia').select('*')
            .gte('data', iso(dateRange[0])).lte('data', iso(dateRange[1]))
            .order('data').order('campaign_id')),
          paginar(() => supabase.from('meta_campanhas').select('*').order('campaign_id')),
        ])
        if (cancelled) return
        setDias(d)
        setCamps(Object.fromEntries(c.map(x => [x.campaign_id, x])))
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
        for (const c of cad) if (!ag[c.adset_id] && c.status_efetivo === 'ACTIVE') ag[c.adset_id] = vazio(c.adset_id)
        const cadMap = Object.fromEntries(cad.map(c => [c.adset_id, c]))
        setFilhos(f => ({ ...f, [chave]: Object.values(ag).map(x => derivar(x, cadMap[x.id])) }))
      } else {
        const [d, cad] = await Promise.all([
          paginar(() => supabase.from('meta_anuncios_dia').select('*').eq('adset_id', id)
            .gte('data', de).lte('data', ate).order('data').order('ad_id')),
          paginar(() => supabase.from('meta_anuncios').select('*').eq('adset_id', id).order('ad_id')),
        ])
        const ag = agregar(d, 'ad_id')
        for (const c of cad) if (!ag[c.ad_id] && c.status_efetivo === 'ACTIVE') ag[c.ad_id] = vazio(c.ad_id)
        const cadMap = Object.fromEntries(cad.map(c => [c.ad_id, c]))
        setFilhos(f => ({ ...f, [chave]: Object.values(ag).map(x => derivar(x, cadMap[x.id])) }))
      }
    } catch (e) { setErro(e.message) }
  }

  const linhas = useMemo(() => {
    if (!dias) return []
    const m = agregar(dias, 'campaign_id')
    for (const c of Object.values(camps)) {
      if (!m[c.campaign_id] && c.status_efetivo === 'ACTIVE') m[c.campaign_id] = vazio(c.campaign_id)
    }
    return Object.values(m).map(x => derivar(x, camps[x.id]))
  }, [dias, camps])

  const ordenar = lista => {
    const { col, dir } = ordem
    return [...lista].sort((a, b) => {
      const va = a[col] ?? -Infinity, vb = b[col] ?? -Infinity
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb
      return dir === 'asc' ? cmp : -cmp
    })
  }

  const visiveis = useMemo(() => ordenar(linhas.filter(l =>
    mostrar === 'todas' ? true : mostrar === 'ativas' ? l.status === 'ACTIVE' : l.gasto > 0)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [linhas, mostrar, ordem])

  const ultimaAtualizacao = useMemo(() => {
    const ts = Object.values(camps).map(c => c.atualizado_em).filter(Boolean).sort()
    if (!ts.length) return null
    return new Date(ts[ts.length - 1]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }, [camps])

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
  function Linha({ l, nivel }) {
    const tipo = nivel === 0 ? 'c' : 'a'
    const chave = `${tipo}:${l.id}`
    const expansivel = nivel < 2
    const aberto = !!abertos[chave]
    const lista = filhos[chave]
    return (
      <>
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
          <td style={{ textAlign: 'left', color: l.status === 'ACTIVE' ? 'var(--positive)' : 'var(--text-muted)' }}>
            {STATUS_LABEL[l.status] || l.status}
          </td>
          <td>{l.orcamento != null ? formatBRL(l.orcamento) : '—'}</td>
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
          <tr><td colSpan={12} style={{ padding: '6px 8px', paddingLeft: 30 + nivel * 22, color: 'var(--text-muted)' }}>Carregando...</td></tr>
        )}
        {aberto && lista && lista.length === 0 && (
          <tr><td colSpan={12} style={{ padding: '6px 8px', paddingLeft: 30 + nivel * 22, color: 'var(--text-muted)' }}>
            Sem dados neste período.
          </td></tr>
        )}
        {aberto && lista && ordenar(lista).map(f => (
          <Linha key={f.id} l={f} nivel={nivel + 1} />
        ))}
      </>
    )
  }

  if (erro) return <div style={{ color: 'var(--negative)' }}>Erro ao carregar campanhas: {erro}</div>
  const carregando = dias === null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <div className="tile-grid-5">
        <KPICard title="GASTO NO PERÍODO" value={formatBRL(tot.gasto)} loading={carregando}
          tooltip="Soma das campanhas, direto do Gerenciador de Anúncios" />
        <KPICard title="CAMPANHAS ATIVAS" value={formatNumber(tot.ativas)} loading={carregando} />
        <KPICard title="IMPRESSÕES" value={formatNumber(tot.impressoes)} loading={carregando} />
        <KPICard title="CTR (LINK)" value={formatPct(tot.ctr)} loading={carregando}
          tooltip="Cliques no link ÷ impressões" />
        <KPICard title="CUSTO POR RESULTADO" value={formatBRL(tot.custo)} loading={carregando}
          tooltip="Gasto ÷ (leads de formulário + conversas iniciadas). É a visão do Meta; o CPL do dashboard usa os leads que chegaram ao C2S." />
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
        }))} />

        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => ordenarPor('nome')}>Nome{seta('nome')}</th>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => ordenarPor('status')}>Status{seta('status')}</th>
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
              {carregando && <tr><td colSpan={12} style={{ padding: 12 }}>Carregando...</td></tr>}
              {!carregando && visiveis.length === 0 && (
                <tr><td colSpan={12} style={{ padding: 12, color: 'var(--text-muted)' }}>Nenhuma campanha para este filtro e período.</td></tr>
              )}
              {visiveis.map(l => <Linha key={l.id} l={l} nivel={0} />)}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
          Orçamento/dia aparece onde está definido (campanha CBO ou conjunto); fora disso mostra "—".
          Anúncios e conjuntos só aparecem com dados a partir de 01/09/2026. Alcance somado entre dias pode repetir pessoas.
        </div>
      </Tile>
    </div>
  )
}
