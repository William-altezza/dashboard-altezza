-- Liga cada lead do C2S ao anúncio do Meta que o gerou.
-- O C2S guarda o ID exato do anúncio em raw.facebook_attributes.ad_id.

alter table leads add column if not exists meta_ad_id text;
create index if not exists leads_meta_ad_id_idx on leads (meta_ad_id) where meta_ad_id is not null;

create or replace function trg_leads_meta_ad_id()
returns trigger language plpgsql set search_path = public as $$
begin
  new.meta_ad_id := nullif(new.raw->'facebook_attributes'->>'ad_id', '');
  return new;
end $$;

drop trigger if exists leads_meta_ad_id on leads;
create trigger leads_meta_ad_id
  before insert or update on leads
  for each row execute function trg_leads_meta_ad_id();

update leads set meta_ad_id = nullif(raw->'facebook_attributes'->>'ad_id', '')
where raw->'facebook_attributes'->>'ad_id' is not null
  and meta_ad_id is distinct from nullif(raw->'facebook_attributes'->>'ad_id','');

-- Anúncios citados por leads que ainda não estão espelhados (usado pela
-- função sync-meta-anuncios-leads).
create or replace function anuncios_de_leads_faltando(limite int default 150)
returns table (ad_id text)
language sql stable set search_path = public as $$
  select distinct l.meta_ad_id
  from leads l
  where l.meta_ad_id is not null
    and not exists (select 1 from meta_anuncios a where a.ad_id = l.meta_ad_id)
  limit limite
$$;
revoke all on function anuncios_de_leads_faltando(int) from public, anon, authenticated;
grant execute on function anuncios_de_leads_faltando(int) to service_role;
