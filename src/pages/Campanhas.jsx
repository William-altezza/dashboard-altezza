import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFilters } from '../hooks/useFilters'
import { Tile } from '../components/ui/Tile'
import { KPICard } from '../components/ui/KPICard'
import { ExportCSVButton } from '../components/ui/ExportCSVButton'
import { formatBRL, formatNumber, formatPct } from '../lib/formatters'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const STATUS_LABEL = {
  ACTIVE: 'Ativa', PAUSED: 'Pausada', CAMPAIGN_PAUSED: 'Pausada', ADSET_PAUSED: 'Conj. pausado',
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

export function Campanhas() {
  const { dateRange } = useFilters()
  const [dias, setDias] = useState(null)
  const [camps, setCamps] = useState({})
  const [erro, setErro] = useState(null)
  const [mostrar, setMostrar] = useState('com_gasto')   // com_gasto | ativas | todas
  const [ordem, setOrdem] = useState({ col: 'gasto', dir: 'desc' })

  useEffect(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return
    let cancelled = false
    setDias(null)
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

  const linhas = useMemo(() => {
    if (!dias) return []
    const m = {}
    for (const r of dias) {
      const x = (m[r.campaign_id] ||= {
        id: r.campaign_id, nome: r.nome, gasto: 0, impressoes: 0, alcance: 0,
        cliques: 0, leads: 0, conversas: 0,
      })
      x.gasto += Number(r.gasto_brl) || 0
      x.impressoes += Number(r.impressoes) || 0
      x.alcance += Number(r.alcance) || 0
      x.cliques += Number(r.cliques_link) || 0
      x.leads += r.leads || 0
      x.conversas += r.conversas || 0
    }
    // campanhas ativas sem gasto no período também aparecem
    for (const c of Object.values(camps)) {
      if (!m[c.campaign_id] && c.status_efetivo === 'ACTIVE') {
        m[c.campaign_id] = { id: c.campaign_id, nome: c.nome, gasto: 0, impressoes: 0, alcance: 0, cliques: 0, leads: 0, conversas: 0 }
      }
    }
    return Object.values(m).map(x => {
      const c = camps[x.id] || {}
      const resultados = x.leads + x.conversas
      return {
        ...x,
        status: c.status_efetivo || '—',
        orcamento: c.orcamento_diario ?? null,
        objetivo: c.objetivo || '',
        ctr: x.impressoes > 0 ? x.cliques / x.impressoes : null,
        cpc: x.cliques > 0 ? x.gasto / x.cliques : null,
        cpm: x.impressoes > 0 ? (x.gasto / x.impressoes) * 1000 : null,
        resultados,
        custoResultado: resultados > 0 ? x.gasto / resultados : null,
      }
    })
  }, [dias, camps])

  const visiveis = useMemo(() => {
    const f = linhas.filter(l =>
      mostrar === 'todas' ? true :
      mostrar === 'ativas' ? l.status === 'ACTIVE' :
      l.gasto > 0)
    const { col, dir } = ordem
    return f.sort((a, b) => {
      const va = a[col] ?? -Infinity, vb = b[col] ?? -Infinity
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb
      return dir === 'asc' ? cmp : -cmp
    })
  }, [linhas, mostrar, ordem])

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

  function ordenar(col) {
    setOrdem(o => o.col === col ? { col, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' })
  }
  const seta = col => ordem.col === col ? (ordem.dir === 'asc' ? ' ↑' : ' ↓') : ''
  const th = { cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap', padding: '6px 8px' }

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

      <Tile title="CAMPANHAS" subtitle="espelho do Meta Ads · atualiza a cada 3 horas">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <select value={mostrar} onChange={e => setMostrar(e.target.value)}
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, padding: '5px 8px' }}>
            <option value="com_gasto">Com gasto no período</option>
            <option value="ativas">Só ativas</option>
            <option value="todas">Todas</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visiveis.length} campanhas</span>
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
                <th style={{ ...th, textAlign: 'left' }} onClick={() => ordenar('nome')}>Campanha{seta('nome')}</th>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => ordenar('status')}>Status{seta('status')}</th>
                <th style={th} onClick={() => ordenar('orcamento')}>Orç./dia{seta('orcamento')}</th>
                <th style={th} onClick={() => ordenar('gasto')}>Gasto{seta('gasto')}</th>
                <th style={th} onClick={() => ordenar('impressoes')}>Impressões{seta('impressoes')}</th>
                <th style={th} onClick={() => ordenar('cliques')}>Cliques{seta('cliques')}</th>
                <th style={th} onClick={() => ordenar('ctr')}>CTR{seta('ctr')}</th>
                <th style={th} onClick={() => ordenar('cpc')}>CPC{seta('cpc')}</th>
                <th style={th} onClick={() => ordenar('cpm')}>CPM{seta('cpm')}</th>
                <th style={th} onClick={() => ordenar('leads')}>Leads{seta('leads')}</th>
                <th style={th} onClick={() => ordenar('conversas')}>Conversas{seta('conversas')}</th>
                <th style={th} onClick={() => ordenar('custoResultado')}>Custo/result.{seta('custoResultado')}</th>
              </tr>
            </thead>
            <tbody>
              {carregando && <tr><td colSpan={12} style={{ padding: 12 }}>Carregando...</td></tr>}
              {!carregando && visiveis.length === 0 && (
                <tr><td colSpan={12} style={{ padding: 12, color: 'var(--text-muted)' }}>Nenhuma campanha para este filtro e período.</td></tr>
              )}
              {visiveis.map(l => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                  <td style={{ textAlign: 'left', padding: '6px 8px', maxWidth: 280 }}>{l.nome}</td>
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
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
          Orçamento/dia aparece só quando definido na campanha (CBO); campanhas com orçamento por conjunto mostram "—".
          Alcance somado entre dias pode repetir pessoas.
        </div>
      </Tile>
    </div>
  )
}
