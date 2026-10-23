import { useEffect, useState } from 'react'
import { Tile } from '../ui/Tile'
import { supabase } from '../../lib/supabase'

const ACAO = { pausar: 'Pausou', ativar: 'Ativou', orcamento: 'Orçamento' }
const TIPO = { campanha: 'campanha', conjunto: 'conjunto', anuncio: 'anúncio' }

// Histórico das ações feitas no Meta pelo dashboard (pausar, ativar, orçamento).
export function HistoricoMeta() {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    supabase.from('meta_acoes_log').select('*').order('criado_em', { ascending: false }).limit(50)
      .then(({ data }) => setRows(data || []))
  }, [])

  const fmt = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const mudanca = r => r.acao === 'orcamento'
    ? `R$ ${r.antes || '—'} → R$ ${r.depois || '—'}`
    : `${r.antes || '—'} → ${r.depois || '—'}`

  return (
    <Tile title="HISTÓRICO DE AÇÕES NO META" subtitle="pausar, ativar e orçamento feitos pelo dashboard · últimas 50">
      <div style={{ overflow: 'auto', maxHeight: 320 }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th>Quando</th><th>Quem</th><th>Ação</th><th>Item</th><th>Mudança</th><th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={6}>Carregando...</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>Nenhuma ação feita ainda.</td></tr>}
            {rows?.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td>{fmt(r.criado_em)}</td>
                <td>{(r.usuario || '').split('@')[0]}</td>
                <td>{ACAO[r.acao] || r.acao}</td>
                <td>{TIPO[r.tipo]}: {r.alvo_nome || r.alvo_id}</td>
                <td>{mudanca(r)}</td>
                <td style={{ color: r.ok ? 'var(--positive)' : 'var(--negative)' }}>
                  {r.ok ? 'OK' : (r.erro || 'Erro')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tile>
  )
}
