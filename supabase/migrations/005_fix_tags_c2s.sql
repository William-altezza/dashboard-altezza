-- ============================================================
-- ALTEZZA DASHBOARD — Migração v5: Corrige parsing de tags do C2S
-- Rodar no SQL Editor do Supabase
--
-- BUG: scripts/full-load.js e a Edge Function sync-c2s liam `t.name`
-- das tags vindas do C2S, mas a API retorna o campo `tag_name` (não
-- `name`). Resultado: leads.tags ficava com o JSON inteiro de cada
-- tag stringificado — ex.:
--   '{"id":123,"tag_id":47090,"tag_name":"Potencial ","added_at":"..."}'
-- em vez do nome limpo da etiqueta (ex.: 'Potencial'). Isso afetava
-- TODAS as etiquetas do C2S, não só "Potencial" — qualquer filtro ou
-- lógica baseada em tags nunca funcionava.
--
-- FIX: reconstrói leads.tags a partir do JSON já salvo em leads.raw
-- (sem precisar rechamar a API do C2S). O código-fonte (full-load.js
-- e sync-c2s/index.ts) também foi corrigido para não repetir o bug
-- nos próximos syncs.
-- ============================================================

update leads l
set tags = coalesce(sub.tags_corrigidas, '{}')
from (
  select
    l2.id_lead,
    array_agg(distinct trim(t->>'tag_name'))
      filter (where trim(t->>'tag_name') <> '') as tags_corrigidas
  from leads l2
  cross join lateral jsonb_array_elements(coalesce(l2.raw->'attributes'->'tags', '[]'::jsonb)) as t
  group by l2.id_lead
) sub
where l.id_lead = sub.id_lead;
