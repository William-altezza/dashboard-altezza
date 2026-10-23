-- 006 — data em que a etiqueta "Potencial" foi aplicada no C2S.
-- Permite contar "quem foi marcado como Potencial NESTE período" na Visão Geral,
-- em vez de depender da data de entrada do lead.
alter table public.leads add column if not exists tag_potencial_em timestamptz;

-- Backfill a partir do payload bruto já sincronizado.
update public.leads l
set tag_potencial_em = sub.marcado_em
from (
  select l2.id_lead, min((e->>'added_at')::timestamptz) as marcado_em
  from public.leads l2, jsonb_array_elements(coalesce(l2.raw->'attributes'->'tags','[]'::jsonb)) e
  where lower(trim(e->>'tag_name')) = 'potencial'
  group by 1
) sub
where sub.id_lead = l.id_lead
  and l.tag_potencial_em is distinct from sub.marcado_em;

create index if not exists leads_tag_potencial_em_idx on public.leads (tag_potencial_em);
