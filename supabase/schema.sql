create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

alter table if exists public.profiles
  add column if not exists is_matrix_admin boolean not null default false;

create or replace function private.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        coalesce(is_superadmin, false) = true
        or coalesce(is_matrix_admin, false) = true
      )
  );
$$;

revoke all on function private.is_admin_user() from public;
grant execute on function private.is_admin_user() to authenticated;

create table if not exists public.humor_flavors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  description text,
  notes text,
  status text not null default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.humor_flavors
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists notes text,
  add column if not exists status text not null default 'draft',
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create table if not exists public.humor_flavor_steps (
  id uuid primary key default gen_random_uuid(),
  humor_flavor_id uuid not null references public.humor_flavors(id) on delete cascade,
  title text not null,
  instruction text not null,
  output_label text,
  step_order integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.humor_flavor_steps
  add column if not exists humor_flavor_id uuid references public.humor_flavors(id) on delete cascade,
  add column if not exists title text,
  add column if not exists instruction text,
  add column if not exists output_label text,
  add column if not exists step_order integer,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create table if not exists public.humor_flavor_runs (
  id uuid primary key default gen_random_uuid(),
  humor_flavor_id uuid not null references public.humor_flavors(id) on delete cascade,
  image_id text,
  image_url text,
  status text not null default 'completed',
  pipeline_model text,
  request_payload jsonb,
  raw_response jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.humor_flavor_captions (
  id uuid primary key default gen_random_uuid(),
  humor_flavor_run_id uuid not null references public.humor_flavor_runs(id) on delete cascade,
  humor_flavor_id uuid not null references public.humor_flavors(id) on delete cascade,
  image_id text,
  caption_text text not null,
  rank_index integer,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists humor_flavor_steps_flavor_order_idx
  on public.humor_flavor_steps(humor_flavor_id, step_order);

create index if not exists humor_flavor_runs_flavor_created_idx
  on public.humor_flavor_runs(humor_flavor_id, created_at desc);

create index if not exists humor_flavor_captions_flavor_created_idx
  on public.humor_flavor_captions(humor_flavor_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists humor_flavors_set_updated_at on public.humor_flavors;
create trigger humor_flavors_set_updated_at
before update on public.humor_flavors
for each row
execute function public.set_updated_at();

drop trigger if exists humor_flavor_steps_set_updated_at on public.humor_flavor_steps;
create trigger humor_flavor_steps_set_updated_at
before update on public.humor_flavor_steps
for each row
execute function public.set_updated_at();

alter table if exists public.profiles enable row level security;
alter table if exists public.humor_flavors enable row level security;
alter table if exists public.humor_flavor_steps enable row level security;
alter table if exists public.humor_flavor_runs enable row level security;
alter table if exists public.humor_flavor_captions enable row level security;

drop policy if exists "profiles_self_or_admin_select" on public.profiles;
create policy "profiles_self_or_admin_select"
on public.profiles
for select
to authenticated
using (id = auth.uid() or private.is_admin_user());

drop policy if exists "humor_flavors_admin_all" on public.humor_flavors;
create policy "humor_flavors_admin_all"
on public.humor_flavors
for all
to authenticated
using (private.is_admin_user())
with check (private.is_admin_user());

drop policy if exists "humor_flavor_steps_admin_all" on public.humor_flavor_steps;
create policy "humor_flavor_steps_admin_all"
on public.humor_flavor_steps
for all
to authenticated
using (private.is_admin_user())
with check (private.is_admin_user());

drop policy if exists "humor_flavor_runs_admin_all" on public.humor_flavor_runs;
create policy "humor_flavor_runs_admin_all"
on public.humor_flavor_runs
for all
to authenticated
using (private.is_admin_user())
with check (private.is_admin_user());

drop policy if exists "humor_flavor_captions_admin_all" on public.humor_flavor_captions;
create policy "humor_flavor_captions_admin_all"
on public.humor_flavor_captions
for all
to authenticated
using (private.is_admin_user())
with check (private.is_admin_user());

do $$
begin
  if to_regclass('public.images') is not null then
    execute 'alter table public.images enable row level security';
    execute 'drop policy if exists "images_admin_read" on public.images';
    execute $policy$
      create policy "images_admin_read"
      on public.images
      for select
      to authenticated
      using (private.is_admin_user())
    $policy$;
  end if;
end
$$;
