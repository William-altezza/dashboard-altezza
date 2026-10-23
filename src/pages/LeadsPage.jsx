import { useState, useMemo } from 'react'
import { Tile } from '../components/ui/Tile'
import { useLeads } from '../hooks/useMetrics'
import { formatBRL, formatDays } from '../lib/formatters'
import { format, parseISO } from 'date-fns'
import { baixarCSV } from '../lib/exportCsv'
import styles from './LeadsPage.module.css'

const FUNNEL_LABELS = {
  new:             'Novo Lead',
  in_attendance:   'Em Atendimento',
  scheduled_visit: 'Visita Agendada',
  done_visit:      'Visita Realizada',
  created_offer:   'Proposta',
  converted:       'Fechado',
  lost:            'Arquivado',
}

const FUNNEL_COLORS = {
  new:             '#C9A97A',
  in_attendance:   '#38BDF8',
  scheduled_visit: '#A78BFA',
  done_visit:      '#4ADE80',
  created_offer:   '#FB923C',
  converted:       '#34D399',
  lost:            '#F87171',
}

function formatDateShort(iso) {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'dd/MM/yy') }
  catch { return '—' }
}

export function LeadsPage() {
  const { leads, loading } = useLeads()
  const [search, setSearch] = useState('')
  const [page, setPage]     = useState(1)
  const [sortBy, setSortBy] = useState('data_entrada')
  const [sortDir, setSortDir] = useState('desc')
  const PAGE_SIZE = 50

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return leads
      .filter(l => {
        if (!q) return true
        return (
          (l.nome_cliente || '').toLowerCase().includes(q) ||
          (l.corretor || '').toLowerCase().includes(q) ||
          (l.origem || '').toLowerCase().includes(q) ||
          (l.pais_iso || '').toLowerCase().includes(q) ||
          (l.id_lead || '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const va = a[sortBy] ?? ''
        const vb = b[sortBy] ?? ''
        const cmp = va < vb ? -1 : va > vb ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [leads, search, sortBy, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageData   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
    setPage(1)
  }

  function exportCSV() {
    const rows = filtered.map(l => {
      const dias = l.done_deal_at && l.data_entrada
        ? Math.round((new Date(l.done_deal_at) - new Date(l.data_entrada)) / 86400000)
        : null
      return {
        id_lead: l.id_lead,
        cliente: l.nome_cliente || '',
        corretor: l.corretor || '',
        origem: l.origem || '',
        pais: l.pais_iso || '',
        regiao: l.regiao || '',
        status: FUNNEL_LABELS[l.funnel_status_atual] || l.funnel_status_atual,
        entrada: formatDateShort(l.data_entrada),
        fechamento: formatDateShort(l.done_deal_at),
        dias_conversao: dias ?? '',
        valor_venda: l.valor_venda ?? '',
      }
    })

    baixarCSV(rows, 'leads-altezza')
  }

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <span style={{ opacity: 0.3 }}>↕</span>
    return <span style={{ color: 'var(--gold)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className={styles.page}>
      <Tile title="LEADS" subtitle={`${filtered.length} registros`}>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.search}
            placeholder="Buscar por cliente, corretor, origem, país..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
          <button className={styles.exportBtn} onClick={exportCSV}>
            ↓ Exportar CSV
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => handleSort('nome_cliente')}>Cliente <SortIcon col="nome_cliente" /></th>
                <th onClick={() => handleSort('corretor')}>Corretor <SortIcon col="corretor" /></th>
                <th onClick={() => handleSort('origem')}>Origem <SortIcon col="origem" /></th>
                <th onClick={() => handleSort('pais_iso')}>País <SortIcon col="pais_iso" /></th>
                <th onClick={() => handleSort('funnel_status_atual')}>Status <SortIcon col="funnel_status_atual" /></th>
                <th onClick={() => handleSort('data_entrada')}>Entrada <SortIcon col="data_entrada" /></th>
                <th onClick={() => handleSort('done_deal_at')}>Fechamento <SortIcon col="done_deal_at" /></th>
                <th>Dias</th>
                <th onClick={() => handleSort('valor_venda')}>Valor <SortIcon col="valor_venda" /></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className={styles.loading}>Carregando...</td></tr>
              ) : pageData.map(l => {
                const dias = l.done_deal_at && l.data_entrada
                  ? Math.round((new Date(l.done_deal_at) - new Date(l.data_entrada)) / 86400000)
                  : null
                return (
                  <tr key={l.id_lead}>
                    <td className={styles.clienteName}>{l.nome_cliente || '—'}</td>
                    <td className={styles.corretor}>{l.corretor || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td className={styles.origem}>{l.origem || '—'}</td>
                    <td>{l.pais_iso || '—'}</td>
                    <td>
                      <span
                        className={styles.statusBadge}
                        style={{ background: `${FUNNEL_COLORS[l.funnel_status_atual]}20`, color: FUNNEL_COLORS[l.funnel_status_atual] }}
                      >
                        {FUNNEL_LABELS[l.funnel_status_atual] || l.funnel_status_atual}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatDateShort(l.data_entrada)}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatDateShort(l.done_deal_at)}</td>
                    <td style={{ color: dias != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {dias != null ? dias : '—'}
                    </td>
                    <td style={{ color: 'var(--gold)', fontWeight: 600 }}>
                      {l.valor_venda ? formatBRL(l.valor_venda, { compact: true }) : '—'}
                    </td>
                  </tr>
                )
              })}
              {!loading && pageData.length === 0 && (
                <tr><td colSpan={9} className={styles.empty}>Nenhum lead encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >← Ant.</button>
            <span className={styles.pageInfo}>{page} / {totalPages}</span>
            <button
              className={styles.pageBtn}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >Próx. →</button>
          </div>
        )}
      </Tile>
    </div>
  )
}
