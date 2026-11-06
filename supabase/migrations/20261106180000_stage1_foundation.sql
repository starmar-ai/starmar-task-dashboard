-- Stage 1 (Fondasi): users, projects, tasks, labels, and access rules.
-- Access is enforced here with row level security, not only in the UI.

create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('admin', 'member');
create type public.project_status as enum ('perencanaan', 'aktif', 'ditunda', 'selesai');
create type public.task_status as enum ('todo', 'in_progress', 'review', 'done', 'blocked');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.user_role not null default 'member',
  locale text not null default 'id' check (locale in ('id', 'en')),
  timezone text not null default 'Asia/Jakarta',
  theme text not null default 'light' check (theme in ('light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- The first account ever created becomes the admin; everyone after is a member.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    case when exists (select 1 from public.profiles where role = 'admin')
      then 'member'::public.user_role
      else 'admin'::public.user_role
    end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Members may edit their own name and preferences, never their role or email.
-- The last admin cannot be demoted, so the workspace never locks itself out.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    raise exception 'email cannot be changed here';
  end if;
  if new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'only an admin can change roles';
    end if;
    if old.role = 'admin' and not exists (
      select 1 from public.profiles where role = 'admin' and id <> old.id
    ) then
      raise exception 'at least one admin is required';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- projects ------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  color text not null default '#8FA8F0' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  pm_id uuid references public.profiles (id) on delete set null,
  status public.project_status not null default 'aktif',
  client_label text check (client_label is null or char_length(client_label) <= 60),
  archived boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

create or replace function public.can_see_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or exists (select 1 from public.projects p where p.id = pid and p.pm_id = auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = pid and m.user_id = auth.uid());
$$;

-- tasks ---------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  start_date date,
  deadline date not null,
  assignee_id uuid references public.profiles (id) on delete set null default auth.uid(),
  reviewer_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_start_before_deadline check (start_date is null or start_date <= deadline)
);

create index tasks_project_idx on public.tasks (project_id);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_deadline_idx on public.tasks (deadline);

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- The task owner is its assignee or its creator; the admin can edit anything.
create or replace function public.can_edit_task(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.tasks t
    where t.id = tid
      and (t.assignee_id = auth.uid() or t.created_by = auth.uid())
      and public.can_see_project(t.project_id)
  );
$$;

-- labels --------------------------------------------------------------------

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#8FA8F0' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index labels_name_unique on public.labels (lower(btrim(name)));

create table public.task_labels (
  task_id uuid not null references public.tasks (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  primary key (task_id, label_id)
);

create index task_labels_label_idx on public.task_labels (label_id);

-- project overview: counts, auto dates, and the "Berisiko" flag --------------
-- "Today" is the workspace day in Asia/Jakarta (WIB).

create view public.project_overview
with (security_invoker = true)
as
select
  p.*,
  coalesce(stats.total, 0)::int as task_total,
  coalesce(stats.done, 0)::int as task_done,
  coalesce(stats.overdue, 0)::int as task_overdue,
  stats.first_date,
  stats.last_deadline,
  (
    coalesce(stats.overdue, 0) > 0
    or (p.status <> 'selesai' and stats.last_deadline < (now() at time zone 'Asia/Jakarta')::date)
  ) as at_risk
from public.projects p
left join lateral (
  select
    count(*) as total,
    count(*) filter (where t.status = 'done') as done,
    count(*) filter (
      where t.status <> 'done' and t.deadline < (now() at time zone 'Asia/Jakarta')::date
    ) as overdue,
    min(coalesce(t.start_date, t.deadline)) as first_date,
    max(t.deadline) as last_deadline
  from public.tasks t
  where t.project_id = p.id
) stats on true;

-- row level security --------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.labels enable row level security;
alter table public.task_labels enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

create policy "profiles: signed-in users can see the team"
  on public.profiles for select to authenticated
  using (true);

create policy "profiles: edit own profile, admin edits anyone"
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy "projects: visible to admin, PM, and members"
  on public.projects for select to authenticated
  using (public.can_see_project(id));

create policy "projects: admin creates"
  on public.projects for insert to authenticated
  with check (public.is_admin());

create policy "projects: admin edits"
  on public.projects for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "projects: admin deletes"
  on public.projects for delete to authenticated
  using (public.is_admin());

create policy "project_members: visible with the project"
  on public.project_members for select to authenticated
  using (public.can_see_project(project_id));

create policy "project_members: admin manages"
  on public.project_members for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "tasks: visible with the project"
  on public.tasks for select to authenticated
  using (public.can_see_project(project_id));

create policy "tasks: create in a visible project"
  on public.tasks for insert to authenticated
  with check (public.can_see_project(project_id) and created_by = auth.uid());

create policy "tasks: owner or admin edits"
  on public.tasks for update to authenticated
  using (public.can_edit_task(id))
  with check (public.can_see_project(project_id));

create policy "tasks: owner or admin deletes"
  on public.tasks for delete to authenticated
  using (public.can_edit_task(id));

create policy "labels: everyone signed in can see"
  on public.labels for select to authenticated
  using (true);

create policy "labels: everyone signed in can create"
  on public.labels for insert to authenticated
  with check (created_by = auth.uid());

create policy "labels: admin edits"
  on public.labels for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "labels: admin deletes"
  on public.labels for delete to authenticated
  using (public.is_admin());

create policy "task_labels: visible with the task"
  on public.task_labels for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and public.can_see_project(t.project_id)));

create policy "task_labels: task editor adds"
  on public.task_labels for insert to authenticated
  with check (public.can_edit_task(task_id));

create policy "task_labels: task editor removes"
  on public.task_labels for delete to authenticated
  using (public.can_edit_task(task_id));
