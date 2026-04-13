-- ============================================================
--  Coupang Analytics — Supabase Schema
--  Run this in Supabase SQL Editor
-- ============================================================

-- Rankings (쿠팡 랭킹 — 매일 수동 입력)
create table if not exists rankings (
  id            uuid primary key default gen_random_uuid(),
  product_name  text not null,
  keyword       text not null,
  rank_today    int  not null,
  rank_yesterday int,
  date          date not null default current_date,
  created_at    timestamptz default now()
);
create index if not exists rankings_date_idx on rankings(date desc);
create index if not exists rankings_keyword_idx on rankings(keyword);

-- Ad entries (광고 성과 — 수동 입력)
create table if not exists ad_entries (
  id            uuid primary key default gen_random_uuid(),
  product_name  text not null,
  ad_cost       bigint not null default 0,
  ad_revenue    bigint not null default 0,
  clicks        int    not null default 0,
  impressions   int    not null default 0,
  date          date   not null default current_date,
  created_at    timestamptz default now()
);
create index if not exists ad_entries_date_idx on ad_entries(date desc);

-- Supply items (공급 중 수량)
create table if not exists supply_items (
  id            uuid primary key default gen_random_uuid(),
  product_name  text not null,
  option_name   text default '',
  qty           int  not null default 0,
  expected_date date,
  status        text default 'preparing' check (status in ('confirmed','transit','preparing')),
  created_at    timestamptz default now()
);

-- ── Row Level Security ──
alter table rankings    enable row level security;
alter table ad_entries  enable row level security;
alter table supply_items enable row level security;

-- Allow all operations for anon key (single-user app)
-- In production, replace with auth-based policies
create policy "allow_all_rankings"     on rankings     for all using (true) with check (true);
create policy "allow_all_ad_entries"   on ad_entries   for all using (true) with check (true);
create policy "allow_all_supply_items" on supply_items for all using (true) with check (true);
