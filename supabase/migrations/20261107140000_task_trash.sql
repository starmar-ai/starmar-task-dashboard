-- Trash for tasks: deleting a task moves it to Trash instead of removing it.
-- A trashed task disappears from every list and count, stops blocking the tasks that wait for it,
-- and can be restored or deleted for good by its owner (assignee or creator) or the admin.
-- The app empties Trash entries older than 30 days when someone who can edit them opens the app.

alter table public.tasks
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id) on delete set null;

create index tasks_deleted_idx on public.tasks (deleted_at) where deleted_at is not null;

-- Trashed tasks are invisible to normal queries; only list_trash() shows them.
drop policy if exists "tasks: visible with the project" on public.tasks;
create policy "tasks: visible with the project"
  on public.tasks for select to authenticated
  using (public.can_see_project(project_id) and deleted_at is null);

-- A trashed task no longer holds back the tasks that waited for it.
create or replace function public.task_has_open_dependency(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_dependencies d
    join public.tasks p on p.id = d.depends_on_id
    where d.task_id = tid and p.status <> 'done' and p.deleted_at is null
  );
$$;

create or replace function public.trash_task(p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  waiting uuid;
begin
  if not public.can_edit_task(p_task) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.tasks set deleted_at = now(), deleted_by = auth.uid()
  where id = p_task and deleted_at is null;
  for waiting in select d.task_id from public.task_dependencies d where d.depends_on_id = p_task loop
    perform public.refresh_task_block(waiting);
  end loop;
end;
$$;

create or replace function public.restore_task(p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  waiting uuid;
begin
  if not public.can_edit_task(p_task) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.tasks set deleted_at = null, deleted_by = null
  where id = p_task and deleted_at is not null;
  perform public.refresh_task_block(p_task);
  for waiting in select d.task_id from public.task_dependencies d where d.depends_on_id = p_task loop
    perform public.refresh_task_block(waiting);
  end loop;
end;
$$;

-- Permanent delete. Only a task that is already in Trash can be removed this way.
create or replace function public.purge_task(p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_task(p_task) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.tasks where id = p_task and deleted_at is not null;
end;
$$;

create or replace function public.list_trash()
returns setof public.tasks
language sql
stable
security definer
set search_path = ''
as $$
  select t.*
  from public.tasks t
  where t.deleted_at is not null and public.can_edit_task(t.id)
  order by t.deleted_at desc;
$$;

revoke all on function public.trash_task(uuid), public.restore_task(uuid), public.purge_task(uuid), public.list_trash() from public, anon;
grant execute on function public.trash_task(uuid), public.restore_task(uuid), public.purge_task(uuid), public.list_trash() to authenticated;
