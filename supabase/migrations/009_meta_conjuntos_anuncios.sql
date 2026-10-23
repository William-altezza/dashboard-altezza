-- Espelho do Meta Ads: conjuntos de anúncios e anúncios (cadastro + métricas por dia).

create table if not exists meta_conjuntos (
  adset_id text primary key, campaign_id text not null, conta_id text not null, nome text,
  status_efetivo text, orcamento_diario numeric, otimizacao text, atualizado_em timestamptz default now()
);
create table if not exists meta_anuncios (
  ad_id text primary key, adset_id text, campaign_id text not null, conta_id text not null, nome text,
  status_efetivo text, thumbnail_url text, atualizado_em timestamptz default now()
);
create table if not exists meta_conjuntos_dia (
  data date not null, adset_id text not null, campaign_id text not null, conta_id text not null,
  nome text, gasto_brl numeric default 0, impressoes bigint default 0, alcance bigint default 0,
  cliques_link bigint default 0, leads integer default 0, conversas integer default 0,
  primary key (data, adset_id)
);
create table if not exists meta_anuncios_dia (
  data date not null, ad_id text not null, adset_id text, campaign_id text not null, conta_id text not null,
  nome text, gasto_brl numeric default 0, impressoes bigint default 0, alcance bigint default 0,
  cliques_link bigint default 0, leads integer default 0, conversas integer default 0,
  primary key (data, ad_id)
);
create index if not exists mcd_camp_idx on meta_conjuntos_dia (campaign_id, data);
create index if not exists mad_adset_idx on meta_anuncios_dia (adset_id, data);

alter table meta_conjuntos enable row level security;
alter table meta_anuncios enable row level security;
alter table meta_conjuntos_dia enable row level security;
alter table meta_anuncios_dia enable row level security;
create policy "leitura autenticados" on meta_conjuntos for select to authenticated using (true);
create policy "leitura autenticados" on meta_anuncios for select to authenticated using (true);
create policy "leitura autenticados" on meta_conjuntos_dia for select to authenticated using (true);
create policy "leitura autenticados" on meta_anuncios_dia for select to authenticated using (true);
