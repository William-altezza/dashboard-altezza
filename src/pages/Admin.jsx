import { useState, useEffect } from 'react'
import { Tile } from '../components/ui/Tile'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatBRL } from '../lib/formatters'
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import styles from './Admin.module.css'

function useAdminData() {
  const [syncLogs, setSyncLogs]           = useState([])
  const [dqIssues, setDqIssues]           = useState([])
  const [contas, setContas]               = useState([])
  const [investimentos, setInvestimentos] = useState([])
  const [custos, setCustos]               = useState([])
  const [metas, setMetas]                 = useState([])
  const [vendas, setVendas]               = useState([])
  const [loading, setLoading]             = useState(true)

  async function load() {
    setLoading(true)
    const [logs, dqi, acc, inv, cus, met, v] = await Promise.all([
      supabase.from('sync_log').select('*').order('iniciado_em', { ascending: false }).limit(20),
      supabase.from('data_quality_issues').select('*').order('criado_em', { ascending: false }).limit(50),
      supabase.from('contas_anuncio').select('*').order('criado_em'),
      supabase.from('investimento_por_mes').select('*').order('mes', { ascending: false }).limit(24),
      supabase.from('custos').select('*').order('mes', { ascending: false }),
      supabase.from('metas').select('*'),
      supabase.from('leads').select('id_lead, nome_cliente, valor_venda, done_deal_at, corretor')
        .eq('funnel_status_atual', 'converted').not('done_deal_at', 'is', null).order('done_deal_at', { ascending: false }).limit(100),
    ])

    setSyncLogs(logs.data || [])
    setDqIssues(dqi.data || [])
    setContas(acc.data || [])
    setInvestimentos(inv.data || [])
    setCustos(cus.data || [])
    setMetas(met.data || [])
    setVendas(v.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return { syncLogs, dqIssues, contas, investimentos, custos, metas, vendas, loading, reload: load }
}

const META_TOKEN_EXPIRED = (issues) =>
  issues.some(i => i.problema === 'META_TOKEN_EXPIRED')

export function Admin() {
  const { isAdmin } = useAuth()
  const { syncLogs, dqIssues, contas, investimentos, custos, metas, vendas, loading, reload } = useAdminData()

  // Estados de formulários
  const [newConta, setNewConta]         = useState({ id: '', nome: '' })
  const [newInv, setNewInv]             = useState({ data: '', canal: 'Meta Ads', conta_id: '', valor: '', fonte: 'manual' })
  const [newCusto, setNewCusto]         = useState({ mes: '', tipo: 'fixo', descricao: '', valor: '' })
  const [editMeta, setEditMeta]         = useState(null)
  const [editVenda, setEditVenda]       = useState(null)
  const [savingMsg, setSavingMsg]             = useState('')
  const [backfillLoading, setBackfillLoading] = useState(new Set())
  const [reprocessLoading, setReprocessLoading] = useState(false)

  if (!isAdmin) {
    return (
      <div style={{ padding: 32, color: 'var(--negative)' }}>
        Acesso negado. Apenas administradores podem acessar esta página.
      </div>
    )
  }

  async function save(fn, successMsg) {
    setSavingMsg('')
    try {
      await fn()
      setSavingMsg(successMsg)
      setTimeout(() => setSavingMsg(''), 3000)
      reload()
    } catch (e) {
      setSavingMsg(`Erro: ${e.message}`)
    }
  }

  async function addConta() {
    await save(async () => {
      const { error } = await supabase.from('contas_anuncio').insert({
        id: newConta.id.startsWith('act_') ? newConta.id : `act_${newConta.id}`,
        nome: newConta.nome,
      })
      if (error) throw error
      setNewConta({ id: '', nome: '' })
    }, 'Conta adicionada!')
  }

  async function toggleConta(id, ativa) {
    await save(async () => {
      const { error } = await supabase.from('contas_anuncio').update({ ativa: !ativa }).eq('id', id)
      if (error) throw error
    }, `Conta ${ativa ? 'desativada' : 'ativada'}!`)
  }

  async function reprocessCambio() {
    setReprocessLoading(true)
    setSavingMsg('')
    try {
      const { data, error } = await supabase.functions.invoke('sync-meta', {
        body: { reprocess_cambio: true }
      })
      if (error) throw error
      setSavingMsg(`Câmbio reprocessado: ${data?.updated ?? 0} registros atualizados.`)
      setTimeout(() => setSavingMsg(''), 8000)
      reload()
    } catch (e) {
      setSavingMsg(`Erro no reprocessamento: ${e.message}`)
    } finally {
      setReprocessLoading(false)
    }
  }

  async function backfillMeta(contaId, since, until) {
    setBackfillLoading(prev => new Set([...prev, contaId]))
    setSavingMsg('')
    try {
      const { data, error } = await supabase.functions.invoke('sync-meta', {
        body: { backfill: true, since, until }
      })
      if (error) throw error
      const total = data?.upsertados ?? 0
      setSavingMsg(`Backfill concluído: ${total} dias importados.`)
      setTimeout(() => setSavingMsg(''), 6000)
      reload()
    } catch (e) {
      setSavingMsg(`Erro no backfill: ${e.message}`)
    } finally {
      setBackfillLoading(prev => { const s = new Set(prev); s.delete(contaId); return s })
    }
  }

  async function addInvestimento() {
    await save(async () => {
      const { error } = await supabase.from('investimentos').insert({
        data: newInv.data,
        canal: newInv.canal,
        conta_id: newInv.conta_id || null,
        valor: parseFloat(newInv.valor.replace(',', '.')),
        fonte: 'manual',
      })
      if (error) throw error
      setNewInv({ data: '', canal: 'Meta Ads', conta_id: '', valor: '', fonte: 'manual' })
    }, 'Investimento salvo!')
  }

  async function addCusto() {
    await save(async () => {
      const { error } = await supabase.from('custos').insert({
        mes: newCusto.mes,
        tipo: newCusto.tipo,
        descricao: newCusto.descricao,
        valor: parseFloat(newCusto.valor.replace(',', '.')),
      })
      if (error) throw error
      setNewCusto({ mes: '', tipo: 'fixo', descricao: '', valor: '' })
    }, 'Custo salvo!')
  }

  async function saveMeta(chave, valor) {
    await save(async () => {
      const { error } = await supabase.from('metas').upsert({ chave, valor: parseFloat(valor) })
      if (error) throw error
      setEditMeta(null)
    }, 'Meta atualizada!')
  }

  async function saveValorVenda(idLead, valor) {
    await save(async () => {
      const { error } = await supabase.from('leads')
        .update({ valor_venda: parseFloat(valor.replace(/\./g, '').replace(',', '.')) })
        .eq('id_lead', idLead)
      if (error) throw error
      setEditVenda(null)
    }, 'Valor de venda atualizado!')
  }

  if (loading) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Carregando...</div>

  const metaExpired = META_TOKEN_EXPIRED(dqIssues)

  return (
    <div className={styles.page}>
      {metaExpired && (
        <div className={styles.alert}>
          ⚠ Token do Meta Ads expirado — reconecte o System User no Business Manager e atualize o secret <code>META_ACCESS_TOKEN</code> no Supabase.
        </div>
      )}

      {savingMsg && (
        <div className={`${styles.alert} ${savingMsg.startsWith('Erro') ? styles.alertErr : styles.alertOk}`}>
          {savingMsg}
        </div>
      )}

      {/* Câmbio USD→BRL */}
      <Tile title="CÂMBIO USD → BRL" subtitle="conversão automática via PTAX (Banco Central)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: 0, flex: 1 }}>
            As contas do Meta em USD são convertidas para BRL usando a taxa PTAX do dia do gasto.
            Use o botão abaixo para reprocessar registros importados antes desta atualização.
          </p>
          <button
            className={styles.saveBtn}
            onClick={reprocessCambio}
            disabled={reprocessLoading}
            style={{ opacity: reprocessLoading ? 0.6 : 1, minWidth: 200 }}
          >
            {reprocessLoading ? 'Reprocessando…' : 'Reprocessar câmbio histórico'}
          </button>
        </div>
      </Tile>

      {/* Contas de anúncio */}
      <Tile title="CONTAS DE ANÚNCIO META">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>ID</th><th>Nome</th><th>Moeda</th><th>Ativa</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {contas.map(c => (
                <tr key={c.id}>
                  <td><code style={{ fontSize: 11 }}>{c.id}</code></td>
                  <td>{c.nome}</td>
                  <td>
                    <span style={{ color: c.moeda === 'USD' ? 'var(--warning)' : 'var(--positive)', fontSize: 11, fontWeight: 600 }}>
                      {c.moeda || '?'}
                    </span>
                  </td>
                  <td>{c.ativa ? '✓' : '✗'}</td>
                  <td>
                    <button className={styles.actionBtn} onClick={() => toggleConta(c.id, c.ativa)}>
                      {c.ativa ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      className={styles.actionBtn}
                      style={{ marginLeft: 6, opacity: backfillLoading.has(c.id) ? 0.6 : 1, cursor: backfillLoading.has(c.id) ? 'not-allowed' : 'pointer' }}
                      disabled={backfillLoading.has(c.id)}
                      onClick={() => {
                        const since = prompt('Backfill desde (YYYY-MM-DD):', '2024-01-01')
                        const until = prompt('Até (YYYY-MM-DD):', format(new Date(), 'yyyy-MM-dd'))
                        if (since && until) backfillMeta(c.id, since, until)
                      }}
                    >
                      {backfillLoading.has(c.id) ? 'Importando…' : 'Backfill histórico'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.form}>
          <b>Adicionar conta:</b>
          <input className={styles.input} placeholder="ID (ex: 123456789 ou act_123456789)"
            value={newConta.id} onChange={e => setNewConta(p => ({ ...p, id: e.target.value }))} />
          <input className={styles.input} placeholder="Nome descritivo"
            value={newConta.nome} onChange={e => setNewConta(p => ({ ...p, nome: e.target.value }))} />
          <button className={styles.saveBtn} onClick={addConta}>Adicionar</button>
        </div>
      </Tile>

      {/* Cobertura de investimento por mês */}
      <Tile title="COBERTURA DE INVESTIMENTO" subtitle="API vs manual por mês">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Mês</th><th>Canal</th><th>Valor</th><th>Fonte</th><th>Alerta</th></tr>
            </thead>
            <tbody>
              {investimentos.map((i, idx) => (
                <tr key={idx}>
                  <td>{format(parseISO(i.mes), 'MMM/yyyy')}</td>
                  <td>{i.canal}</td>
                  <td style={{ color: 'var(--gold)' }}>{formatBRL(i.valor, { compact: true })}</td>
                  <td>
                    <span className={i.fonte_utilizada === 'manual' ? styles.fonteBadgeManual : styles.fonteBadgeApi}>
                      {i.fonte_utilizada || '—'}
                    </span>
                  </td>
                  <td>
                    {i.tem_duplicidade && (
                      <span className={styles.dupWarning} title="Há dados de API e manual para este mês. O valor manual prevalece.">
                        ⚠ Duplicidade
                      </span>
                    )}
                    {!i.valor && <span style={{ color: 'var(--warning)', fontSize: 10 }}>Mês vazio</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.form}>
          <b>Entrada manual de investimento:</b>
          <input type="date" className={styles.input} value={newInv.data} onChange={e => setNewInv(p => ({ ...p, data: e.target.value }))} />
          <input className={styles.input} placeholder="Canal" value={newInv.canal} onChange={e => setNewInv(p => ({ ...p, canal: e.target.value }))} />
          <select className={styles.input} value={newInv.conta_id} onChange={e => setNewInv(p => ({ ...p, conta_id: e.target.value }))}>
            <option value="">Sem conta específica</option>
            {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <input className={styles.input} placeholder="Valor (ex: 12345,67)" value={newInv.valor} onChange={e => setNewInv(p => ({ ...p, valor: e.target.value }))} />
          <button className={styles.saveBtn} onClick={addInvestimento}>Salvar</button>
        </div>
      </Tile>

      {/* Custos */}
      <Tile title="CUSTOS FIXOS E VARIÁVEIS">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Mês</th><th>Tipo</th><th>Descrição</th><th>Valor</th></tr>
            </thead>
            <tbody>
              {custos.map(c => (
                <tr key={c.id}>
                  <td>{format(parseISO(c.mes), 'MMM/yyyy')}</td>
                  <td><span className={c.tipo === 'fixo' ? styles.fixoBadge : styles.varBadge}>{c.tipo}</span></td>
                  <td>{c.descricao || '—'}</td>
                  <td style={{ color: 'var(--gold)' }}>{formatBRL(c.valor, { compact: true })}</td>
                </tr>
              ))}
              {custos.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>Nenhum custo cadastrado</td></tr>}
            </tbody>
          </table>
        </div>
        <div className={styles.form}>
          <b>Adicionar custo:</b>
          <input type="month" className={styles.input} value={newCusto.mes} onChange={e => setNewCusto(p => ({ ...p, mes: e.target.value + '-01' }))} />
          <select className={styles.input} value={newCusto.tipo} onChange={e => setNewCusto(p => ({ ...p, tipo: e.target.value }))}>
            <option value="fixo">Fixo</option>
            <option value="variavel">Variável</option>
          </select>
          <input className={styles.input} placeholder="Descrição" value={newCusto.descricao} onChange={e => setNewCusto(p => ({ ...p, descricao: e.target.value }))} />
          <input className={styles.input} placeholder="Valor (ex: 5000,00)" value={newCusto.valor} onChange={e => setNewCusto(p => ({ ...p, valor: e.target.value }))} />
          <button className={styles.saveBtn} onClick={addCusto}>Salvar</button>
        </div>
      </Tile>

      {/* Metas */}
      <Tile title="METAS">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Chave</th><th>Valor atual</th><th>Ação</th></tr>
            </thead>
            <tbody>
              {metas.map(m => (
                <tr key={m.chave}>
                  <td><code style={{ fontSize: 11 }}>{m.chave}</code></td>
                  <td>
                    {editMeta === m.chave ? (
                      <input
                        className={styles.input}
                        style={{ width: 100 }}
                        defaultValue={m.valor}
                        onBlur={e => saveMeta(m.chave, e.target.value)}
                        autoFocus
                      />
                    ) : m.valor}
                  </td>
                  <td>
                    <button className={styles.actionBtn} onClick={() => setEditMeta(m.chave)}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      {/* Editar valor de vendas */}
      <Tile title="BACKFILL: VALOR DE VENDA" subtitle="editável nas vendas fechadas">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Cliente</th><th>Corretor</th><th>Fechamento</th><th>Valor</th><th>Ação</th></tr>
            </thead>
            <tbody>
              {vendas.map(v => (
                <tr key={v.id_lead}>
                  <td>{v.nome_cliente || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{v.corretor || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {v.done_deal_at ? format(parseISO(v.done_deal_at), 'dd/MM/yyyy') : '—'}
                  </td>
                  <td>
                    {editVenda === v.id_lead ? (
                      <input
                        className={styles.input}
                        style={{ width: 120 }}
                        defaultValue={v.valor_venda ? String(v.valor_venda).replace('.', ',') : ''}
                        placeholder="700.000,00"
                        onBlur={e => saveValorVenda(v.id_lead, e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <span style={{ color: 'var(--gold)' }}>
                        {v.valor_venda ? formatBRL(v.valor_venda, { compact: true }) : <span style={{ color: 'var(--warning)' }}>Sem valor</span>}
                      </span>
                    )}
                  </td>
                  <td>
                    <button className={styles.actionBtn} onClick={() => setEditVenda(v.id_lead)}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      {/* Sync logs */}
      <Tile title="STATUS DE SINCRONIZAÇÃO">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Tipo</th><th>Iniciado</th><th>Finalizado</th><th>Registros</th><th>Status</th><th>Erro</th></tr>
            </thead>
            <tbody>
              {syncLogs.map(l => (
                <tr key={l.id}>
                  <td><code style={{ fontSize: 10 }}>{l.tipo}</code></td>
                  <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {l.iniciado_em ? format(parseISO(l.iniciado_em), 'dd/MM HH:mm') : '—'}
                  </td>
                  <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {l.finalizado_em ? format(parseISO(l.finalizado_em), 'dd/MM HH:mm') : '—'}
                  </td>
                  <td>{l.registros ?? '—'}</td>
                  <td>
                    <span className={l.status === 'completed' ? styles.statusOk : l.status === 'error' ? styles.statusErr : styles.statusRun}>
                      {l.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 10, color: 'var(--negative)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {l.erro || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      {/* Data quality issues */}
      <Tile title="PROBLEMAS DE QUALIDADE DE DADOS" subtitle={`${dqIssues.length} registros`}>
        <div className={styles.tableWrap} style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr><th>ID Lead</th><th>Problema</th><th>Data</th><th>Detalhe</th></tr>
            </thead>
            <tbody>
              {dqIssues.map(d => (
                <tr key={d.id}>
                  <td><code style={{ fontSize: 10 }}>{d.id_lead || '—'}</code></td>
                  <td style={{ color: 'var(--warning)', fontSize: 11 }}>{d.problema}</td>
                  <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {d.criado_em ? format(parseISO(d.criado_em), 'dd/MM/yy HH:mm') : '—'}
                  </td>
                  <td style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.detalhe ? JSON.stringify(d.detalhe).slice(0, 80) : '—'}
                  </td>
                </tr>
              ))}
              {dqIssues.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--positive)', padding: 12 }}>Nenhum problema registrado ✓</td></tr>}
            </tbody>
          </table>
        </div>
      </Tile>
    </div>
  )
}
