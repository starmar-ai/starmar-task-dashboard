-- Stage 6 part 1: invite-only team access.
--
-- * profiles.active: a person whose access is revoked (or who got in without an invite) is inactive.
--   Inactive people see nothing and cannot change anything, even with a session that is still valid.
-- * A task's assignee and reviewer must be someone who can open the task's project.
-- * Only the task creator or the admin can change the reviewer, so the person doing the work
--   cannot remove the review step from their own task.
-- * team_status(): invite status for the admin's Team page.

alter table public.profiles add column if not exists active boolean not null default true;

-- New accounts: the very first one is the admin. After that, only invited accounts start active;
-- an account made any other way (for example an open sign-up) waits until the admin activates it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  has_admin boolean := exists (select 1 from public.profiles where role = 'admin');
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when has_admin then 'member'::public.user_role else 'admin'::public.user_role end,
    not has_admin or new.invited_at is not null
  );
  return new;
end;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and active
  );
$$;

-- Whether a given person can open a project: active, and admin, PM, or project member.
create or replace function public.user_can_see_project(uid uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles u
    where u.id = uid
      and u.active
      and (
        u.role = 'admin'
        or exists (select 1 from public.projects p where p.id = pid and p.pm_id = uid)
        or exists (select 1 from public.project_members m where m.project_id = pid and m.user_id = uid)
      )
  );
$$;

create or replace function public.can_see_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_can_see_project(auth.uid(), pid);
$$;

-- Profile changes. auth.uid() is null only for server-side calls (the invite function with the
-- service key, or the SQL editor); signed-in requests always carry a user id.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  server_side boolean := auth.uid() is null;
begin
  if new.email is distinct from old.email and not server_side then
    raise exception 'email cannot be changed here';
  end if;
  if new.role is distinct from old.role then
    if not (server_side or public.is_admin()) then
      raise exception 'only an admin can change roles';
    end if;
    if old.role = 'admin' and not exists (
      select 1 from public.profiles where role = 'admin' and active and id <> old.id
    ) then
      raise exception 'at least one admin is required';
    end if;
  end if;
  if new.active is distinct from old.active then
    if not (server_side or public.is_admin()) then
      raise exception 'only an admin can change access';
    end if;
    if not new.active and old.id = auth.uid() then
      raise exception 'cannot_revoke_self';
    end if;
    if not new.active and new.role = 'admin' then
      raise exception 'cannot_revoke_admin';
    end if;
  end if;
  return new;
end;
$$;

-- Assignee and reviewer must be able to open the project; created_by and the reviewer are protected.
create or replace function public.guard_task_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  server_side boolean := auth.uid() is null;
  moved boolean := tg_op = 'INSERT' or new.project_id is distinct from old.project_id;
begin
  if tg_op = 'UPDATE' and not server_side then
    if new.created_by is distinct from old.created_by and not public.is_admin() then
      raise exception 'only an admin can change the task creator' using errcode = '42501';
    end if;
    if new.reviewer_id is distinct from old.reviewer_id
      and not (public.is_admin() or old.created_by = auth.uid())
    then
      raise exception 'reviewer_locked' using errcode = '42501';
    end if;
  end if;

  if new.assignee_id is not null
    and (moved or new.assignee_id is distinct from old.assignee_id)
    and not public.user_can_see_project(new.assignee_id, new.project_id)
  then
    raise exception 'person_not_in_project' using hint = 'Give this person access to the project first.';
  end if;
  if new.reviewer_id is not null
    and (moved or new.reviewer_id is distinct from old.reviewer_id)
    and not public.user_can_see_project(new.reviewer_id, new.project_id)
  then
    raise exception 'person_not_in_project' using hint = 'Give this person access to the project first.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_people on public.tasks;
create trigger tasks_guard_people
  before insert or update on public.tasks
  for each row execute function public.guard_task_people();

-- Policies that did not go through can_see_project/is_admin now also require an active account.
-- An inactive person can still read their own profile, so the app can tell them access was revoked.
drop policy if exists "profiles: signed-in users can see the team" on public.profiles;
create policy "profiles: signed-in users can see the team"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());

drop policy if exists "labels: everyone signed in can see" on public.labels;
create policy "labels: everyone signed in can see"
  on public.labels for select to authenticated
  using (public.is_active_user());

drop policy if exists "profiles: edit own profile, admin edits anyone" on public.profiles;
create policy "profiles: edit own profile, admin edits anyone"
  on public.profiles for update to authenticated
  using ((id = auth.uid() and public.is_active_user()) or public.is_admin())
  with check ((id = auth.uid() and public.is_active_user()) or public.is_admin());

drop policy if exists "labels: everyone signed in can create" on public.labels;
create policy "labels: everyone signed in can create"
  on public.labels for insert to authenticated
  with check (created_by = auth.uid() and public.is_active_user());

drop policy if exists "task_comments: author or admin deletes" on public.task_comments;
create policy "task_comments: author or admin deletes"
  on public.task_comments for delete to authenticated
  using ((author_id = auth.uid() and public.is_active_user()) or public.is_admin());

drop policy if exists "task_links: adder, task owner, or admin removes" on public.task_links;
create policy "task_links: adder, task owner, or admin removes"
  on public.task_links for delete to authenticated
  using ((created_by = auth.uid() and public.is_active_user()) or public.can_edit_task(task_id));

drop policy if exists "task_attachments: uploader, task owner, or admin removes" on public.task_attachments;
create policy "task_attachments: uploader, task owner, or admin removes"
  on public.task_attachments for delete to authenticated
  using ((uploaded_by = auth.uid() and public.is_active_user()) or public.can_edit_task(task_id));

drop policy if exists "task-files: uploader, task owner, or admin deletes" on storage.objects;
create policy "task-files: uploader, task owner, or admin deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-files'
    and (
      (owner_id = auth.uid()::text and public.is_active_user())
      or public.can_edit_task(public.task_file_task_id(name))
    )
  );

-- Invite status for the Team page. Admin only.
create or replace function public.team_status()
returns table (user_id uuid, invited_at timestamptz, joined_at timestamptz, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can see the team status' using errcode = '42501';
  end if;
  return query
    select u.id, u.invited_at, u.email_confirmed_at, u.last_sign_in_at
    from auth.users u
    join public.profiles p on p.id = u.id;
end;
$$;

revoke all on function public.user_can_see_project(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon;
revoke all on function public.team_status() from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.team_status() to authenticated;
grant execute on function public.user_can_see_project(uuid, uuid) to service_role;

-- The invite function (service key) reads profiles and adds project members. New Supabase tables
-- are not always open to service_role, so grant exactly what api/team.ts uses.
grant usage on schema public to service_role;
grant select, update on public.profiles to service_role;
grant select, insert on public.project_members to service_role;
