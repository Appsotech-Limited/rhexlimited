-- Paystack sync: remembers when the vote count was last checked against Paystack,
-- so the automatic sync (netlify/lib/paystack-sync.mjs) runs at most every few minutes.
alter table public.debate_settings add column if not exists last_paystack_sync timestamptz;
notify pgrst, 'reload schema';

-- Automatic sync is off until an admin switches it on; by default differences are
-- reviewed on the admin "Paystack sync" page and applied there.
alter table public.debate_settings add column if not exists paystack_auto_sync boolean not null default false;
notify pgrst, 'reload schema';
