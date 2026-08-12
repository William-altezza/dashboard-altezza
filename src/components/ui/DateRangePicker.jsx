import { useState, useRef, useEffect } from 'react'
import { DayPicker } from 'react-day-picker'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import styles from './DateRangePicker.module.css'

function formatDisplay(range) {
  if (!range?.[0]) return 'Selecionar período'
  const start = format(range[0], 'dd/MM/yyyy')
  if (!range[1] || range[1].toDateString() === range[0].toDateString()) return start
  return `${start} → ${format(range[1], 'dd/MM/yyyy')}`
}

export function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [selecting, setSelecting] = useState(null) // { from, to? }
  const ref = useRef(null)

  // Sync external value to internal selecting state when picker opens
  useEffect(() => {
    if (open) {
      setSelecting(value?.[0] ? { from: value[0], to: value[1] } : null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleSelect(range) {
    setSelecting(range)
    // Auto-apply when both ends are selected (including single-day)
    if (range?.from && range?.to) {
      onChange([range.from, range.to])
    } else if (range?.from && !range?.to) {
      // Single click — treat as single-day range
      onChange([range.from, range.from])
    }
  }

  function handleApply() {
    if (selecting?.from) {
      const end = selecting.to ?? selecting.from
      onChange([selecting.from, end])
    }
    setOpen(false)
  }

  return (
    <div className={styles.root} ref={ref}>
      <button
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <span className={styles.icon}>📅</span>
        {formatDisplay(value)}
      </button>

      {open && (
        <div className={styles.popup}>
          <DayPicker
            mode="range"
            selected={selecting}
            onSelect={handleSelect}
            locale={ptBR}
            numberOfMonths={2}
            className={styles.picker}
            classNames={{
              months:           styles.months,
              month:            styles.month,
              caption:          styles.caption,
              caption_label:    styles.captionLabel,
              nav:              styles.nav,
              nav_button:       styles.navButton,
              nav_button_previous: styles.navPrev,
              nav_button_next:  styles.navNext,
              table:            styles.table,
              head_row:         styles.headRow,
              head_cell:        styles.headCell,
              row:              styles.row,
              cell:             styles.cell,
              day:              styles.day,
              day_range_start:  styles.dayRangeStart,
              day_range_end:    styles.dayRangeEnd,
              day_selected:     styles.daySelected,
              day_today:        styles.dayToday,
              day_outside:      styles.dayOutside,
              day_range_middle: styles.dayRangeMiddle,
              day_disabled:     styles.dayDisabled,
            }}
          />
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => setOpen(false)}>Cancelar</button>
            <button className={styles.applyBtn} onClick={handleApply} disabled={!selecting?.from}>
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
