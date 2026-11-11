-- Projects finish and archive themselves.
--
--   * When every (non-trashed) task of a project is Done, the project becomes "Selesai" and moves to the
--     Archive tab on the Projects page (projects.archived = true).
--   * Opening a task again, or adding a new task, brings an auto-finished project back to "Aktif".
--   * Tasks of an archived project stay visible but are read-only. The only edit that goes through is
--     reopening a Done task (or restoring one from Trash), which also reactivates the project.
--   * tasks.completed_at records when a task became Done. It is cleared when the task is reopened.
--     Existing Done tasks get their updated_at as the best guess.
--   * The "Ada yang telat" flag never shows for an archived project.

-- 1. completed_at --------------------------------------------------------------------------------

alter table public.tasks add column if not exists completed_at timestamptz;

-- Backfill without touching updated_at or firing the other task triggers.
alter table public.tasks disable trigger user;
update public.tasks set completed_at = updated_at where status = 'done' and completed_at is null;
alter table public.tasks enable trigger user;

create or replace function public.set_task_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := now();
    else
      new.completed_at := coalesce(old.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

-- Named so it fires after tasks_guard_status, which can still change the final status.
create trigger tasks_set_completed_at
  before insert or update on public.tasks
  for each row execute function public.set_task_completed_at();

-- 2. Archived projects are read-only -------------------------------------------------------------

create or replace function public.guard_archived_project_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_archived boolean;
begin
  select p.archived into is_archived from public.projects p where p.id = old.project_id;
  if coalesce(is_archived, false) then
    -- Allowed ways out of the archive: reopen a Done task, or restore a task from Trash.
    if (old.status = 'done' and new.status <> 'done') or (old.deleted_at is not null and new.deleted_at is null) then
      return new;
    end if;
    raise exception 'project_archived' using hint = 'This project is archived. Reopen a task or restore the project first.';
  end if;

  if new.project_id is distinct from old.project_id then
    select p.archived into is_archived from public.projects p where p.id = new.project_id;
    if coalesce(is_archived, false) then
      raise exception 'project_archived' using hint = 'The target project is archived. Restore it first.';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_archive_guard
  before update on public.tasks
  for each row execute function public.guard_archived_project_task();

-- 3. Finish / reactivate the project when its tasks change ---------------------------------------

create or replace function public.sync_project_completion(pid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  total int;
  finished int;
begin
  select
    count(*) filter (where t.deleted_at is null),
    count(*) filter (where t.deleted_at is null and t.status = 'done')
  into total, finished
  from public.tasks t
  where t.project_id = pid;

  if total > 0 and finished = total then
    update public.projects
    set status = 'selesai', archived = true
    where id = pid and (status <> 'selesai' or not archived);
  elsif finished < total then
    update public.projects
    set status = 'aktif', archived = false
    where id = pid and status = 'selesai';
  end if;
end;
$$;

create or replace function public.on_task_change_sync_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_project_completion(old.project_id);
    return old;
  end if;
  perform public.sync_project_completion(new.project_id);
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    perform public.sync_project_completion(old.project_id);
  end if;
  return new;
end;
$$;

create trigger tasks_sync_project
  after insert or delete or update of status, deleted_at, project_id on public.tasks
  for each row execute function public.on_task_change_sync_project();

-- These only run from triggers: nobody needs to call them.
revoke all on function public.set_task_completed_at() from public, anon, authenticated;
revoke all on function public.guard_archived_project_task() from public, anon, authenticated;
revoke all on function public.sync_project_completion(uuid) from public, anon, authenticated;
revoke all on function public.on_task_change_sync_project() from public, anon, authenticated;

-- 4. Project overview: no late flag for archived projects, plus the finish date -------------------
-- New column goes last: create or replace view cannot reorder existing ones.

create or replace view public.project_overview
with (security_invoker = true)
as
select
  p.*,
  coalesce(stats.total, 0)::int as task_total,
  coalesce(stats.done, 0)::int as task_done,
  coalesce(stats.overdue, 0)::int as task_overdue,
  stats.first_date,
  stats.last_deadline,
  (coalesce(stats.overdue, 0) > 0 and not p.archived) as at_risk,
  case when p.archived and stats.total > 0 and stats.done = stats.total then stats.finished_at end as finished_at
from public.projects p
left join lateral (
  select
    count(*) as total,
    count(*) filter (where t.status = 'done') as done,
    count(*) filter (
      where t.status <> 'done' and t.deadline < (now() at time zone 'Asia/Jakarta')::date
    ) as overdue,
    min(coalesce(t.start_date, t.deadline)) as first_date,
    max(t.deadline) as last_deadline,
    max(t.completed_at) as finished_at
  from public.tasks t
  where t.project_id = p.id
) stats on true;

grant select on public.project_overview to authenticated, service_role;

-- 5. One-time catch-up: projects whose tasks are all Done already move to the archive ------------

do $$
declare
  pid uuid;
begin
  for pid in select id from public.projects loop
    perform public.sync_project_completion(pid);
  end loop;
end;
$$;
