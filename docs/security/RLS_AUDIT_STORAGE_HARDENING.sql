-- Security hardening template for Supabase
-- Target: strict row isolation + private receipt storage + auditable operations
-- Prereq: Supabase auth JWT must contain clerk user id in claim "sub".

create extension if not exists pgcrypto;

-- 1) Shops table bridge (Clerk user id mapping)
alter table if exists public.shops
  add column if not exists clerk_user_id text;

create unique index if not exists idx_shops_clerk_user_id
  on public.shops(clerk_user_id)
  where clerk_user_id is not null;

-- 2) Enable RLS on core tables
alter table if exists public.shops enable row level security;
alter table if exists public.menu_items enable row level security;
alter table if exists public.sales enable row level security;
alter table if exists public.expenses enable row level security;
alter table if exists public.inventory_adjustments enable row level security;

-- 3) RLS policies (per shop)
drop policy if exists shops_owner_select on public.shops;
create policy shops_owner_select on public.shops
  for select using (clerk_user_id = auth.jwt()->>'sub');

drop policy if exists shops_owner_upsert on public.shops;
create policy shops_owner_upsert on public.shops
  for all using (clerk_user_id = auth.jwt()->>'sub')
  with check (clerk_user_id = auth.jwt()->>'sub');

-- Shared condition helper inline:
-- exists(select 1 from public.shops s where s.id = <table>.shop_id and s.clerk_user_id = auth.jwt()->>'sub')

drop policy if exists menu_items_owner_all on public.menu_items;
create policy menu_items_owner_all on public.menu_items
  for all using (
    exists(select 1 from public.shops s where s.id = menu_items.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  )
  with check (
    exists(select 1 from public.shops s where s.id = menu_items.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  );

drop policy if exists sales_owner_all on public.sales;
create policy sales_owner_all on public.sales
  for all using (
    exists(select 1 from public.shops s where s.id = sales.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  )
  with check (
    exists(select 1 from public.shops s where s.id = sales.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  );

drop policy if exists expenses_owner_all on public.expenses;
create policy expenses_owner_all on public.expenses
  for all using (
    exists(select 1 from public.shops s where s.id = expenses.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  )
  with check (
    exists(select 1 from public.shops s where s.id = expenses.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  );

drop policy if exists inventory_owner_all on public.inventory_adjustments;
create policy inventory_owner_all on public.inventory_adjustments
  for all using (
    exists(select 1 from public.shops s where s.id = inventory_adjustments.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  )
  with check (
    exists(select 1 from public.shops s where s.id = inventory_adjustments.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  );

-- 4) Private storage bucket (receipt images)
insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do update set public = false;

drop policy if exists "Expense receipts public read" on storage.objects;
drop policy if exists "Expense receipts public upload" on storage.objects;

-- Optional direct-access policy (if you really need client direct access).
-- Recommended: keep access only via server API + signed URLs.

-- 5) Audit logs table
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  actor_clerk_id text not null,
  event_type text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_shop_created
  on public.audit_logs(shop_id, created_at desc);

create index if not exists idx_audit_logs_event
  on public.audit_logs(event_type, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_owner_select on public.audit_logs;
create policy audit_logs_owner_select on public.audit_logs
  for select using (
    exists(select 1 from public.shops s where s.id = audit_logs.shop_id and s.clerk_user_id = auth.jwt()->>'sub')
  );

-- insert is intended from server API (service role), so no anon/auth insert policy here.
