-- 007 — quem arquivou o lead: o corretor ou o próprio C2S.
-- O C2S arquiva sozinho por inatividade (15 dias sem atividade). Sem separar
-- os dois, "Arquivados" mistura descarte com abandono — e são problemas
-- diferentes: um é qualidade do lead, o outro é ritmo de atendimento.
alter table public.leads add column if not exists arquivado_por text;
alter table public.leads drop constraint if exists leads_arquivado_por_check;
alter table public.leads add constraint leads_arquivado_por_check
  check (arquivado_por is null or arquivado_por in ('corretor','automatico'));

-- Backfill a partir do log bruto do C2S.
update public.leads l set arquivado_por = sub.tipo
from (
  select id_lead,
    case
      when bool_or((e->>'body') ilike '%arquivou o lead%'
                or (e->>'body') ilike '%status foi alterado para Arquivado por%') then 'corretor'
      when bool_or((e->>'body') ilike '%Arquivamento autom%'
                or (e->>'body') ilike '%atividades foram encerradas automaticamente%') then 'automatico'
      else null
    end as tipo
  from public.leads l2
  left join lateral jsonb_array_elements(coalesce(l2.raw->'attributes'->'log','[]'::jsonb)) e on true
  where l2.arquivado
  group by 1
) sub
where sub.id_lead = l.id_lead and l.arquivado_por is distinct from sub.tipo;

create index if not exists leads_arquivado_por_idx on public.leads (arquivado_por);

-- Mantido por trigger (e não pela Edge Function) para nunca sair de sincronia
-- com o payload bruto: o sync faz upsert e o trigger recalcula a partir do log.
create or replace function public.set_arquivado_por()
returns trigger language plpgsql as $$
declare
  bodies text;
begin
  if not coalesce(new.arquivado, false) then
    new.arquivado_por := null;
    return new;
  end if;

  select lower(coalesce(string_agg(e->>'body', ' | '), ''))
    into bodies
  from jsonb_array_elements(coalesce(new.raw->'attributes'->'log', '[]'::jsonb)) e;

  if bodies like '%arquivou o lead%'
     or bodies like '%status foi alterado para arquivado por%' then
    new.arquivado_por := 'corretor';
  elsif bodies like '%arquivamento autom%'
     or bodies like '%atividades foram encerradas automaticamente%' then
    new.arquivado_por := 'automatico';
  else
    new.arquivado_por := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_set_arquivado_por on public.leads;
create trigger trg_set_arquivado_por
  before insert or update on public.leads
  for each row execute function public.set_arquivado_por();
