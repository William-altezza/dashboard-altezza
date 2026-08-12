-- ============================================================
-- ALTEZZA DASHBOARD — Agendamento de Edge Functions
-- Rodar no SQL Editor do Supabase
-- ============================================================

-- Habilita extensões (necessário 1x)
create extension if not exists pg_net   schema extensions;
create extension if not exists pg_cron  schema cron;

-- ── Constante: service_role key (usada nos headers das chamadas HTTP) ──────
-- Substitua <SERVICE_ROLE_KEY> pelo valor real antes de rodar
-- (já está no .env como SUPABASE_SERVICE_ROLE_KEY)

-- ── Job 1: sync-c2s a cada 15 minutos ────────────────────────────────────
select cron.schedule(
  'sync-c2s-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://vcevemqztyaupbhewjrg.supabase.co/functions/v1/sync-c2s',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZXZlbXF6dHlhdXBiaGV3anJnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzM3NzQ1NSwiZXhwIjoyMDk4OTUzNDU1fQ.OWVTMT7UE0NmapnULiLlmoN5rC0xvkls2uhBTWRYKAU',
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- ── Job 2: sync-meta diário às 03:00 (horário UTC = 00:00 BRT) ───────────
select cron.schedule(
  'sync-meta-diario',
  '0 3 * * *',
  $$
  select net.http_post(
    url     := 'https://vcevemqztyaupbhewjrg.supabase.co/functions/v1/sync-meta',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZXZlbXF6dHlhdXBiaGV3anJnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzM3NzQ1NSwiZXhwIjoyMDk4OTUzNDU1fQ.OWVTMT7UE0NmapnULiLlmoN5rC0xvkls2uhBTWRYKAU',
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- ── Verificar jobs criados ────────────────────────────────────────────────
select jobname, schedule, active from cron.job order by jobid;
