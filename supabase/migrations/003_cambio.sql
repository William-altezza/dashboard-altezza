-- ============================================================
-- ALTEZZA DASHBOARD — Migração v3: Câmbio USD→BRL
-- Rodar no SQL Editor do Supabase
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Tabela: cambio
-- Taxa PTAX diária (USD→BRL) do Banco Central
-- ────────────────────────────────────────────────────────────
create table if not exists cambio (
  data  date  not null,
  moeda text  not null default 'USD',
  taxa  numeric not null,
  fonte text  not null default 'ptax',
  primary key (data, moeda)
);

create index if not exists cambio_data_idx on cambio (data);

-- RLS
alter table cambio enable row level security;
create policy "leitura autenticados" on cambio
  for select to authenticated using (true);
create policy "service role escreve cambio" on cambio
  for all using (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- Novas colunas em investimentos
-- valor       = BRL (após conversão)
-- valor_original = valor na moeda original (USD se conta em USD)
-- moeda       = moeda da conta (USD ou BRL)
-- taxa_cambio = taxa PTAX do dia
-- ────────────────────────────────────────────────────────────
alter table investimentos
  add column if not exists moeda          text,
  add column if not exists valor_original numeric,
  add column if not exists taxa_cambio    numeric;

-- ────────────────────────────────────────────────────────────
-- Nova coluna em contas_anuncio: moeda detectada via Meta API
-- ────────────────────────────────────────────────────────────
alter table contas_anuncio
  add column if not exists moeda text default 'BRL';

-- ────────────────────────────────────────────────────────────
-- Atualiza a view investimento_por_mes (sem mudança de lógica —
-- campo valor já é BRL após conversão)
-- ────────────────────────────────────────────────────────────
create or replace view investimento_por_mes as
with api_mensal as (
  select
    date_trunc('month', data)::date as mes,
    canal,
    sum(valor) as valor_api,
    sum(valor_original) as valor_original_api,
    max(moeda) as moeda
  from investimentos
  where fonte = 'api'
  group by 1, 2
),
manual_mensal as (
  select
    date_trunc('month', data)::date as mes,
    canal,
    sum(valor) as valor_manual
  from investimentos
  where fonte = 'manual'
  group by 1, 2
)
select
  coalesce(a.mes, m.mes) as mes,
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
from api_mensal a
full outer join manual_mensal m
  on a.mes = m.mes and a.canal = m.canal;

-- ────────────────────────────────────────────────────────────
-- Função auxiliar: buscar taxa de câmbio com fallback
-- (usada pelo Edge Function e backfill)
-- ────────────────────────────────────────────────────────────
create or replace function get_taxa_cambio(p_data date, p_moeda text default 'USD')
returns numeric language sql stable as $$
  select taxa
  from cambio
  where moeda = p_moeda
    and data <= p_data
  order by data desc
  limit 1;
$$;
