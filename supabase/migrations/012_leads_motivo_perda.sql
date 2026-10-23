-- Motivo de perda/arquivamento do C2S (raw.attributes.lost_reasons.name),
-- como coluna própria. Reaproveita o trigger que já extrai meta_ad_id.
alter table leads add column if not exists motivo_perda text;

create or replace function trg_leads_meta_ad_id()
returns trigger language plpgsql set search_path = public as $$
begin
  new.meta_ad_id   := nullif(new.raw->'facebook_attributes'->>'ad_id', '');
  new.motivo_perda := nullif(new.raw->'attributes'->'lost_reasons'->>'name', '');
  return new;
end $$;

update leads set motivo_perda = nullif(raw->'attributes'->'lost_reasons'->>'name', '')
where motivo_perda is distinct from nullif(raw->'attributes'->'lost_reasons'->>'name', '');
