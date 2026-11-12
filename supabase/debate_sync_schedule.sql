-- Runs the Paystack sync every 5 minutes, even when nobody has the site open.
-- Cloudflare Pages has no scheduler, so Supabase's pg_cron calls the site's
-- /api/debate/sync endpoint (netlify/functions/debate-sync.mjs) through pg_net.
-- Run once in Supabase → SQL Editor after debate_paystack_sync.sql. Safe to run again.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- The admin switch for automatic sync (from debate_paystack_sync.sql), switched on.
alter table public.debate_settings add column if not exists paystack_auto_sync boolean not null default false;
update public.debate_settings set paystack_auto_sync = true where id = 1;
notify pgrst, 'reload schema';

-- (Re)create the schedule.
select cron.unschedule(jobid) from cron.job where jobname = 'rhex-paystack-sync';
select cron.schedule(
  'rhex-paystack-sync',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://rhexlimited.com/api/debate/sync',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 25000
     ); $$
);

-- To pause: switch off "sync automatically" in Admin → Paystack sync (the job then does nothing),
-- or remove the schedule entirely with:
--   select cron.unschedule('rhex-paystack-sync');
