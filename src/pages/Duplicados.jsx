import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { Tile } from '../components/ui/Tile'
import { ExportCSVButton } from '../components/ui/ExportCSVButton'
import { formatNumber } from '../lib/formatters'

const LABEL = {
  new: 'Novo Lead', in_attendance: 'Em Atendimento', scheduled_visit: 'Visita Agendada',
  done_visit: 'Visita Realizada', created_offer: 'Proposta', converted: 'Fechado', lost: 'Arquivado',
}
const RANK = { converted: 6, created_offer: 5, done_visit: 4, scheduled_visit: 3, in_attendance: 2, new: 1, lost: 0 }

const COLS = 'id_lead,nome_cliente,telefone,corretor,funnel_status_atual,data_entrada,ultima_atividade_em,tags,origem'

function dataCurta(iso) {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'dd/MM/yy') } catch { return '—' }
}

async function carregarTodos() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('leads').select(COLS)
      .not('telefone', 'is', null).neq('telefone', '')
      .order('id_lead').range(from, from + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}

// Agrupa por telefone (só dígitos) e sugere qual lead manter: o mais avançado
// no funil; empate = atividade mais recente.
function agrupar(leads) {
  const map = {}
  for (const l of leads) {
    const k = l.telefone.replace(/\D/g, '')
    if (k.length < 8) continue
    ;(map[k] ||= []).push(l)
  }
  return Object.entries(map)
    .filter(([, arr]) => arr.length > 1)
    .map(([tel, arr]) => {
      const ordenado = [...arr].sort((a, b) =>
        (RANK[b.funnel_status_atual] ?? 0) - (RANK[a.funnel_status_atual] ?? 0) ||
        new Date(b.ultima_atividade_em || b.data_entrada) - new Date(a.ultima_atividade_em || a.data_entrada))
      return {
        tel,
        manter: ordenado[0].id_lead,
        leads: ordenado,
        ativos: arr.filter(l => l.funnel_status_atual !== 'lost').length,
      }
    })
}

export function Duplicados() {
  const [leads, setLeads] = useState(null)
  const [erro, setErro] = useState(null)
  const [escopo, setEscopo] = useState('ativos2')   // ativos2 | ativos1 | todos
  const [corretor, setCorretor] = useState('')

  useEffect(() => {
    carregarTodos().then(setLeads).catch(e => setErro(e.message))
  }, [])

  const grupos = useMemo(() => (leads ? agrupar(leads) : []), [leads])

  const filtrados = useMemo(() => grupos.filter(g => {
    if (escopo === 'ativos2' && g.ativos < 2) return false
    if (escopo === 'ativos1' && g.ativos < 1) return false
    if (corretor && !g.leads.some(l => l.corretor === corretor)) return false
    return true
  }), [grupos, escopo, corretor])

  const corretores = useMemo(
    () => [...new Set(grupos.flatMap(g => g.leads.map(l => l.corretor).filter(Boolean)))].sort(),
    [grupos])

  const linhas = useMemo(() => filtrados.flatMap((g, i) => g.leads.map(l => ({
    grupo: i + 1,
    telefone: '+' + g.tel,
    cliente: l.nome_cliente || '',
    corretor: l.corretor || '',
    etapa: LABEL[l.funnel_status_atual] || l.funnel_status_atual,
    entrada: dataCurta(l.data_entrada),
    ultima_atividade: dataCurta(l.ultima_atividade_em),
    origem: l.origem || '',
    sugestao: l.id_lead === g.manter ? 'MANTER' : 'duplicado — excluir/mesclar',
    id_lead: l.id_lead,
  }))), [filtrados])

  const excedentes = filtrados.reduce((s, g) => s + g.leads.length - 1, 0)

  if (erro) return <div style={{ color: 'var(--negative)' }}>Erro: {erro}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <Tile
        title="LEADS DUPLICADOS"
        subtitle="mesmo telefone cadastrado mais de uma vez no C2S · independe do filtro de período"
      >
        {!leads ? 'Carregando...' : (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <select value={escopo} onChange={e => setEscopo(e.target.value)} style={sel}>
                <option value="ativos2">Prioridade: 2+ leads ainda abertos</option>
                <option value="ativos1">Pelo menos 1 lead aberto</option>
                <option value="todos">Todos (inclui só arquivados)</option>
              </select>
              <select value={corretor} onChange={e => setCorretor(e.target.value)} style={sel}>
                <option value="">Todos os corretores</option>
                {corretores.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {formatNumber(filtrados.length)} telefones repetidos · {formatNumber(excedentes)} leads a mais
                (de {formatNumber(grupos.length)} telefones repetidos no total)
              </span>
            </div>

            <ExportCSVButton nome={`duplicados-${corretor ? corretor.split(' ')[0].toLowerCase() : 'todos'}`} rows={linhas} />

            <div style={{ overflow: 'auto', maxHeight: 560 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th>Telefone</th><th>Cliente</th><th>Corretor</th><th>Etapa</th>
                    <th>Entrada</th><th>Últ. atividade</th><th>Sugestão</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.slice(0, 300).map(g => g.leads.map((l, i) => (
                    <tr key={l.id_lead} style={{ borderTop: i === 0 ? '1px solid var(--border)' : 'none' }}>
                      <td>{i === 0 ? '+' + g.tel : ''}</td>
                      <td>{l.nome_cliente || '—'}</td>
                      <td>{l.corretor || '—'}</td>
                      <td>{LABEL[l.funnel_status_atual] || l.funnel_status_atual}</td>
                      <td>{dataCurta(l.data_entrada)}</td>
                      <td>{dataCurta(l.ultima_atividade_em)}</td>
                      <td style={{ color: l.id_lead === g.manter ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                        {l.id_lead === g.manter ? 'MANTER' : 'duplicado'}
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
              {filtrados.length > 300 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 8 }}>
                  Mostrando os 300 primeiros — o CSV traz a lista completa.
                </div>
              )}
            </div>
          </>
        )}
      </Tile>
    </div>
  )
}

const sel = {
  background: 'var(--surface)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  fontSize: 12, padding: '5px 8px',
}
