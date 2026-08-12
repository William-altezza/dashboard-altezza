-- ============================================================
-- ALTEZZA DASHBOARD — Schema completo v1
-- Rodar no SQL Editor do Supabase (como postgres / service_role)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Extensões
-- ────────────────────────────────────────────────────────────
-- pg_cron só disponível em planos pagos — habilitar via Dashboard em Database > Extensions se necessário
-- create extension if not exists "pg_cron" schema cron;
create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────
-- Tabela: leads
-- ────────────────────────────────────────────────────────────
create table if not exists leads (
  id_lead              text primary key,
  data_entrada         timestamptz not null,
  origem               text,
  canal                text,
  nome_cliente         text,
  telefone             text,
  pais_iso             text,
  regiao               text check (regiao in ('Brasil','América do Norte','Europa','Outros')),
  corretor             text,
  status_atual         text,
  funnel_status_atual  text check (funnel_status_atual in (
                         'new','in_attendance','scheduled_visit',
                         'done_visit','created_offer','converted','lost'
                       )),
  tags                 text[],
  valor_potencial      numeric,
  done_deal_at         timestamptz,
  valor_venda          numeric,
  arquivado            boolean default false,
  motivo_arquivamento  text,
  foi_recuperado       boolean default false,
  data_recuperacao     timestamptz,
  empreendimento       text,
  created_at_c2s       timestamptz,
  updated_at_c2s       timestamptz,
  raw                  jsonb,
  synced_at            timestamptz default now()
);

create index if not exists leads_data_entrada_idx     on leads (data_entrada);
create index if not exists leads_done_deal_at_idx     on leads (done_deal_at);
create index if not exists leads_corretor_idx         on leads (corretor);
create index if not exists leads_origem_idx           on leads (origem);
create index if not exists leads_regiao_idx           on leads (regiao);
create index if not exists leads_pais_iso_idx         on leads (pais_iso);
create index if not exists leads_funnel_status_idx    on leads (funnel_status_atual);
create index if not exists leads_arquivado_idx        on leads (arquivado);

-- ────────────────────────────────────────────────────────────
-- Tabela: lead_eventos
-- ────────────────────────────────────────────────────────────
create table if not exists lead_eventos (
  id            bigint generated always as identity primary key,
  id_lead       text references leads(id_lead) on delete cascade,
  status        text,
  funnel_status text,
  corretor      text,
  data_evento   timestamptz not null,
  unique (id_lead, funnel_status, data_evento)
);

create index if not exists lead_eventos_id_lead_idx   on lead_eventos (id_lead);
create index if not exists lead_eventos_data_idx      on lead_eventos (data_evento);

-- ────────────────────────────────────────────────────────────
-- Tabela: contas_anuncio
-- ────────────────────────────────────────────────────────────
create table if not exists contas_anuncio (
  id        text primary key,          -- act_XXXXXXXXX
  nome      text not null,
  ativa     boolean default true,
  criado_em timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Tabela: investimentos
-- ────────────────────────────────────────────────────────────
create table if not exists investimentos (
  id        bigint generated always as identity primary key,
  data      date not null,
  canal     text not null default 'Meta Ads',
  conta_id  text references contas_anuncio(id),
  valor     numeric not null,
  fonte     text not null check (fonte in ('api','manual')),
  unique (data, canal, conta_id, fonte)
);

create index if not exists investimentos_data_idx on investimentos (data);

-- ────────────────────────────────────────────────────────────
-- Tabela: custos
-- ────────────────────────────────────────────────────────────
create table if not exists custos (
  id        bigint generated always as identity primary key,
  mes       date not null,
  tipo      text not null check (tipo in ('fixo','variavel')),
  descricao text,
  valor     numeric not null
);

create index if not exists custos_mes_idx on custos (mes);

-- ────────────────────────────────────────────────────────────
-- Tabela: metas
-- ────────────────────────────────────────────────────────────
create table if not exists metas (
  chave text primary key,
  valor numeric
);

insert into metas (chave, valor) values
  ('pct_compradores_que_indicam', 40),
  ('pct_conversao_indicacao', 50)
on conflict (chave) do nothing;

-- ────────────────────────────────────────────────────────────
-- Tabela: sync_log
-- ────────────────────────────────────────────────────────────
create table if not exists sync_log (
  id                  bigint generated always as identity primary key,
  tipo                text check (tipo in ('full_load','incremental','meta_diario')),
  iniciado_em         timestamptz,
  finalizado_em       timestamptz,
  registros           integer,
  ultimo_updated_gte  timestamptz,
  status              text check (status in ('running','completed','error')),
  erro                text
);

-- ────────────────────────────────────────────────────────────
-- Tabela: data_quality_issues
-- ────────────────────────────────────────────────────────────
create table if not exists data_quality_issues (
  id        bigint generated always as identity primary key,
  id_lead   text,
  problema  text,
  detalhe   jsonb,
  criado_em timestamptz default now()
);

create index if not exists dqi_id_lead_idx on data_quality_issues (id_lead);
create index if not exists dqi_criado_idx  on data_quality_issues (criado_em);

-- ────────────────────────────────────────────────────────────
-- Tabela: perfis (roles por usuário)
-- ────────────────────────────────────────────────────────────
create table if not exists perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  email     text,
  role      text not null default 'viewer' check (role in ('admin','viewer')),
  criado_em timestamptz default now()
);

-- Trigger: criar perfil automaticamente ao signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.perfis (id, email, role)
  values (
    new.id,
    new.email,
    case
      when new.email in (
        'altezzanegociosimobiliarios@gmail.com',
        'eduardo@altezza.com.br'
      ) then 'admin'
      else 'viewer'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ────────────────────────────────────────────────────────────
-- RLS — Row Level Security
-- ────────────────────────────────────────────────────────────
alter table leads              enable row level security;
alter table lead_eventos       enable row level security;
alter table contas_anuncio     enable row level security;
alter table investimentos      enable row level security;
alter table custos             enable row level security;
alter table metas              enable row level security;
alter table sync_log           enable row level security;
alter table data_quality_issues enable row level security;
alter table perfis             enable row level security;

-- Função auxiliar para checar role
create or replace function get_my_role()
returns text language sql security definer stable as $$
  select role from public.perfis where id = auth.uid();
$$;

-- Leitura: qualquer autenticado
create policy "leitura autenticados" on leads
  for select to authenticated using (true);

create policy "leitura autenticados" on lead_eventos
  for select to authenticated using (true);

create policy "leitura autenticados" on contas_anuncio
  for select to authenticated using (true);

create policy "leitura autenticados" on investimentos
  for select to authenticated using (true);

create policy "leitura autenticados" on custos
  for select to authenticated using (true);

create policy "leitura autenticados" on metas
  for select to authenticated using (true);

create policy "leitura autenticados" on sync_log
  for select to authenticated using (true);

create policy "leitura autenticados" on data_quality_issues
  for select to authenticated using (true);

create policy "leitura próprio perfil" on perfis
  for select to authenticated using (id = auth.uid());

-- Escrita restrita a admins
create policy "admin escreve leads" on leads
  for update to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');

create policy "admin gerencia investimentos" on investimentos
  for all to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');

create policy "admin gerencia custos" on custos
  for all to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');

create policy "admin gerencia metas" on metas
  for all to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');

create policy "admin gerencia contas anuncio" on contas_anuncio
  for all to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');

-- ────────────────────────────────────────────────────────────
-- Função: marcar recuperação de arquivados
-- ────────────────────────────────────────────────────────────
create or replace function marcar_recuperados()
returns void language plpgsql security definer as $$
begin
  update leads l
  set
    foi_recuperado   = true,
    data_recuperacao = sub.data_evento
  from (
    select distinct on (e.id_lead)
      e.id_lead,
      e.data_evento
    from lead_eventos e
    where e.funnel_status not in ('lost')
      and exists (
        select 1 from lead_eventos e2
        where e2.id_lead = e.id_lead
          and e2.funnel_status = 'lost'
          and e2.data_evento < e.data_evento
      )
    order by e.id_lead, e.data_evento
  ) sub
  where l.id_lead = sub.id_lead
    and (l.foi_recuperado = false or l.foi_recuperado is null);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- View auxiliar: investimento_por_mes
-- Lógica: manual prevalece sobre api no mesmo mês
-- ────────────────────────────────────────────────────────────
create or replace view investimento_por_mes as
with api_mensal as (
  select
    date_trunc('month', data)::date as mes,
    canal,
    sum(valor) as valor_api
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
