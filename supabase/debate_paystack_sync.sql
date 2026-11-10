-- Paystack sync: remembers when the vote count was last checked against Paystack,
-- so the automatic sync (netlify/lib/paystack-sync.mjs) runs at most every few minutes.
alter table public.debate_settings add column if not exists last_paystack_sync timestamptz;
notify pgrst, 'reload schema';
