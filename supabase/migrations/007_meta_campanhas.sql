-- Espelho das campanhas do Meta Ads (nível campanha, por dia).

create table if not exists meta_campanhas (
  campaign_id       text primary key,
  conta_id          text not null,
  nome              text,
  objetivo          text,
  status            text,
  status_efetivo    text,
  orcamento_diario  numeric,
  orcamento_total   numeric,
  atualizado_em     timestamptz default now()
);

create table if not exists meta_campanhas_dia (
  data         date not null,
  campaign_id  text not null,
  conta_id     text not null,
  nome         text,
  moeda        text,
  gasto        numeric default 0,   -- na moeda da conta
  gasto_brl    numeric default 0,
  impressoes   bigint  default 0,
  alcance      bigint  default 0,
  cliques      bigint  default 0,
  cliques_link bigint  default 0,
  leads        integer default 0,   -- formulários / leads nativos
  conversas    integer default 0,   -- conversas iniciadas (WhatsApp/Direct)
  primary key (data, campaign_id)
);

create index if not exists meta_campanhas_dia_data_idx on meta_campanhas_dia (data);

alter table meta_campanhas     enable row level security;
alter table meta_campanhas_dia enable row level security;
drop policy if exists "leitura autenticados" on meta_campanhas;
drop policy if exists "leitura autenticados" on meta_campanhas_dia;
create policy "leitura autenticados" on meta_campanhas     for select to authenticated using (true);
create policy "leitura autenticados" on meta_campanhas_dia for select to authenticated using (true);
