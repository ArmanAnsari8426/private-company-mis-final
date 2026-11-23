-- Apply this migration to the EXISTING MIS project in Supabase SQL Editor.
-- Safe to run more than once. It preserves existing transaction rows.

alter table public.transactions
  add column if not exists value_date date,
  add column if not exists cheque_no text,
  add column if not exists crdr text,
  add column if not exists tax_id text,
  add column if not exists month_label text,
  add column if not exists location text,
  add column if not exists source_company text,
  add column if not exists source_sheet text,
  add column if not exists source_row integer,
  add column if not exists source_hash text,
  add column if not exists import_batch_id uuid;

create unique index if not exists transactions_workspace_source_hash_uidx
  on public.transactions(workspace_id, source_hash);
create index if not exists transactions_workspace_company_date_idx
  on public.transactions(workspace_id, company_id, transaction_date desc);
create index if not exists transactions_workspace_month_idx
  on public.transactions(workspace_id, month_label);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  file_name text not null,
  sheet_name text not null,
  row_count integer not null default 0 check (row_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists import_batches_workspace_created_idx
  on public.import_batches(workspace_id, created_at desc);

alter table public.import_batches enable row level security;
drop policy if exists "members read import batches" on public.import_batches;
create policy "members read import batches" on public.import_batches
  for select using (public.is_workspace_member(workspace_id));
drop policy if exists "members create import batches" on public.import_batches;
create policy "members create import batches" on public.import_batches
  for insert with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
drop policy if exists "creator update own import batch" on public.import_batches;
create policy "creator update own import batch" on public.import_batches
  for update using (created_by = auth.uid() and public.is_workspace_member(workspace_id))
  with check (created_by = auth.uid() and public.is_workspace_member(workspace_id));

-- Imported rows use the same member insert permission as manual entries.
-- Staff still cannot update or delete transactions; those policies remain admin-only.

-- Tighten the original insert policy: compare company workspace to the transaction workspace explicitly.
drop policy if exists "members insert transactions" on public.transactions;
create policy "members insert transactions" on public.transactions
  for insert with check (
    public.is_workspace_member(transactions.workspace_id)
    and transactions.created_by = auth.uid()
    and exists (
      select 1 from public.companies c
      where c.id = transactions.company_id
        and c.workspace_id = transactions.workspace_id
    )
  );
