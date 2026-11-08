-- RHEX Reality Debate Show: admin features v2.
-- Payment details, voids, manual vote adjustments, show settings (voting open/close,
-- hidden leaderboard, rounds), eliminations, audit log, voters view.
-- Run once in Supabase → SQL Editor after debate_votes.sql and debate_admin.sql. Safe to run again.

-- 1. Richer payment records -------------------------------------------------
alter table public.debate_votes
  add column if not exists source          text not null default 'webhook', -- webhook | requery
  add column if not exists voter_name      text,
  add column if not exists phone           text,
  add column if not exists channel         text,     -- card, bank_transfer, ussd, ...
  add column if not exists paystack_id     bigint,
  add column if not exists fees_kobo       bigint,
  add column if not exists gateway_response text,
  add column if not exists ip_address      text,
  add column if not exists card            text,     -- e.g. "visa ·· 4081 (GTBank)"
  add column if not exists flags           text[] not null default '{}',
  add column if not exists voided          boolean not null default false,
  add column if not exists void_reason     text,
  add column if not exists voided_at       timestamptz;
create index if not exists debate_votes_email_idx   on public.debate_votes (lower(email));
create index if not exists debate_votes_paid_at_idx on public.debate_votes (paid_at desc);

-- 2. Manual vote adjustments (+ or -, always with a reason) ----------------
create table if not exists public.debate_vote_adjustments (
  id                bigint generated always as identity primary key,
  contestant_number text        not null,
  votes             integer     not null check (votes <> 0),
  reason            text        not null check (length(trim(reason)) > 0),
  created_at        timestamptz not null default now()
);

-- 3. Show settings (one row) ------------------------------------------------
create table if not exists public.debate_settings (
  id                 integer primary key default 1 check (id = 1),
  voting_open        boolean     not null default true,
  closed_message     text,
  tally_hidden       boolean     not null default false,
  leaderboard_scope  text        not null default 'total' check (leaderboard_scope in ('total', 'round')),
  round_name         text,
  round_started_at   timestamptz,
  updated_at         timestamptz not null default now()
);
insert into public.debate_settings (id) values (1) on conflict (id) do nothing;

-- 4. Eliminations ----------------------------------------------------------
alter table public.debate_contestants
  add column if not exists eliminated     boolean not null default false,
  add column if not exists eliminated_at  timestamptz,
  add column if not exists eliminated_round text;

-- 5. Audit log -------------------------------------------------------------
create table if not exists public.debate_admin_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  action     text        not null,
  target     text,
  details    jsonb,
  ip         text,
  user_agent text
);
create index if not exists debate_admin_log_at_idx on public.debate_admin_log (at desc);

-- 6. Totals: valid payments + adjustments, optionally since a time (a round) --
create or replace function public.debate_totals(since timestamptz default null)
returns table (contestant_number text, votes bigint, amount_kobo bigint, payments bigint, adjustment bigint)
language sql stable security invoker set search_path = public as $$
  select n, sum(v)::bigint, sum(a)::bigint, sum(p)::bigint, sum(adj)::bigint from (
    select contestant_number as n, votes as v, amount_kobo as a, 1 as p, 0 as adj
      from debate_votes where not voided and (since is null or paid_at >= since)
    union all
    select contestant_number, votes, 0, 0, votes
      from debate_vote_adjustments where since is null or created_at >= since
  ) x group by n;
$$;

-- Keep the old view name working (all-time totals).
create or replace view public.debate_vote_totals with (security_invoker = true) as
  select contestant_number, votes, amount_kobo, payments from public.debate_totals(null);

-- 7. Voters (one row per email) ---------------------------------------------
create or replace view public.debate_voters with (security_invoker = true) as
  select lower(email)                                   as email,
         (array_agg(voter_name order by paid_at desc) filter (where voter_name is not null))[1] as name,
         (array_agg(phone order by paid_at desc) filter (where phone is not null))[1]           as phone,
         count(*)::bigint                               as payments,
         sum(votes)::bigint                             as votes,
         sum(amount_kobo)::bigint                       as amount_kobo,
         array_agg(distinct contestant_number)          as contestants,
         min(paid_at)                                   as first_paid,
         max(paid_at)                                   as last_paid,
         bool_or(cardinality(flags) > 0)                as flagged
  from public.debate_votes
  where not voided and email is not null
  group by lower(email);

-- 8. Lock everything down: only the server (service_role) can read or write. --
alter table public.debate_vote_adjustments enable row level security;
alter table public.debate_settings         enable row level security;
alter table public.debate_admin_log        enable row level security;
revoke all on public.debate_vote_adjustments from anon, authenticated;
revoke all on public.debate_settings         from anon, authenticated;
revoke all on public.debate_admin_log        from anon, authenticated;
revoke all on public.debate_vote_totals      from anon, authenticated;
revoke all on public.debate_voters           from anon, authenticated;
revoke execute on function public.debate_totals(timestamptz) from public, anon, authenticated;
grant execute on function public.debate_totals(timestamptz) to service_role;
grant select on public.debate_vote_totals, public.debate_voters to service_role;
