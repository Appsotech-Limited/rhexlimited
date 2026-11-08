-- RHEX Reality Debate Show: contestants table, photo storage and admin login throttle.
-- Run once in Supabase → SQL Editor after debate_votes.sql. Safe to run again.

create table if not exists public.debate_contestants (
  number      text primary key check (number ~ '^[A-Za-z0-9-]{1,20}$'),
  name        text        not null check (length(trim(name)) between 1 and 120),
  photo       text,                 -- portrait (4:5): a full URL, or a site path like assets/contestants/1120.jpg
  poster      text,                 -- optional square poster for WhatsApp/Facebook previews
  message     text,                 -- optional appeal; blank line between paragraphs
  active      boolean     not null default true,  -- false hides the contestant from the public pages (votes are kept)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Failed admin logins, used to slow down password guessing.
create table if not exists public.debate_admin_login_failures (
  id         bigint generated always as identity primary key,
  ip         text        not null,
  at         timestamptz not null default now()
);
create index if not exists debate_admin_login_failures_ip_at on public.debate_admin_login_failures (ip, at);

-- Only the server (service_role key, used by the Netlify functions) can read or write.
alter table public.debate_contestants          enable row level security;
alter table public.debate_admin_login_failures enable row level security;
revoke all on public.debate_contestants          from anon, authenticated;
revoke all on public.debate_admin_login_failures from anon, authenticated;

-- Public bucket for contestant photos. Uploads go through the admin function only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('debate-contestants', 'debate-contestants', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Starting list (the contestants that were in debate/data/contestants.js).
insert into public.debate_contestants (number, name, photo, poster) values
  ('1111', 'Blessing Ajayi', 'assets/contestants/1111.jpg', 'assets/contestants/1111-poster.jpg'),
  ('1112', 'Ikedichukwu Eze', 'assets/contestants/1112.jpg', 'assets/contestants/1112-poster.jpg'),
  ('1113', 'Titoluwani Coker', 'assets/contestants/1113.jpg', 'assets/contestants/1113-poster.jpg'),
  ('1114', 'Karen Olajuyin', 'assets/contestants/1114.jpg', 'assets/contestants/1114-poster.jpg'),
  ('1115', 'Miracle Ibrahim', 'assets/contestants/1115.jpg', 'assets/contestants/1115-poster.jpg'),
  ('1116', 'Delpina Andrew', 'assets/contestants/1116.jpg', 'assets/contestants/1116-poster.jpg'),
  ('1117', 'Hilary Solomon', 'assets/contestants/1117.jpg', null),
  ('1118', 'Daniella Adejo', 'assets/contestants/1118.jpg', 'assets/contestants/1118-poster.jpg'),
  ('1119', 'Doxa Oyetunde', 'assets/contestants/1119.jpg', 'assets/contestants/1119-poster.jpg'),
  ('1120', 'Splendour Ogbabede', 'assets/contestants/1120.jpg', 'assets/contestants/1120-poster.jpg'),
  ('1121', 'Cyril Ojonugwa Fidelis', 'assets/contestants/1121.jpg', 'assets/contestants/1121-poster.jpg'),
  ('1122', 'Hyelsintha Isaac Ndahi', 'assets/contestants/1122.jpg', 'assets/contestants/1122-poster.jpg'),
  ('1123', 'Nwata Splendour Ugonna', 'assets/contestants/1123.jpg', 'assets/contestants/1123-poster.jpg'),
  ('1124', 'Aliyu Marwan Adamu', 'assets/contestants/1124.jpg', 'assets/contestants/1124-poster.jpg'),
  ('1125', 'Godwin Dove Unimanye', 'assets/contestants/1125.jpg', 'assets/contestants/1125-poster.jpg'),
  ('1126', 'Idzi Kerren', 'assets/contestants/1126.jpg', 'assets/contestants/1126-poster.jpg'),
  ('1127', 'Hauwa Abubakar', 'assets/contestants/1127.jpg', 'assets/contestants/1127-poster.jpg'),
  ('1128', 'Ushie Brian', 'assets/contestants/1128.jpg', 'assets/contestants/1128-poster.jpg')
on conflict (number) do nothing;
