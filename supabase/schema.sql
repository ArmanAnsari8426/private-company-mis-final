-- Run this once in Supabase SQL Editor on a NEW project.
create extension if not exists pgcrypto;
create table public.workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 created_at timestamptz not null default now()
);
create table public.workspace_members (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check (role in ('admin','staff')),
 created_at timestamptz not null default now(),
 primary key(workspace_id,user_id),
 unique(user_id)
);
create table public.companies (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name text not null,
 code text not null,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(workspace_id,code)
);
create table public.transactions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 company_id uuid not null references public.companies(id),
 transaction_date date not null,
 party_name text,
 description text,
 amount numeric(14,2) not null check(amount > 0),
 transaction_type text not null check(transaction_type in ('paid','received','advance','balance')),
 remarks text,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
create index transactions_workspace_date_idx on public.transactions(workspace_id,transaction_date desc);
create index transactions_party_idx on public.transactions(workspace_id,party_name);
create or replace function public.is_workspace_member(wid uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.workspace_members where workspace_id=wid and user_id=auth.uid()) $$;
create or replace function public.is_workspace_admin(wid uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.workspace_members where workspace_id=wid and user_id=auth.uid() and role='admin') $$;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.companies enable row level security;
alter table public.transactions enable row level security;
create policy "members read own workspace" on public.workspaces for select using(public.is_workspace_member(id));
create policy "members read workspace members" on public.workspace_members for select using(public.is_workspace_member(workspace_id));
create policy "members read companies" on public.companies for select using(public.is_workspace_member(workspace_id));
create policy "admins manage companies" on public.companies for all using(public.is_workspace_admin(workspace_id)) with check(public.is_workspace_admin(workspace_id));
create policy "members read transactions" on public.transactions for select using(public.is_workspace_member(workspace_id));
create policy "members insert transactions" on public.transactions for insert with check(public.is_workspace_member(workspace_id) and created_by=auth.uid() and exists(select 1 from public.companies c where c.id=company_id and c.workspace_id=workspace_id));
create policy "admins update transactions" on public.transactions for update using(public.is_workspace_admin(workspace_id)) with check(public.is_workspace_admin(workspace_id));
create policy "admins delete transactions" on public.transactions for delete using(public.is_workspace_admin(workspace_id));
-- Bootstrap after creating the first Auth user. Replace the email and workspace name below.
-- This creates the workspace, makes that user admin, and adds company cards.
do $$
declare admin_id uuid; wid uuid;
begin
 select id into admin_id from auth.users where email='YOUR_ADMIN_EMAIL';
 if admin_id is null then raise exception 'Create the admin user in Authentication first, then replace YOUR_ADMIN_EMAIL in this script.'; end if;
 insert into public.workspaces(name) values('My Company MIS') returning id into wid;
 insert into public.workspace_members(workspace_id,user_id,role) values(wid,admin_id,'admin');
 insert into public.companies(workspace_id,name,code) values
 (wid,'TELUS','TELUS'),(wid,'SOUTHSQ','SOUTHSQ'),(wid,'CRYSTAL','CRYSTAL'),
 (wid,'TP','TP'),(wid,'KNACK','KNACK'),(wid,'SKYSUN','SKYSUN'),(wid,'CORONIS','CORONIS');
end $$;
