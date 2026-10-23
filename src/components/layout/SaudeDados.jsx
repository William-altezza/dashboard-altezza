import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import styles from './SaudeDados.module.css'

const MIN_C2S_ATRASO = 45      // minutos sem sync do C2S
const DIAS_META_SEM_GASTO = 3  // dias sem nenhuma linha de gasto do Meta
const H_META_SEM_SYNC = 36     // horas sem o sync do Meta rodar

function fmtHora(d) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// Faixa de saúde dos dados: avisa quando alguma integração parou, para o
// problema ser visto na hora e não semanas depois.
export function SaudeDados() {
  const [s, setS] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function carregar() {
      const [c2s, meta, gasto, token] = await Promise.all([
        supabase.from('sync_log').select('finalizado_em,iniciado_em').eq('status', 'completed')
          .neq('tipo', 'meta_diario').order('iniciado_em', { ascending: false }).limit(1),
        supabase.from('sync_log').select('iniciado_em,status,erro').eq('tipo', 'meta_diario')
          .order('iniciado_em', { ascending: false }).limit(1),
        supabase.from('investimentos').select('data').order('data', { ascending: false }).limit(1),
        supabase.from('data_quality_issues').select('criado_em').eq('problema', 'META_TOKEN_EXPIRED')
          .order('criado_em', { ascending: false }).limit(1),
      ])
      if (cancelled) return
      setS({
        c2s:   c2s.data?.[0]?.finalizado_em || c2s.data?.[0]?.iniciado_em || null,
        meta:  meta.data?.[0] || null,
        gasto: gasto.data?.[0]?.data || null,
        token: token.data?.[0]?.criado_em || null,
      })
    }

    carregar()
    const t = setInterval(carregar, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (!s) return null

  const agora = new Date()
  const alertas = []

  if (s.c2s) {
    const min = Math.round((agora - new Date(s.c2s)) / 60000)
    if (min > MIN_C2S_ATRASO) {
      const h = Math.floor(min / 60)
      alertas.push(`C2S sem sincronizar há ${h >= 1 ? `${h}h` : `${min} min`} — leads e vendas podem estar desatualizados.`)
    }
  }

  if (s.meta) {
    const h = (agora - new Date(s.meta.iniciado_em)) / 3600000
    if (s.meta.status === 'error') alertas.push(`Última sincronização do Meta deu erro: ${s.meta.erro || 'sem detalhe'}.`)
    else if (h > H_META_SEM_SYNC) alertas.push(`Sincronização do Meta não roda há ${Math.floor(h / 24)} dia(s).`)
  }

  if (s.gasto) {
    const ultimo = new Date(s.gasto + 'T12:00:00')
    const dias = Math.floor((agora - ultimo) / 86400000)
    if (dias >= DIAS_META_SEM_GASTO) {
      alertas.push(
        `Meta sem gasto registrado há ${dias} dias (último: ${ultimo.toLocaleDateString('pt-BR')}). ` +
        `Confira se as campanhas pausaram ou se há conta de anúncio nova para cadastrar no Admin.`
      )
    }
  }

  if (s.token) alertas.push('Token do Meta expirou — gere um novo e atualize no Supabase.')

  return (
    <div className={styles.wrap}>
      {alertas.map((a, i) => <div key={i} className={styles.alerta}>⚠ {a}</div>)}
      {s.c2s && (
        <div className={styles.info}>
          Dados do C2S atualizados às {fmtHora(new Date(s.c2s))}
          {s.gasto && <> · gasto Meta até {new Date(s.gasto + 'T12:00:00').toLocaleDateString('pt-BR')}</>}
        </div>
      )}
    </div>
  )
}
