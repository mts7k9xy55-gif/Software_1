-- Filing Orchestrator: transactions + decisions (主帳簿)
-- Run via: supabase db push or psql

create table if not exists public.filing_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null,
  organization_id text not null,
  user_id text not null,
  source_type text not null,
  direction text not null,
  occurred_at date not null,
  amount integer not null,
  currency text not null,
  counterparty text,
  memo_redacted text not null default '',
  country_code text not null,
  raw_reference text,
  created_at timestamptz not null default now(),
  posted_provider text,
  posted_remote_id text,
  posted_at timestamptz
);

create unique index if not exists idx_filing_transactions_tx_id_org
  on public.filing_transactions(transaction_id, organization_id);

create index if not exists idx_filing_transactions_org_created
  on public.filing_transactions(organization_id, created_at desc);

create index if not exists idx_filing_transactions_occurred
  on public.filing_transactions(organization_id, occurred_at desc);

create table if not exists public.filing_decisions (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null,
  organization_id text not null,
  decision_id text not null,
  rank text not null,
  is_expense boolean not null,
  allocation_rate real not null,
  category text not null,
  amount integer not null,
  date date not null,
  reason text not null default '',
  confidence real not null,
  country_code text not null,
  rule_version text not null default '',
  model_version text not null default '',
  support_code text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_filing_decisions_tx_id_org
  on public.filing_decisions(transaction_id, organization_id);

create index if not exists idx_filing_decisions_org
  on public.filing_decisions(organization_id);

-- RLS: server uses service role; anon access disabled for these tables
alter table public.filing_transactions enable row level security;
alter table public.filing_decisions enable row level security;

-- No policies: API uses service role (bypasses RLS). Data access controlled by Clerk auth in API routes.
