import { baixarCSV } from '../../lib/exportCsv'

// Botão discreto "↓ CSV" para pôr no topo de qualquer tabela.
// `rows`: array de objetos simples (colunas = chaves).
export function ExportCSVButton({ rows, nome }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
      <button
        onClick={e => { e.stopPropagation(); baixarCSV(rows, nome) }}
        disabled={!rows?.length}
        style={{
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)',
          fontSize: 11, padding: '4px 10px', cursor: rows?.length ? 'pointer' : 'default',
        }}
      >
        ↓ CSV
      </button>
    </div>
  )
}
