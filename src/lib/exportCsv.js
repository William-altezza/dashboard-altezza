import Papa from 'papaparse'

// Baixa um CSV (separador ";" e BOM, abre direto no Excel em português).
export function baixarCSV(rows, nomeBase) {
  if (!rows?.length) return
  const csv  = Papa.unparse(rows, { delimiter: ';' })
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const hoje = new Date().toISOString().slice(0, 10)
  a.href     = url
  a.download = `${nomeBase}-${hoje}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
