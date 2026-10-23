import { useMemo, useState } from 'react'
import { useKPIsAnterior, variacao } from '../hooks/usePeriodoAnterior'
import { Tile } from '../components/ui/Tile'
import { KPICard } from '../components/ui/KPICard'
import { FunnelChart } from '../components/charts/FunnelChart'
import { useKPIs, useLeads, useVendas, useMetas, usePotenciaisMarcados, useLeadsEmRisco, PRAZO_ARQUIVAMENTO } from '../hooks/useMetrics'
import { useFilters } from '../hooks/useFilters'
import { formatBRL, formatNumber, formatPct, formatDays } from '../lib/formatters'
import { hasTagPotencial, effectiveStage, isIndicacao } from '../lib/funnel'
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
  const { potenciais }           = usePotenciaisMarcados()
  const { emRisco }              = useLeadsEmRisco()
  const { addCrossFilter }       = useFilters()
  const ant                      = useKPIsAnterior()
  const [verLista, setVerLista]  = useState(false)
  const [verMais, setVerMais]    = useState(false)
  const v = (campo, opts) => (kpis && ant ? variacao(kpis[campo], ant[campo], opts) : null)

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
    const vendas_indicacao = vendas.filter(isIndicacao).length
    const compradores_total = vendas_total

    return {
      vendas_indicacao,
      pctVendasIndicacao: vendas_total > 0 ? vendas_indicacao / vendas_total : null,
      metaPctVendasIndicacao: (metas['pct_conversao_indicacao'] || 50) / 100,
      compradores_total,
    }
  }, [vendas, metas])

  // Leads que o C2S vai arquivar sozinho em breve. Fora das duas réguas da
  // página: é a foto de AGORA do pipeline inteiro, não do período filtrado.
  const risco = useMemo(() => {
    const urgentes = emRisco.filter(l => l.diasRestantes <= 2)
    const porCorretor = {}
    for (const l of emRisco) {
      const c = l.corretor || 'Sem corretor'
      if (!porCorretor[c]) porCorretor[c] = { total: 0, urgentes: 0 }
      porCorretor[c].total++
      if (l.diasRestantes <= 2) porCorretor[c].urgentes++
    }
    return {
      total: emRisco.length,
      urgentes: urgentes.length,
      potenciais: emRisco.filter(hasTagPotencial).length,
      porCorretor: Object.entries(porCorretor).sort((a, b) => b[1].total - a[1].total),
      lista: [...emRisco].sort((a, b) => a.diasRestantes - b.diasRestantes).slice(0, 8),
    }
  }, [emRisco])

  // ── ETIQUETA POTENCIAL, nas duas leituras da página ─────────────────────
  //
  // (A) NO PERÍODO: quem recebeu a etiqueta entre as datas (tag_potencial_em)
  //     e, das vendas fechadas no período, quantas tinham a etiqueta.
  //     Responde: "a etiqueta está prevendo venda?"
  // (B) DA TURMA: dos leads que ENTRARAM no período e foram marcados, onde
  //     eles estão hoje. Responde: "o lead marcado costuma virar negócio?"
  const potencialPeriodo = useMemo(() => {
    const vendasComEtiqueta = vendas.filter(hasTagPotencial).length
    return {
      marcados: potenciais.length,
      vendasComEtiqueta,
      vendasTotal: vendas.length,
    }
  }, [potenciais, vendas])

  const potencialTurma = useMemo(() => {
    const marcados     = leads.filter(hasTagPotencial)
    const fecharam     = marcados.filter(l => l.funnel_status_atual === 'converted').length
    const perdidos     = marcados.filter(l => l.funnel_status_atual === 'lost').length
    const emAndamento  = marcados.length - fecharam - perdidos
    return {
      total: marcados.length,
      fecharam,
      perdidos,
      emAndamento,
      taxaConv: marcados.length > 0 ? fecharam / marcados.length : null,
    }
  }, [leads])

  // Conversão da turma: dos leads que entraram no período, quantos já fecharam.
  // Não confundir com VENDAS FECHADAS (que conta pela data do fechamento).
  const conversaoTurma = useMemo(() => {
    const fecharam = leads.filter(l => l.funnel_status_atual === 'converted').length
    return {
      fecharam,
      total: leads.length,
      taxa: leads.length > 0 ? fecharam / leads.length : null,
    }
  }, [leads])

  // Recuperação de arquivados
  const recuperacaoStats = useMemo(() => {
    const arquivadosLeads = leads.filter(l => l.arquivado)
    const arquivados   = arquivadosLeads.length
    // O C2S arquiva sozinho depois de 15 dias sem atividade. Separar dos que o
    // corretor arquivou de propósito: um é qualidade do lead, o outro é ritmo
    // de atendimento — e só o segundo é problema nosso.
    const porCorretor  = arquivadosLeads.filter(l => l.arquivado_por === 'corretor').length
    const automaticos  = arquivadosLeads.filter(l => l.arquivado_por === 'automatico').length
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

      {/* Faixa de ação, acima das duas réguas — o C2S não avisa antes de arquivar. */}
      {risco.total > 0 && (
        <div className={styles.alerta}>
          <div className={styles.alertaTopo}>
            <span className={styles.alertaNum}>{formatNumber(risco.total)}</span>
            <span className={styles.alertaTexto}>
              leads vão ser arquivados sozinhos pelo C2S nos próximos 7 dias
              {risco.urgentes > 0 && (
                <strong className={styles.alertaUrgente}> · {formatNumber(risco.urgentes)} em até 2 dias</strong>
              )}
              {risco.potenciais > 0 && (
                <strong className={styles.alertaPotencial}> · {formatNumber(risco.potenciais)} com etiqueta Potencial</strong>
              )}
            </span>
            <span className={styles.alertaNota}>
              agora — não depende do filtro de período · o C2S arquiva após {PRAZO_ARQUIVAMENTO} dias sem atividade registrada
            </span>
          </div>

          <div className={styles.alertaCorretores}>
            {risco.porCorretor.map(([nome, v]) => (
              <span key={nome} className={styles.alertaChip}>
                {nome}: <strong>{v.total}</strong>
                {v.urgentes > 0 && <em className={styles.alertaChipUrg}> ({v.urgentes} urgente{v.urgentes > 1 ? 's' : ''})</em>}
              </span>
            ))}
          </div>

          <button className={styles.toggleBtn} onClick={() => setVerLista(x => !x)}>
            {verLista ? '▲ ocultar lista' : `▼ ver os ${Math.min(8, risco.total)} mais urgentes`}
          </button>

          {verLista && <div className={styles.alertaLista}>
            {risco.lista.map(l => (
              <div key={l.id_lead} className={styles.alertaLinha}>
                <span className={styles.alertaPrazo}
                  style={{ color: l.diasRestantes <= 2 ? 'var(--negative)' : 'var(--text-secondary)' }}>
                  {l.diasRestantes === 0 ? 'hoje' : `${l.diasRestantes}d`}
                </span>
                <span className={styles.alertaNome}>{l.nome_cliente || '(sem nome)'}</span>
                <span className={styles.alertaCorretor}>{l.corretor || '—'}</span>
                {hasTagPotencial(l) && <span className={styles.alertaTag}>Potencial</span>}
              </div>
            ))}
            {risco.total > risco.lista.length && (
              <div className={styles.alertaMais}>
                + {formatNumber(risco.total - risco.lista.length)} outros — lista completa na página Leads
              </div>
            )}
          </div>}
        </div>
      )}

      {/* ══ BLOCO 1 ══════════════════════════════════════════════════════════
          Tudo aqui é contado pela DATA DO EVENTO. Um lead que entrou em julho
          e fechou em agosto conta como venda de agosto. É a leitura de
          resultado: "como foi o período". */}
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>O QUE ACONTECEU NESTE PERÍODO</h2>
        <span className={styles.sectionSub}>
          contado pela data do evento — lead recebido, venda fechada, verba investida
        </span>
      </div>

      <div className="tile-grid-5">
        <KPICard title="LEADS RECEBIDOS" value={kpis ? formatNumber(kpis.totalLeads) : null} loading={loading}
          variation={v('totalLeads')}
          tooltip="Leads que entraram no C2S dentro do período selecionado" />
        <KPICard title="VENDAS FECHADAS" value={kpis ? formatNumber(kpis.totalVendas) : null} loading={loading}
          variation={v('totalVendas')}
          tooltip="Negócios marcados como fechados dentro do período, independente de quando o lead entrou" />
        <KPICard title="RECEITA (VGV)"   value={kpis ? formatBRL(kpis.receita) : null} loading={loading}
          variation={v('receita')} />
        <KPICard title="INVESTIMENTO"    value={kpis ? formatBRL(kpis.investimento) : null} loading={loading}
          variation={v('investimento', { inverso: true })} />
        <KPICard title="TICKET MÉDIO"    value={kpis ? formatBRL(kpis.ticketMedio) : null} loading={loading}
          variation={v('ticketMedio')} />
      </div>

      <div className="tile-grid-4" style={{ marginTop: 'var(--gap)' }}>
        <KPICard title="CPL" value={kpis ? formatBRL(kpis.cpl) : null} loading={loading}
          variation={v('cpl', { inverso: true })}
          tooltip="Investimento do período ÷ leads recebidos no período" />
        <KPICard title="CAC" value={kpis ? formatBRL(kpis.cac) : null} loading={loading}
          variation={v('cac', { inverso: true })}
          tooltip="Investimento do período ÷ vendas fechadas no período" />
        <KPICard
          title="ROAS"
          value={kpis?.roas != null ? `${kpis.roas.toFixed(2)}×` : '—'}
          loading={loading}
          variation={v('roas')}
          tooltip="Calculado sobre a comissão real da Altezza (5% da receita/VGV), não sobre a VGV bruta. Vendas por indicação ficam fora."
        />
        <KPICard title="TEMPO ATÉ FECHAR" value={kpis ? formatDays(kpis.tempoMedioConversao) : null} loading={loading}
          variation={v('tempoMedioConversao', { inverso: true })}
          tooltip="Dias entre a entrada do lead e o fechamento, média das vendas fechadas no período" />
      </div>
      {/* ROI fica oculto até os custos reais da empresa (aluguel, folha etc) serem
          cadastrados no Admin — sem eles o cálculo fica distorcido. Reative trocando
          esta linha pelo bloco de KPICard ROI (ver histórico do arquivo) quando os
          custos estiverem configurados. */}

      <div className="tile-grid-4" style={{ marginTop: 'var(--gap)' }}>
        <Tile title="ORIGENS" subtitle="dos leads recebidos no período" span={2}>
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

        <Tile title="POTENCIAL E INDICAÇÕES" subtitle="neste período" span={2}>
          <div className={styles.statRow}>
            <div>
              <div className={styles.statBig} style={{ color: 'var(--gold)' }}>
                {formatNumber(potencialPeriodo.marcados)}
              </div>
              <div className={styles.statLabel}>leads marcados no período</div>
            </div>
            <div>
              <div className={styles.statBig} style={{ color: 'var(--positive)' }}>
                {formatNumber(potencialPeriodo.vendasComEtiqueta)}
                <span className={styles.statOf}>de {formatNumber(potencialPeriodo.vendasTotal)}</span>
              </div>
              <div className={styles.statLabel}>vendas do período que tinham a etiqueta</div>
            </div>
            <div>
              <div className={styles.statBig} style={{ color: 'var(--gold)' }}>
                {formatNumber(indicacaoStats.vendas_indicacao)}
                <span className={styles.statOf}>de {formatNumber(indicacaoStats.compradores_total)}</span>
              </div>
              <div className={styles.statLabel}>
                vendas por indicação ({formatPct(indicacaoStats.pctVendasIndicacao)} · meta {formatPct(indicacaoStats.metaPctVendasIndicacao)})
              </div>
            </div>
          </div>
        </Tile>
      </div>

      {/* ══ BLOCO 2 ══════════════════════════════════════════════════════════
          Tudo aqui olha para a MESMA turma: os leads que entraram no período.
          Segue essa turma até hoje, mesmo que ela tenha fechado depois. É a
          leitura de qualidade: "o lead que eu comprei presta". */}
      <div className={styles.sectionHeader} style={{ marginTop: 'calc(var(--gap) * 2)' }}>
        <h2 className={styles.sectionTitle}>A TURMA QUE ENTROU NESTE PERÍODO</h2>
        <span className={styles.sectionSub}>
          os {formatNumber(leads.length)} leads que entraram entre as datas — onde eles estão hoje,
          mesmo que tenham fechado depois
        </span>
      </div>

      <div className="tile-grid-2">
        <Tile title="FUNIL GERAL" subtitle="etapa atual dos leads da turma">
          <FunnelChart leads={leads} onStageClick={s => addCrossFilter('status', s)} />
          {/* O funil só mostra quem ainda está vivo. Sem esta linha as etapas não
              somam o total da turma e parece que sumiram leads. */}
          <div className={styles.funnelFooter} onClick={() => addCrossFilter('status', 'lost')}>
            <span>+ {formatNumber(recuperacaoStats.arquivados)} arquivados/perdidos</span>
            <span className={styles.funnelFooterHint}>
              fora do funil — {formatNumber(leads.length - recuperacaoStats.arquivados)} + {formatNumber(recuperacaoStats.arquivados)} = {formatNumber(leads.length)} leads da turma
            </span>
          </div>
        </Tile>

        <Tile title="PIPELINE EM ABERTO" subtitle="da turma, ainda em negociação">
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

      <button className={styles.toggleBtn} style={{ marginTop: 'var(--gap)' }} onClick={() => setVerMais(x => !x)}>
        {verMais
          ? '▲ ocultar detalhes da turma'
          : `▼ detalhes da turma · conversão ${formatPct(conversaoTurma.taxa)} (${formatNumber(conversaoTurma.fecharam)} de ${formatNumber(conversaoTurma.total)}) · potencial · arquivados`}
      </button>

      {verMais && <div className="tile-grid-4" style={{ marginTop: 'var(--gap)' }}>
        <Tile title="CONVERSÃO DA TURMA" subtitle="quantos já fecharam">
          <div style={{ textAlign: 'center', paddingTop: 12 }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--gold)' }}>
              {formatPct(conversaoTurma.taxa)}
            </div>
            <div className={styles.statLabel} style={{ marginTop: 4 }}>
              {formatNumber(conversaoTurma.fecharam)} de {formatNumber(conversaoTurma.total)} leads
            </div>
          </div>
        </Tile>

        <Tile
          title="ETIQUETA POTENCIAL DA TURMA"
          subtitle="o que aconteceu com os marcados"
          span={2}
          onClick={() => addCrossFilter('status', 'potencial')}
        >
          <div className={styles.statRow}>
            <div>
              <div className={styles.statBig} style={{ color: 'var(--gold)' }}>
                {formatNumber(potencialTurma.total)}
              </div>
              <div className={styles.statLabel}>marcados</div>
            </div>
            <div>
              <div className={styles.statBig} style={{ color: 'var(--positive)' }}>
                {formatNumber(potencialTurma.fecharam)}
              </div>
              <div className={styles.statLabel}>fecharam negócio</div>
            </div>
            <div>
              <div className={styles.statBig} style={{ color: 'var(--text-primary)' }}>
                {formatNumber(potencialTurma.emAndamento)}
              </div>
              <div className={styles.statLabel}>ainda em andamento</div>
            </div>
            <div>
              <div className={styles.statBig} style={{ color: 'var(--negative)' }}>
                {formatNumber(potencialTurma.perdidos)}
              </div>
              <div className={styles.statLabel}>arquivados/perdidos</div>
            </div>
            <div>
              <div className={styles.statBig} style={{ color: 'var(--text-primary)' }}>
                {formatPct(potencialTurma.taxaConv)}
              </div>
              <div className={styles.statLabel}>taxa de conversão</div>
            </div>
          </div>
        </Tile>

        <Tile title="ARQUIVADOS E RECUPERADOS" subtitle="da turma">
          <div className={styles.indicacoes}>
            <div className={styles.recRow}>
              <span className={styles.indLabel}>Arquivados</span>
              <span className={styles.indValue}>{formatNumber(recuperacaoStats.arquivados)}</span>
            </div>
            <div className={styles.recRow}>
              <span className={styles.indLabel}>↳ pelo corretor</span>
              <span className={styles.indValue}>{formatNumber(recuperacaoStats.porCorretor)}</span>
            </div>
            <div className={styles.recRow}>
              <span className={styles.indLabel}>↳ automático (15 dias sem atividade)</span>
              <span className={styles.indValue} style={{ color: 'var(--negative)' }}>
                {formatNumber(recuperacaoStats.automaticos)}
              </span>
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
      </div>}
    </div>
  )
}
