-- Saved task filters ("filter favorit"). Each person sees and manages only their own.

create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  query text not null default '' check (char_length(query) <= 1000),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index saved_filters_user_idx on public.saved_filters (user_id, created_at);

alter table public.saved_filters enable row level security;

create policy "saved_filters: own rows read"
  on public.saved_filters for select to authenticated
  using (user_id = auth.uid());

create policy "saved_filters: own rows insert"
  on public.saved_filters for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());

create policy "saved_filters: own rows update"
  on public.saved_filters for update to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid());

create policy "saved_filters: own rows delete"
  on public.saved_filters for delete to authenticated
  using (user_id = auth.uid());

-- The Data API roles need explicit grants on new tables.
grant select, insert, update, delete on public.saved_filters to authenticated;
revoke all on public.saved_filters from anon;
