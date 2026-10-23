-- Inferência de país pelo DDI quando a biblioteca de telefone não reconhece o
-- número (ex.: +30 6xx Grécia, +61 4xx Austrália, +244 Angola). Só preenche
-- quando pais_iso está vazio; nunca sobrescreve um país já identificado.

create table if not exists ddi_pais (
  ddi    text primary key,
  iso    text not null,
  regiao text not null
);

insert into ddi_pais (ddi, iso, regiao) values
  ('30','GR','Europa'),('31','NL','Europa'),('32','BE','Europa'),('33','FR','Europa'),
  ('34','ES','Europa'),('351','PT','Europa'),('352','LU','Europa'),('353','IE','Europa'),
  ('354','IS','Europa'),('355','AL','Europa'),('356','MT','Europa'),('357','CY','Europa'),
  ('358','FI','Europa'),('359','BG','Europa'),('36','HU','Europa'),('370','LT','Europa'),
  ('371','LV','Europa'),('372','EE','Europa'),('380','UA','Europa'),('381','RS','Europa'),
  ('383','XK','Europa'),('385','HR','Europa'),('386','SI','Europa'),('39','IT','Europa'),
  ('40','RO','Europa'),('41','CH','Europa'),('420','CZ','Europa'),('421','SK','Europa'),
  ('43','AT','Europa'),('44','GB','Europa'),('45','DK','Europa'),('46','SE','Europa'),
  ('47','NO','Europa'),('48','PL','Europa'),('49','DE','Europa'),
  ('55','BR','Brasil'),
  ('7','RU','Outros'),('20','EG','Outros'),('27','ZA','Outros'),
  ('51','PE','Outros'),('52','MX','Outros'),('53','CU','Outros'),('54','AR','Outros'),
  ('56','CL','Outros'),('57','CO','Outros'),('58','VE','Outros'),('591','BO','Outros'),
  ('593','EC','Outros'),('595','PY','Outros'),('598','UY','Outros'),
  ('61','AU','Outros'),('62','ID','Outros'),('63','PH','Outros'),('64','NZ','Outros'),
  ('65','SG','Outros'),('66','TH','Outros'),('81','JP','Outros'),('82','KR','Outros'),
  ('84','VN','Outros'),('86','CN','Outros'),('90','TR','Outros'),('91','IN','Outros'),
  ('92','PK','Outros'),('98','IR','Outros'),
  ('212','MA','Outros'),('213','DZ','Outros'),('216','TN','Outros'),('234','NG','Outros'),
  ('235','TD','Outros'),('238','CV','Outros'),('244','AO','Outros'),('258','MZ','Outros'),
  ('961','LB','Outros'),('962','JO','Outros'),('963','SY','Outros'),('965','KW','Outros'),
  ('966','SA','Outros'),('968','OM','Outros'),('971','AE','Outros'),('972','IL','Outros'),
  ('973','BH','Outros'),('974','QA','Outros')
on conflict (ddi) do nothing;

alter table ddi_pais enable row level security;
drop policy if exists "leitura autenticados" on ddi_pais;
create policy "leitura autenticados" on ddi_pais for select to authenticated using (true);

create or replace function inferir_pais_por_ddi(tel text)
returns table (iso text, regiao text)
language sql stable as $$
  select d.iso, d.regiao
  from ddi_pais d
  where regexp_replace(coalesce(tel,''), '\D', '', 'g') like d.ddi || '%'
  order by length(d.ddi) desc
  limit 1
$$;

create or replace function trg_leads_inferir_pais()
returns trigger language plpgsql as $$
declare r record;
begin
  if new.pais_iso is null and new.telefone is not null and new.telefone <> '' then
    select * into r from inferir_pais_por_ddi(new.telefone);
    if found then
      new.pais_iso := r.iso;
      new.regiao   := r.regiao;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists leads_inferir_pais on leads;
create trigger leads_inferir_pais
  before insert or update on leads
  for each row execute function trg_leads_inferir_pais();

-- Backfill dos leads existentes sem país
update leads
set pais_iso = (select iso    from inferir_pais_por_ddi(leads.telefone)),
    regiao   = (select regiao from inferir_pais_por_ddi(leads.telefone))
where pais_iso is null
  and telefone is not null and telefone <> ''
  and exists (select 1 from inferir_pais_por_ddi(leads.telefone));
