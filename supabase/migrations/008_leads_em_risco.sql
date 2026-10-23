-- 008 — última atividade registrada no C2S, base do "leads em risco".
-- O C2S arquiva sozinho após 15 dias sem atividade e não avisa antes. Guardando
-- last_activity_date em coluna própria dá para listar quem está prestes a morrer
-- e cobrar ANTES do prazo.
alter table public.leads add column if not exists ultima_atividade_em timestamptz;

-- Um trigger só, cuidando dos dois campos derivados do payload bruto
-- (substitui o trg_set_arquivado_por da migration 007).
create or replace function public.set_campos_derivados()
returns trigger language plpgsql as $$
declare bodies text;
begin
  new.ultima_atividade_em := nullif(new.raw->'attributes'->>'last_activity_date','')::timestamptz;

  if not coalesce(new.arquivado, false) then
    new.arquivado_por := null;
  else
    select lower(coalesce(string_agg(e->>'body',' | '),'')) into bodies
      from jsonb_array_elements(coalesce(new.raw->'attributes'->'log','[]'::jsonb)) e;
    if bodies like '%arquivou o lead%' or bodies like '%status foi alterado para arquivado por%' then
      new.arquivado_por := 'corretor';
    elsif bodies like '%arquivamento autom%' or bodies like '%atividades foram encerradas automaticamente%' then
      new.arquivado_por := 'automatico';
    else
      new.arquivado_por := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_set_arquivado_por on public.leads;
drop trigger if exists trg_set_campos_derivados on public.leads;
create trigger trg_set_campos_derivados before insert or update on public.leads
  for each row execute function public.set_campos_derivados();

update public.leads
set ultima_atividade_em = nullif(raw->'attributes'->>'last_activity_date','')::timestamptz
where ultima_atividade_em is distinct from nullif(raw->'attributes'->>'last_activity_date','')::timestamptz;

create index if not exists leads_ultima_atividade_idx on public.leads (ultima_atividade_em) where not arquivado;
