import { useMemo } from 'react'
import { Tile } from '../components/ui/Tile'
import { KPICard } from '../components/ui/KPICard'
import { FunnelChart } from '../components/charts/FunnelChart'
import { useKPIs, useLeads, useVendas, useMetas } from '../hooks/useMetrics'
import { useFilters } from '../hooks/useFilters'
import { formatBRL, formatNumber, formatPct, formatDays } from '../lib/formatters'
import { hasTagPotencial, effectiveStage } from '../lib/funnel'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie, Legend,
} from 'recharts'
import { theme } from '../styles/theme'
import styles from './Overview.module.css'

const PIPELINE_STAGES = [
  { key: 'in_attendance',   label: 'Atendimento' },
  { key: 'potencial',       label: 'Potencial' },
  { key: 'scheduled_visit', label: 'V. Agendada' },
  { key: 'done_visit',      label: 'V. Realizada' },
  { key: 'created_offer',   label: 'Proposta' },
]

export function Overview() {
  const { kpis, loading, error } = useKPIs()
  const { leads }                = useLeads()
  const { vendas }               = useVendas()
  const { metas }                = useMetas()
  const { addCrossFilter }       = useFilters()

  // Pipeline ativo (excluindo converted e lost) — usa a mesma etapa "efetiva"
  // do Funil Geral (Em Atendimento + tag Potencial vira etapa própria) pra
  // não mostrar números diferentes entre os dois painéis.
  const pipeline = useMemo(() => {
    return PIPELINE_STAGES.map(s => {
      const leadsDaEtapa = leads.filter(l => effectiveStage(l) === s.key)
      return {
        ...s,
        count: leadsDaEtapa.length,
        valor: leadsDaEtapa.reduce((sum, l) => sum + (l.valor_potencial || 0), 0),
      }
    })
  }, [leads])

  // Indicações
  const indicacaoStats = useMemo(() => {
    const vendas_total = vendas.length
    const vendas_indicacao = vendas.filter(v =>
      (v.origem || '').toLowerCase().includes('indicaç')
    ).length
    const compradores_total = vendas_total

    return {
      pctVendasIndicacao: vendas_total > 0 ? vendas_indicacao / vendas_total : null,
      metaPctVendasIndicacao: (metas['pct_conversao_indicacao'] || 50) / 100,
      compradores_total,
    }
  }, [vendas, metas])

  // Etiqueta "Potencial" (C2S) — leads que já passaram por essa etiqueta,
  // em qualquer etapa atual, e o que aconteceu com eles depois
  const potencialStats = useMemo(() => {
    const potenciais   = leads.filter(hasTagPotencial)
    const convertidos  = potenciais.filter(l => l.funnel_status_atual === 'converted').length
    const perdidos     = potenciais.filter(l => l.funnel_status_atual === 'lost').length
    const emAndamento  = potenciais.length - convertidos - perdidos
    return {
      total: potenciais.length,
      convertidos,
      perdidos,
      emAndamento,
      taxaConv: potenciais.length > 0 ? convertidos / potenciais.length : null,
    }
  }, [leads])

  // Recuperação de arquivados
  const recuperacaoStats = useMemo(() => {
    const arquivados   = leads.filter(l => l.arquivado).length
    const recuperados  = leads.filter(l => l.foi_recuperado).length
    const recFechados  = leads.filter(l => l.foi_recuperado && l.funnel_status_atual === 'converted').length
    return { arquivados, recuperados, recFechados }
  }, [leads])

  // Origens para donut
  const origemData = useMemo(() => {
    const map = {}
    for (const l of leads) {
      const o = l.origem || 'Sem origem'
      map[o] = (map[o] || 0) + 1
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }))
  }, [leads])

  if (error) {
    return <div className={styles.error}>Erro ao carregar dados: {error}</div>
  }

  return (
    <div className={styles.page}>
      {/* KPIs principais */}
      <div className="tile-grid-5">
        <KPICard title="LEADS TOTAIS"   value={kpis ? formatNumber(kpis.totalLeads) : null}   loading={loading} />
        <KPICard title="VENDAS"         value={kpis ? formatNumber(kpis.totalVendas) : null}   loading={loading} />
        <KPICard title="RECEITA (VGV)"  value={kpis ? formatBRL(kpis.receita) : null}  loading={loading} />
        <KPICard title="INVESTIMENTO"   value={kpis ? formatBRL(kpis.investimento) : null} loading={loading} />
        <KPICard title="TAXA CONVERSÃO" value={kpis ? formatPct(kpis.taxaConversao) : null}   loading={loading} />
      </div>

      <div className="tile-grid-4" style={{ marginTop: 'var(--gap)' }}>
        <KPICard title="CPL"          value={kpis ? formatBRL(kpis.cpl) : null}          loading={loading} />
        <KPICard title="CAC"          value={kpis ? formatBRL(kpis.cac) : null}          loading={loading} />
        <KPICard
          title="ROAS"
          value={kpis?.roas != null ? `${kpis.roas.toFixed(2)}×` : '—'}
          loading={loading}
          tooltip="Calculado sobre a comissão real da Altezza (5% da receita/VGV), não sobre a VGV bruta"
        />
        <KPICard title="TICKET MÉDIO" value={kpis ? formatBRL(kpis.ticketMedio) : null}  loading={loading} />
      </div>
      {/* ROI fica oculto até os custos reais da empresa (aluguel, folha etc) serem
          cadastrados no Admin — sem eles o cálculo fica distorcido. Reative trocando
          esta linha pelo bloco de KPICard ROI (ver histórico do arquivo) quando os
          custos estiverem configurados. */}

      {/* Funil + Pipeline */}
      <div className="tile-grid-2" style={{ marginTop: 'var(--gap)' }}>
        <Tile title="FUNIL GERAL" subtitle="por etapa">
          <FunnelChart leads={leads} onStageClick={s => addCrossFilter('status', s)} />
        </Tile>

        <Tile title="PIPELINE EM ABERTO" subtitle="leads ativos por etapa">
          <div className={styles.pipeline}>
            {pipeline.map(s => (
              <div key={s.key} className={styles.pipelineRow}
                onClick={() => addCrossFilter('status', s.key)}
                style={{ cursor: 'pointer' }}
              >
                <div className={styles.pipelineLabel}>{s.label}</div>
                <div className={styles.pipelineCount}>{formatNumber(s.count)}</div>
                <div className={styles.pipelineValor}>{formatBRL(s.valor)}</div>
              </div>
            ))}
          </div>
        </Tile>
      </div>

      {/* Etiqueta Potencial (C2S) */}
      <div className="tile-grid-4" style={{ marginTop: 'var(--gap)' }}>
        <Tile
          title="ETIQUETA POTENCIAL"
          subtitle="leads que já tiveram essa etiqueta no C2S, em qualquer etapa"
          span={4}
          onClick={() => addCrossFilter('status', 'potencial')}
        >
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', paddingTop: 8 }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--gold)' }}>
                {formatNumber(potencialStats.total)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>total marcados</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--positive)' }}>
                {formatNumber(potencialStats.convertidos)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>fecharam negócio</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatNumber(potencialStats.emAndamento)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>ainda em andamento</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--negative)' }}>
                {formatNumber(potencialStats.perdidos)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>arquivados/perdidos</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatPct(potencialStats.taxaConv)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>taxa de conversão</div>
            </div>
          </div>
        </Tile>
      </div>

      {/* Origens + Tempo médio + Indicações + Recuperação */}
      <div className="tile-grid-4" style={{ marginTop: 'var(--gap)' }}>
        <Tile title="ORIGENS" subtitle="distribuição de leads" span={2}>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={origemData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                innerRadius={35}
                onClick={d => addCrossFilter('origem', d.name)}
                style={{ cursor: 'pointer' }}
              >
                {origemData.map((_, i) => (
                  <Cell key={i} fill={theme.chartColors[i % theme.chartColors.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, name) => [formatNumber(v), name]}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              />
              <Legend
                formatter={name => <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{name}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </Tile>

        <Tile title="TEMPO DE CONVERSÃO" subtitle="média em dias">
          <div style={{ textAlign: 'center', paddingTop: 16 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--gold)' }}>
              {kpis ? formatDays(kpis.tempoMedioConversao) : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              tempo médio até fechamento
            </div>
          </div>
        </Tile>

        <Tile title="INDICAÇÕES">
          <div className={styles.indicacoes}>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Vendas via indicação</span>
              <span className={styles.indValue} style={{ color: 'var(--gold)' }}>
                {formatPct(indicacaoStats.pctVendasIndicacao)}
              </span>
              <span className={styles.indMeta}>
                meta {formatPct(indicacaoStats.metaPctVendasIndicacao)}
              </span>
            </div>
            <div className={styles.recRow}>
              <span className={styles.indLabel}>Arquivados</span>
              <span className={styles.indValue}>{formatNumber(recuperacaoStats.arquivados)}</span>
            </div>
            <div className={styles.recRow}>
              <span className={styles.indLabel}>Recuperados</span>
              <span className={styles.indValue} style={{ color: 'var(--positive)' }}>
                {formatNumber(recuperacaoStats.recuperados)}
                {recuperacaoStats.arquivados > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                    ({formatPct(recuperacaoStats.recuperados / recuperacaoStats.arquivados)})
                  </span>
                )}
              </span>
            </div>
            <div className={styles.recRow}>
              <span className={styles.indLabel}>Recuperados → Fechado</span>
              <span className={styles.indValue} style={{ color: 'var(--positive)' }}>
                {formatNumber(recuperacaoStats.recFechados)}
              </span>
            </div>
          </div>
        </Tile>
      </div>
    </div>
  )
}
