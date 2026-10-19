-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Creates the two tables the ordering server uses.

create table if not exists orders (
  id          text primary key,
  number      bigint generated always as identity (start with 1001),
  created_at  timestamptz not null default now(),
  status      text not null,
  paid        boolean not null default false,
  total       integer not null,          -- in cents
  data        jsonb not null             -- items, customer, address, times, notes…
);
create index if not exists orders_created_at on orders (created_at desc);

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

-- Only the server (with the service_role key) may read or write these tables.
-- Row level security with no policies blocks the public "anon" key completely.
alter table orders   enable row level security;
alter table settings enable row level security;
