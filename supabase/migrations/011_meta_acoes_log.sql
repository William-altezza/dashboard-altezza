-- Histórico das ações feitas no Meta pelo dashboard (pausar/ativar/orçamento).
create table if not exists meta_acoes_log (
  id bigserial primary key,
  criado_em timestamptz default now(),
  usuario text,
  tipo text not null,          -- campanha | conjunto | anuncio
  alvo_id text not null,
  alvo_nome text,
  acao text not null,          -- pausar | ativar | orcamento
  antes text,
  depois text,
  ok boolean not null default false,
  erro text
);
alter table meta_acoes_log enable row level security;
drop policy if exists "admins leem log" on meta_acoes_log;
create policy "admins leem log" on meta_acoes_log for select to authenticated
  using (exists (select 1 from perfis p where p.id = auth.uid() and p.role = 'admin'));
