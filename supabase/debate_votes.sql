-- RHEX Reality Debate Show (The President): vote storage.
-- Run once in Supabase → SQL Editor → New query → paste → Run.

create table if not exists public.debate_votes (
  reference          text primary key,          -- Paystack reference, so a payment can only count once
  contestant_number  text        not null,
  votes              integer     not null check (votes > 0),
  amount_kobo        bigint      not null check (amount_kobo > 0),
  email              text,
  paid_at            timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists debate_votes_contestant_idx on public.debate_votes (contestant_number);

create or replace view public.debate_vote_totals as
  select contestant_number,
         sum(votes)::bigint        as votes,
         sum(amount_kobo)::bigint  as amount_kobo,
         count(*)::bigint          as payments
  from public.debate_votes
  group by contestant_number;

-- Lock it down: only the server (service_role key, used by the Netlify functions) can read or write.
alter table public.debate_votes enable row level security;
revoke all on public.debate_votes       from anon, authenticated;
revoke all on public.debate_vote_totals from anon, authenticated;
