// ────────────────────────────────────────────────────────────
// Etapas do funil exibidas no dashboard.
//
// "Potencial" não é um funnel_status_atual real do C2S — é uma
// etiqueta (tag) que os corretores aplicam a leads que ainda estão
// "Em Atendimento" mas já demonstraram interesse forte. Pedido do
// Eduardo: mostrar como uma etapa própria do funil, entre
// "Em Atendimento" e "Visita Agendada".
//
// Leads que já avançaram para Visita Agendada/Realizada/Proposta/
// Fechado NÃO "voltam" para a etapa Potencial na visualização —
// eles continuam na etapa real deles, mesmo que também tenham a tag
// (o que é o comportamento normal: a tag costuma ficar no lead à
// medida que ele avança). Isso evita contar o mesmo lead 2x no funil.
// ────────────────────────────────────────────────────────────

export const FUNNEL_STAGES = [
  { key: 'new',             label: 'Novo Lead' },
  { key: 'in_attendance',   label: 'Em Atendimento' },
  { key: 'potencial',       label: 'Potencial' },
  { key: 'scheduled_visit', label: 'Visita Agendada' },
  { key: 'done_visit',      label: 'Visita Realizada' },
  { key: 'created_offer',   label: 'Proposta' },
  { key: 'converted',       label: 'Fechado' },
]

function normalizeTag(t) {
  return (t || '').trim().toLowerCase()
}

export function hasTagPotencial(lead) {
  return (lead?.tags || []).some(t => normalizeTag(t) === 'potencial')
}

// Indicação: a Altezza marca no C2S com a etiqueta "Indicação" (a origem do
// lead pode continuar sendo "Instagram Leads" etc). Mantém também o caso
// antigo em que a própria origem diz "indicação".
export function isIndicacao(lead) {
  const tag = (lead?.tags || []).some(t => normalizeTag(t).startsWith('indica'))
  const origem = (lead?.origem || '').toLowerCase().includes('indica')
  return tag || origem
}

// Motivos de perda do C2S (códigos internos → português).
const MOTIVOS_PERDA = {
  inactive:              'Sem atividade',
  return_delay:          'Não retornou',
  fail_to_contact:       'Sem contato',
  invalid:               'Contato inválido',
  just_researching:      'Só pesquisando',
  without_qualification: 'Sem qualificação',
  bought_elsewhere:      'Comprou em outro lugar',
  high_price:            'Preço alto',
  not_ready_to_buy:      'Ainda não quer comprar',
  bad_localization:      'Localização',
  underprivileged:       'Sem perfil financeiro',
  partner_agent:         'Corretor parceiro',
  impossible_proposal:   'Proposta inviável',
  z_others:              'Outros',
}

// Texto curto do motivo de arquivamento, ou null se o lead não foi arquivado.
export function motivoPerdaLabel(lead) {
  if (lead?.funnel_status_atual !== 'lost' && !lead?.arquivado) return null
  const base = MOTIVOS_PERDA[lead.motivo_perda] || (lead.motivo_perda ? lead.motivo_perda : 'Motivo não informado')
  return lead.arquivado_por === 'automatico' ? `${base} · automático` : base
}

// Etapa "efetiva" de um lead para fins de visualização do funil.
export function effectiveStage(lead) {
  if (lead.funnel_status_atual === 'in_attendance' && hasTagPotencial(lead)) {
    return 'potencial'
  }
  return lead.funnel_status_atual
}
