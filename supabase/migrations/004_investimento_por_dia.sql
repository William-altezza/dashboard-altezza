-- ============================================================
-- ALTEZZA DASHBOARD — Migração v4: Investimento por dia
-- Rodar no SQL Editor do Supabase
--
-- BUG: o KPI "Investimento" (gasto) usava a view investimento_por_mes,
-- que agrega por mês inteiro. O front-end (useInvestimentos) expandia
-- qualquer intervalo de datas selecionado para os limites do(s) mês(es)
-- tocados, então ao filtrar um único dia o gasto do MÊS INTEIRO era
-- somado em vez do gasto DAQUELE DIA.
--
-- FIX: view equivalente agregada por dia, para que o front-end possa
-- filtrar pelo intervalo de datas exato (sem expandir para o mês).
-- Mesma regra de precedência: valor manual prevalece sobre valor de
-- API no mesmo dia/canal.
-- ============================================================

create or replace view investimento_por_dia as
with api_diario as (
  select
    data as dia,
    canal,
    sum(valor) as valor_api,
    sum(valor_original) as valor_original_api,
    max(moeda) as moeda
  from investimentos
  where fonte = 'api'
  group by 1, 2
),
manual_diario as (
  select
    data as dia,
    canal,
    sum(valor) as valor_manual
  from investimentos
  where fonte = 'manual'
  group by 1, 2
)
select
  coalesce(a.dia, m.dia) as dia,
  coalesce(a.canal, m.canal) as canal,
  coalesce(m.valor_manual, a.valor_api, 0) as valor,
  a.moeda,
  a.valor_original_api,
  case
    when m.valor_manual is not null then 'manual'
    when a.valor_api    is not null then 'api'
    else null
  end as fonte_utilizada,
  case when m.valor_manual is not null and a.valor_api is not null
    then true else false
  end as tem_duplicidade
from api_diario a
full outer join manual_diario m
  on a.dia = m.dia and a.canal = m.canal;

-- RLS: views herdam da tabela base (investimentos), mas por segurança
-- garantimos leitura para autenticados explicitamente via grant.
grant select on investimento_por_dia to authenticated;
