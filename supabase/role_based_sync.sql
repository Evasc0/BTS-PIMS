-- Role-based automatic sync queues for BTS Inventory
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  employee_id text not null unique,
  email text not null unique,
  role text not null check (role in ('system_admin', 'employee')),
  account_status text not null default 'active' check (account_status in ('active', 'inactive')),
  last_seen_at timestamptz,
  last_seen_device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_users add column if not exists user_id uuid;
alter table public.app_users add column if not exists employee_id text;
alter table public.app_users add column if not exists email text;
alter table public.app_users add column if not exists role text;
alter table public.app_users add column if not exists account_status text not null default 'active';
alter table public.app_users add column if not exists last_seen_at timestamptz;
alter table public.app_users add column if not exists last_seen_device_id text;
alter table public.app_users add column if not exists created_at timestamptz not null default now();
alter table public.app_users add column if not exists updated_at timestamptz not null default now();

update public.app_users
set role = case
  when lower(trim(role)) = 'admin' then 'system_admin'
  when lower(trim(role)) = 'supervisor' then 'employee'
  else role
end
where role is not null;

alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users
  add constraint app_users_role_check check (role in ('system_admin', 'employee'));

create unique index if not exists idx_app_users_employee_id on public.app_users(employee_id);
create unique index if not exists idx_app_users_email on public.app_users(email);
create index if not exists idx_app_users_role_status on public.app_users(role, account_status);
create index if not exists idx_app_users_last_seen on public.app_users(last_seen_at desc);

create table if not exists public.admin_sync_queue (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  recipient_key text not null default '__all__',
  origin_device_id text not null default '',
  origin_user_id uuid,
  payload jsonb,
  payload_size_kb numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  table_name text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  record_id text not null,
  data jsonb,
  "timestamp" timestamptz not null default now()
);

create table if not exists public.employee_sync_queue (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  recipient_key text not null default '__all__',
  origin_device_id text not null default '',
  origin_user_id uuid,
  payload jsonb,
  payload_size_kb numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  table_name text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  record_id text not null,
  data jsonb,
  "timestamp" timestamptz not null default now()
);

create table if not exists public.profile_sync_queue (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  origin_device_id text not null default '',
  origin_user_id uuid,
  image_data text,
  image_format text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_sync_queue add column if not exists employee_id text;
alter table public.admin_sync_queue add column if not exists recipient_key text not null default '__all__';
alter table public.admin_sync_queue add column if not exists origin_device_id text;
alter table public.admin_sync_queue add column if not exists origin_user_id uuid;
alter table public.admin_sync_queue add column if not exists payload jsonb;
alter table public.admin_sync_queue add column if not exists payload_size_kb numeric;
alter table public.admin_sync_queue add column if not exists created_at timestamptz not null default now();
alter table public.admin_sync_queue add column if not exists updated_at timestamptz not null default now();

alter table public.employee_sync_queue add column if not exists origin_device_id text;
alter table public.employee_sync_queue add column if not exists recipient_key text not null default '__all__';
alter table public.employee_sync_queue add column if not exists origin_user_id uuid;
alter table public.employee_sync_queue add column if not exists payload jsonb;
alter table public.employee_sync_queue add column if not exists payload_size_kb numeric;
alter table public.employee_sync_queue add column if not exists created_at timestamptz not null default now();
alter table public.employee_sync_queue add column if not exists updated_at timestamptz not null default now();

alter table public.profile_sync_queue add column if not exists employee_id text;
alter table public.profile_sync_queue add column if not exists origin_device_id text not null default '';
alter table public.profile_sync_queue add column if not exists origin_user_id uuid;
alter table public.profile_sync_queue add column if not exists image_data text;
alter table public.profile_sync_queue add column if not exists image_format text;
alter table public.profile_sync_queue add column if not exists created_at timestamptz not null default now();
alter table public.profile_sync_queue add column if not exists updated_at timestamptz not null default now();

update public.admin_sync_queue
set
  recipient_key = coalesce(nullif(trim(recipient_key), ''), nullif(trim(employee_id), ''), '__all__'),
  payload = coalesce(
    payload,
    jsonb_build_object(
      'table_name', table_name,
      'operation', operation,
      'record_id', record_id,
      'data', data
    )
  ),
  payload_size_kb = coalesce(payload_size_kb, round((pg_column_size(coalesce(payload, data))::numeric / 1024.0), 3)),
  created_at = coalesce(created_at, "timestamp", now()),
  updated_at = coalesce(updated_at, created_at, "timestamp", now())
where recipient_key is null or payload is null or payload_size_kb is null or created_at is null or updated_at is null;

update public.employee_sync_queue
set
  recipient_key = coalesce(nullif(trim(recipient_key), ''), nullif(trim(employee_id), ''), '__all__'),
  payload = coalesce(
    payload,
    jsonb_build_object(
      'table_name', table_name,
      'operation', operation,
      'record_id', record_id,
      'data', data
    )
  ),
  payload_size_kb = coalesce(payload_size_kb, round((pg_column_size(coalesce(payload, data))::numeric / 1024.0), 3)),
  created_at = coalesce(created_at, "timestamp", now()),
  updated_at = coalesce(updated_at, created_at, "timestamp", now())
where recipient_key is null or payload is null or payload_size_kb is null or created_at is null or updated_at is null;

delete from public.profile_sync_queue
where employee_id is null or trim(employee_id) = '';

update public.profile_sync_queue
set
  employee_id = trim(employee_id),
  origin_device_id = coalesce(nullif(trim(origin_device_id), ''), ''),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where origin_device_id is null
   or created_at is null
   or updated_at is null
   or employee_id <> trim(employee_id);

with ranked as (
  select
    id,
    row_number() over (
      partition by recipient_key, table_name, record_id
      order by coalesce(updated_at, created_at, "timestamp") desc, id desc
    ) as rn
  from public.admin_sync_queue
)
delete from public.admin_sync_queue q
using ranked r
where q.id = r.id and r.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by recipient_key, table_name, record_id
      order by coalesce(updated_at, created_at, "timestamp") desc, id desc
    ) as rn
  from public.employee_sync_queue
)
delete from public.employee_sync_queue q
using ranked r
where q.id = r.id and r.rn > 1;

create table if not exists public.full_sync_requests (
  id uuid primary key default gen_random_uuid(),
  requesting_device_id text,
  target_device_id text,
  requested_by text,
  estimated_records integer,
  estimated_size_mb numeric,
  created_at timestamptz not null default now(),
  requester_device_id text not null,
  requester_user_id text,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'transferring', 'completed', 'cancelled')),
  last_successful_sync_at timestamptz,
  estimated_db_size_bytes bigint,
  approved_at timestamptz,
  approved_by_user_id text,
  rejected_at timestamptz,
  rejected_by_user_id text,
  rejection_reason text,
  total_chunks integer,
  manifest_checksum text,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by_device_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.full_sync_chunks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.full_sync_requests(id) on delete cascade,
  chunk_index integer not null,
  chunk_size_bytes bigint not null,
  checksum_sha256 text not null,
  storage_object text not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'acked', 'deleted', 'failed')),
  uploaded_at timestamptz not null default now(),
  acked_at timestamptz,
  acked_by_device_id text,
  storage_deleted_at timestamptz,
  unique (request_id, chunk_index)
);

alter table public.full_sync_requests add column if not exists requester_device_id text;
alter table public.full_sync_requests add column if not exists requester_user_id text;
alter table public.full_sync_requests add column if not exists requested_at timestamptz not null default now();
alter table public.full_sync_requests add column if not exists requesting_device_id text;
alter table public.full_sync_requests add column if not exists target_device_id text;
alter table public.full_sync_requests add column if not exists requested_by text;
alter table public.full_sync_requests add column if not exists estimated_records integer;
alter table public.full_sync_requests add column if not exists estimated_size_mb numeric;
alter table public.full_sync_requests add column if not exists created_at timestamptz not null default now();
alter table public.full_sync_requests add column if not exists status text not null default 'pending';
alter table public.full_sync_requests add column if not exists last_successful_sync_at timestamptz;
alter table public.full_sync_requests add column if not exists estimated_db_size_bytes bigint;
alter table public.full_sync_requests add column if not exists approved_at timestamptz;
alter table public.full_sync_requests add column if not exists approved_by_user_id text;
alter table public.full_sync_requests add column if not exists rejected_at timestamptz;
alter table public.full_sync_requests add column if not exists rejected_by_user_id text;
alter table public.full_sync_requests add column if not exists rejection_reason text;
alter table public.full_sync_requests add column if not exists total_chunks integer;
alter table public.full_sync_requests add column if not exists manifest_checksum text;
alter table public.full_sync_requests add column if not exists started_at timestamptz;
alter table public.full_sync_requests add column if not exists completed_at timestamptz;
alter table public.full_sync_requests add column if not exists completed_by_device_id text;
alter table public.full_sync_requests add column if not exists updated_at timestamptz not null default now();

update public.full_sync_requests
set
  requesting_device_id = coalesce(requesting_device_id, requester_device_id),
  target_device_id = coalesce(target_device_id, requester_device_id),
  requested_by = coalesce(requested_by, requester_user_id),
  estimated_size_mb = coalesce(
    estimated_size_mb,
    case
      when estimated_db_size_bytes is not null then round((estimated_db_size_bytes::numeric / 1024.0 / 1024.0), 3)
      else null
    end
  ),
  created_at = coalesce(created_at, requested_at, now())
where
  requesting_device_id is null
  or target_device_id is null
  or requested_by is null
  or estimated_size_mb is null
  or created_at is null;

alter table public.full_sync_chunks add column if not exists chunk_size_bytes bigint;
alter table public.full_sync_chunks add column if not exists checksum_sha256 text;
alter table public.full_sync_chunks add column if not exists storage_object text;
alter table public.full_sync_chunks add column if not exists status text not null default 'uploaded';
alter table public.full_sync_chunks add column if not exists uploaded_at timestamptz not null default now();
alter table public.full_sync_chunks add column if not exists acked_at timestamptz;
alter table public.full_sync_chunks add column if not exists acked_by_device_id text;
alter table public.full_sync_chunks add column if not exists storage_deleted_at timestamptz;

create index if not exists idx_admin_sync_queue_timestamp
  on public.admin_sync_queue ("timestamp");

create index if not exists idx_admin_sync_queue_employee_timestamp
  on public.admin_sync_queue (employee_id, "timestamp");

create index if not exists idx_admin_sync_queue_created_at
  on public.admin_sync_queue (created_at desc);

create index if not exists idx_admin_sync_queue_updated_at
  on public.admin_sync_queue (updated_at desc);

create index if not exists idx_admin_sync_queue_origin_device
  on public.admin_sync_queue (origin_device_id);

create unique index if not exists idx_admin_sync_queue_recipient_record
  on public.admin_sync_queue (recipient_key, table_name, record_id);

create index if not exists idx_employee_sync_queue_employee_timestamp
  on public.employee_sync_queue (employee_id, "timestamp");

create index if not exists idx_employee_sync_queue_timestamp
  on public.employee_sync_queue ("timestamp");

create index if not exists idx_employee_sync_queue_created_at
  on public.employee_sync_queue (created_at desc);

create index if not exists idx_employee_sync_queue_updated_at
  on public.employee_sync_queue (updated_at desc);

create index if not exists idx_employee_sync_queue_origin_device
  on public.employee_sync_queue (origin_device_id);

create unique index if not exists idx_employee_sync_queue_recipient_record
  on public.employee_sync_queue (recipient_key, table_name, record_id);

create index if not exists idx_profile_sync_queue_employee_updated_at
  on public.profile_sync_queue (employee_id, updated_at desc);

create index if not exists idx_profile_sync_queue_origin_device
  on public.profile_sync_queue (origin_device_id);

create index if not exists idx_full_sync_requests_status_requested_at
  on public.full_sync_requests (status, requested_at desc);

create index if not exists idx_full_sync_requests_device_requested_at
  on public.full_sync_requests (requester_device_id, requested_at desc);

create index if not exists idx_full_sync_requests_target_status_created_at
  on public.full_sync_requests (target_device_id, status, created_at desc);

create index if not exists idx_full_sync_requests_requesting_created_at
  on public.full_sync_requests (requesting_device_id, created_at desc);

create index if not exists idx_full_sync_chunks_request_status_chunk
  on public.full_sync_chunks (request_id, status, chunk_index);

alter table public.app_users enable row level security;
alter table public.admin_sync_queue enable row level security;
alter table public.employee_sync_queue enable row level security;
alter table public.profile_sync_queue enable row level security;
alter table public.full_sync_requests enable row level security;
alter table public.full_sync_chunks enable row level security;

-- RLS helpers (role/employee resolution from app_users, not JWT custom claims).
create or replace function public.sync_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(u.role)
  from public.app_users u
  where u.user_id = auth.uid()
    and u.account_status = 'active'
  limit 1;
$$;

create or replace function public.sync_user_employee_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.employee_id
  from public.app_users u
  where u.user_id = auth.uid()
    and u.account_status = 'active'
  limit 1;
$$;

grant execute on function public.sync_user_role() to authenticated;
grant execute on function public.sync_user_employee_id() to authenticated;

create or replace function public.sync_auth_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid()
  limit 1;
$$;

grant execute on function public.sync_auth_email() to authenticated;

create or replace function public.sync_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.sync_user_role() = 'system_admin', false);
$$;

create or replace function public.sync_is_employee()
returns boolean
language sql
stable
as $$
  select coalesce(public.sync_user_role() = 'employee', false);
$$;

create or replace function public.sync_employee_id()
returns text
language sql
stable
as $$
  select coalesce(
    public.sync_user_employee_id(),
    auth.uid()::text
  );
$$;

create or replace function public.sync_device_id()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'device_id', auth.uid()::text);
$$;

create or replace function public.sync_has_recent_admin_activity(min_days integer default 3)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users u
    where lower(u.role) = 'system_admin'
      and u.account_status = 'active'
      and coalesce(u.last_seen_at, u.updated_at, u.created_at) >= now() - make_interval(days => greatest(coalesce(min_days, 3), 1))
  );
$$;

create or replace function public.sync_relay_usage_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  admin_rows bigint := 0;
  employee_rows bigint := 0;
  profile_rows bigint := 0;
  admin_payload_kb numeric := 0;
  employee_payload_kb numeric := 0;
  profile_payload_kb numeric := 0;
  queue_payload_kb numeric := 0;
  full_sync_chunk_rows bigint := 0;
  full_sync_request_rows bigint := 0;
  storage_objects bigint := 0;
  storage_bytes numeric := 0;
  oldest_queue_at timestamptz := null;
begin
  select count(*), coalesce(sum(payload_size_kb), 0)
  into admin_rows, admin_payload_kb
  from public.admin_sync_queue;

  select count(*), coalesce(sum(payload_size_kb), 0)
  into employee_rows, employee_payload_kb
  from public.employee_sync_queue;

  select
    count(*),
    coalesce(sum(length(coalesce(image_data, ''))::numeric / 1024.0), 0)
  into profile_rows, profile_payload_kb
  from public.profile_sync_queue;

  queue_payload_kb := admin_payload_kb + employee_payload_kb + profile_payload_kb;

  select min(ts)
  into oldest_queue_at
  from (
    select min(coalesce(created_at, "timestamp")) as ts from public.admin_sync_queue
    union all
    select min(coalesce(created_at, "timestamp")) as ts from public.employee_sync_queue
    union all
    select min(coalesce(updated_at, created_at)) as ts from public.profile_sync_queue
  ) oldest
  where ts is not null;

  select count(*) into full_sync_chunk_rows from public.full_sync_chunks;
  select count(*) into full_sync_request_rows from public.full_sync_requests;

  select
    count(*),
    coalesce(sum(nullif(metadata ->> 'size', '')::numeric), 0)
  into storage_objects, storage_bytes
  from storage.objects
  where bucket_id = 'full-sync-temp';

  return jsonb_build_object(
    'admin_queue_rows', admin_rows,
    'employee_queue_rows', employee_rows,
    'profile_queue_rows', profile_rows,
    'total_queue_rows', admin_rows + employee_rows + profile_rows,
    'queue_payload_mb', round((queue_payload_kb / 1024.0), 3),
    'full_sync_chunk_rows', full_sync_chunk_rows,
    'full_sync_request_rows', full_sync_request_rows,
    'storage_objects', storage_objects,
    'storage_mb', round((storage_bytes / 1024.0 / 1024.0), 3),
    'oldest_queue_at', oldest_queue_at
  );
end;
$$;

grant execute on function public.sync_has_recent_admin_activity(integer) to authenticated;
grant execute on function public.sync_relay_usage_stats() to authenticated;

drop policy if exists "admin_queue_admin_all" on public.admin_sync_queue;
drop policy if exists "admin_queue_employee_select_assigned" on public.admin_sync_queue;
drop policy if exists "admin_queue_employee_insert_changes" on public.admin_sync_queue;
drop policy if exists "admin_queue_insert_admin" on public.admin_sync_queue;
drop policy if exists "admin_queue_select_authenticated" on public.admin_sync_queue;
drop policy if exists "admin_queue_delete_authenticated" on public.admin_sync_queue;
drop policy if exists "admin_queue_update_authenticated" on public.admin_sync_queue;
drop policy if exists "employee_queue_admin_all" on public.employee_sync_queue;
drop policy if exists "employee_queue_admin_select" on public.employee_sync_queue;
drop policy if exists "employee_queue_admin_delete" on public.employee_sync_queue;
drop policy if exists "employee_queue_select_own" on public.employee_sync_queue;
drop policy if exists "employee_queue_delete_own" on public.employee_sync_queue;
drop policy if exists "employee_queue_employee_insert" on public.employee_sync_queue;
drop policy if exists "employee_queue_insert_employee" on public.employee_sync_queue;
drop policy if exists "employee_queue_select_admin" on public.employee_sync_queue;
drop policy if exists "employee_queue_delete_admin" on public.employee_sync_queue;
drop policy if exists "employee_queue_update_employee" on public.employee_sync_queue;
drop policy if exists "profile_sync_queue_insert_authenticated" on public.profile_sync_queue;
drop policy if exists "profile_sync_queue_select_authenticated" on public.profile_sync_queue;
drop policy if exists "profile_sync_queue_delete_authenticated" on public.profile_sync_queue;
drop policy if exists "app_users_admin_all" on public.app_users;
drop policy if exists "app_users_user_select_self" on public.app_users;
drop policy if exists "app_users_user_insert_self" on public.app_users;
drop policy if exists "app_users_user_update_self" on public.app_users;
drop policy if exists "full_sync_requests_admin_all" on public.full_sync_requests;
drop policy if exists "full_sync_requests_requester_insert" on public.full_sync_requests;
drop policy if exists "full_sync_requests_requester_select" on public.full_sync_requests;
drop policy if exists "full_sync_requests_requester_update" on public.full_sync_requests;
drop policy if exists "full_sync_chunks_admin_all" on public.full_sync_chunks;
drop policy if exists "full_sync_chunks_requester_select" on public.full_sync_chunks;
drop policy if exists "full_sync_chunks_requester_update" on public.full_sync_chunks;

create policy "admin_queue_insert_admin"
on public.admin_sync_queue
for insert
to authenticated
with check (
  public.sync_is_admin()
  and coalesce(origin_device_id, '') <> ''
);

create policy "admin_queue_select_authenticated"
on public.admin_sync_queue
for select
to authenticated
using (
  public.sync_is_admin()
  or (public.sync_is_employee() and employee_id = public.sync_employee_id())
  or (origin_user_id is not null and origin_user_id = auth.uid())
);

create policy "admin_queue_delete_authenticated"
on public.admin_sync_queue
for delete
to authenticated
using (
  public.sync_is_admin()
  or (origin_user_id is not null and origin_user_id = auth.uid())
  or (public.sync_is_employee() and employee_id = public.sync_employee_id())
);

create policy "admin_queue_update_authenticated"
on public.admin_sync_queue
for update
to authenticated
using (public.sync_is_admin())
with check (
  public.sync_is_admin()
  and coalesce(origin_device_id, '') <> ''
);

create policy "employee_queue_insert_employee"
on public.employee_sync_queue
for insert
to authenticated
with check (
  public.sync_is_employee()
  and employee_id = public.sync_employee_id()
  and coalesce(origin_device_id, '') <> ''
);

create policy "employee_queue_select_admin"
on public.employee_sync_queue
for select
to authenticated
using (public.sync_is_admin());

create policy "employee_queue_delete_admin"
on public.employee_sync_queue
for delete
to authenticated
using (public.sync_is_admin());

create policy "employee_queue_update_employee"
on public.employee_sync_queue
for update
to authenticated
using (
  public.sync_is_employee()
  and employee_id = public.sync_employee_id()
)
with check (
  public.sync_is_employee()
  and employee_id = public.sync_employee_id()
  and coalesce(origin_device_id, '') <> ''
);

create policy "profile_sync_queue_insert_authenticated"
on public.profile_sync_queue
for insert
to authenticated
with check (
  (public.sync_is_admin() or employee_id = public.sync_employee_id())
  and coalesce(origin_device_id, '') <> ''
  and (origin_user_id = auth.uid() or public.sync_is_admin())
);

create policy "profile_sync_queue_select_authenticated"
on public.profile_sync_queue
for select
to authenticated
using (
  public.sync_is_admin()
  or employee_id = public.sync_employee_id()
  or (origin_user_id is not null and origin_user_id = auth.uid())
);

create policy "profile_sync_queue_delete_authenticated"
on public.profile_sync_queue
for delete
to authenticated
using (
  public.sync_is_admin()
  or employee_id = public.sync_employee_id()
  or (origin_user_id is not null and origin_user_id = auth.uid())
);

create policy "app_users_admin_all"
on public.app_users
for all
to authenticated
using (public.sync_is_admin())
with check (public.sync_is_admin());

create policy "app_users_user_select_self"
on public.app_users
for select
to authenticated
using (user_id = auth.uid());

create policy "app_users_user_insert_self"
on public.app_users
for insert
to authenticated
with check (
  user_id = auth.uid()
  and lower(email) = public.sync_auth_email()
  and account_status in ('active', 'inactive')
  and (
    lower(role) = 'employee'
    or (lower(role) = 'system_admin' and lower(email) = 'btsadmin@gmail.com')
  )
);

create policy "app_users_user_update_self"
on public.app_users
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and lower(email) = public.sync_auth_email()
  and account_status in ('active', 'inactive')
  and (
    lower(role) = 'employee'
    or (lower(role) = 'system_admin' and lower(email) = 'btsadmin@gmail.com')
  )
);

create policy "full_sync_requests_admin_all"
on public.full_sync_requests
for all
to authenticated
using (public.sync_is_admin())
with check (public.sync_is_admin());

-- full sync workflow is system-admin only

create policy "full_sync_chunks_admin_all"
on public.full_sync_chunks
for all
to authenticated
using (public.sync_is_admin())
with check (public.sync_is_admin());

-- full sync chunk transfer is system-admin only

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('full-sync-temp', 'full-sync-temp', false, 5242880, array['application/octet-stream'])
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "full_sync_storage_admin_all" on storage.objects;
drop policy if exists "full_sync_storage_authenticated_read" on storage.objects;
drop policy if exists "full_sync_storage_authenticated_insert" on storage.objects;
drop policy if exists "full_sync_storage_authenticated_delete" on storage.objects;

create policy "full_sync_storage_admin_all"
on storage.objects
for all
to authenticated
using (bucket_id = 'full-sync-temp' and public.sync_is_admin())
with check (bucket_id = 'full-sync-temp' and public.sync_is_admin());

-- storage access for full-sync chunks is system-admin only

-- 48-hour queue retention (Supabase stays temporary relay only)
create or replace function public.cleanup_sync_queues()
returns void
language sql
security definer
as $$
  delete from public.admin_sync_queue
  where coalesce(created_at, "timestamp") < now() - interval '2 days';

  delete from public.employee_sync_queue
  where coalesce(created_at, "timestamp") < now() - interval '2 days';

  delete from public.profile_sync_queue
  where coalesce(updated_at, created_at) < now() - interval '2 days';
$$;

create or replace function public.cleanup_full_sync_requests()
returns void
language sql
security definer
as $$
  delete from storage.objects o
  where o.bucket_id = 'full-sync-temp'
    and coalesce(o.updated_at, o.created_at) < now() - interval '2 days'
    and not exists (
      select 1
      from public.full_sync_chunks c
      where c.storage_object = o.name
        and c.status in ('uploaded', 'acked')
    );

  delete from public.full_sync_chunks
  where uploaded_at < now() - interval '2 days';

  delete from public.full_sync_requests
  where coalesce(created_at, requested_at) < now() - interval '2 days';
$$;

grant execute on function public.cleanup_sync_queues() to authenticated;
grant execute on function public.cleanup_full_sync_requests() to authenticated;

-- Optional: run retention daily via pg_cron.
-- If pg_cron is unavailable in your project, keep this function and run it
-- from an external scheduler or rely on application-side fallback cleanup.
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron extension unavailable; queue cleanup must be scheduled externally.';
end $$;

do $$
declare
  cleanup_job_id integer;
begin
  select jobid
  into cleanup_job_id
  from cron.job
  where jobname = 'sync_queue_cleanup_daily'
  limit 1;

  if cleanup_job_id is not null then
    perform cron.unschedule(cleanup_job_id);
  end if;

  perform cron.schedule(
    'sync_queue_cleanup_daily',
    '15 */6 * * *',
    'select public.cleanup_sync_queues();'
  );
exception
  when undefined_table or undefined_function then
    raise notice 'pg_cron not available; schedule public.cleanup_sync_queues() externally.';
end $$;

do $$
declare
  cleanup_job_id integer;
begin
  select jobid
  into cleanup_job_id
  from cron.job
  where jobname = 'full_sync_cleanup_daily'
  limit 1;

  if cleanup_job_id is not null then
    perform cron.unschedule(cleanup_job_id);
  end if;

  perform cron.schedule(
    'full_sync_cleanup_daily',
    '30 */6 * * *',
    'select public.cleanup_full_sync_requests();'
  );
exception
  when undefined_table or undefined_function then
    raise notice 'pg_cron not available; schedule public.cleanup_full_sync_requests() externally.';
end $$;

-- Development fallback (NOT strict):
-- If you are only using a publishable/anon key without Supabase Auth JWT,
-- strict RLS policies above will reject requests.
-- Uncomment only for local testing:
-- alter table public.admin_sync_queue disable row level security;
-- alter table public.employee_sync_queue disable row level security;
-- alter table public.profile_sync_queue disable row level security;
-- alter table public.full_sync_requests disable row level security;
-- alter table public.full_sync_chunks disable row level security;
-- drop policy if exists "full_sync_storage_admin_all" on storage.objects;
-- drop policy if exists "full_sync_storage_authenticated_read" on storage.objects;
-- drop policy if exists "full_sync_storage_authenticated_insert" on storage.objects;
-- drop policy if exists "full_sync_storage_authenticated_delete" on storage.objects;
-- create policy "full_sync_storage_dev_all" on storage.objects
-- for all to public using (bucket_id = 'full-sync-temp') with check (bucket_id = 'full-sync-temp');
