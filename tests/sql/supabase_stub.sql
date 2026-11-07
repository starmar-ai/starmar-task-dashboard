-- Minimal stand-in for the Supabase auth and storage schemas, so the migrations and the
-- access tests run on a plain local Postgres (tests/sql/run.sh).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;
create schema auth;
create schema storage;
create schema extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  invited_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner_id text,
  metadata jsonb
);
alter table storage.objects enable row level security;
