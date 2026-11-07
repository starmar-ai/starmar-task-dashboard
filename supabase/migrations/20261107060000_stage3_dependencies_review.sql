-- Stage 3: task dependencies with automatic Blocked, and the reviewer's approve/reject step.
--
-- Dependency "B waits for A": B stays Blocked while A is not Done. When A becomes Done, B goes back
-- to the status it had before it was blocked. Dates are never moved automatically.
-- Review: a task with a reviewer goes Review -> Done only through the reviewer (or the admin).
-- A rejection sends it back to In Progress and keeps the reviewer's note on the task.

alter table public.tasks
  add column blocked_from public.task_status,
  add column review_note text check (review_note is null or char_length(btrim(review_note)) between 1 and 1000),
  add column review_note_by uuid references public.profiles (id) on delete set null,
  add column review_note_at timestamptz;

-- Nothing could be blocked before this migration, so any stray Blocked goes back to To Do.
update public.tasks set status = 'todo' where status = 'blocked';

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_id uuid not null references public.tasks (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  constraint task_dependencies_not_self check (task_id <> depends_on_id)
);

create index task_dependencies_depends_on_idx on public.task_dependencies (depends_on_id);

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
    where d.task_id = tid and p.status <> 'done'
  );
$$;

-- Runs on every task update and keeps the status honest:
--   * open dependency: the task cannot be finished, and any other status is held as Blocked
--     (the wanted status is remembered in blocked_from and restored on unblock);
--   * no open dependency: Blocked is lifted back to blocked_from (or To Do);
--   * a task with a reviewer reaches Done only through the reviewer or the admin.
create or replace function public.guard_task_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.task_has_open_dependency(new.id) then
    if new.status = 'done' and old.status <> 'done' then
      raise exception 'task_blocked' using hint = 'Finish the tasks it waits for first.';
    elsif new.status not in ('blocked', 'done') then
      new.blocked_from := new.status;
      new.status := 'blocked';
    end if;
  elsif new.status = 'blocked' then
    new.status := coalesce(new.blocked_from, 'todo');
    new.blocked_from := null;
  else
    new.blocked_from := null;
  end if;

  if new.status = 'done' and old.status <> 'done'
    and new.reviewer_id is not null
    and new.reviewer_id is distinct from auth.uid()
    and not public.is_admin()
  then
    raise exception 'needs_review' using hint = 'Send the task to Review; the reviewer approves it.';
  end if;

  return new;
end;
$$;

create trigger tasks_guard_status
  before update on public.tasks
  for each row execute function public.guard_task_status();

-- Re-check one task. The guard trigger above decides the actual status.
create or replace function public.refresh_task_block(tid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks set status = status
  where id = tid
    and status <> 'done'
    and (status = 'blocked') is distinct from public.task_has_open_dependency(tid);
end;
$$;

create or replace function public.on_dependency_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_task_block(coalesce(new.task_id, old.task_id));
  return null;
end;
$$;

create trigger task_dependencies_refresh
  after insert or delete on public.task_dependencies
  for each row execute function public.on_dependency_change();

-- When a task becomes Done (or is reopened), the tasks waiting for it are re-checked.
create or replace function public.on_task_done_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  waiting uuid;
begin
  if (old.status = 'done') is distinct from (new.status = 'done') then
    for waiting in select d.task_id from public.task_dependencies d where d.depends_on_id = new.id loop
      perform public.refresh_task_block(waiting);
    end loop;
  end if;
  return null;
end;
$$;

create trigger tasks_refresh_dependents
  after update of status on public.tasks
  for each row execute function public.on_task_done_change();

-- No loops: A waits for B and B (directly or further down) waits for A is refused.
create or replace function public.guard_dependency_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    with recursive chain as (
      select d.depends_on_id as id from public.task_dependencies d where d.task_id = new.depends_on_id
      union
      select d.depends_on_id from public.task_dependencies d join chain c on d.task_id = c.id
    )
    select 1 from chain where id = new.task_id
  ) then
    raise exception 'dependency_cycle' using hint = 'That task already waits for this one.';
  end if;
  return new;
end;
$$;

create trigger task_dependencies_no_cycle
  before insert on public.task_dependencies
  for each row execute function public.guard_dependency_cycle();

-- Reviewer step -------------------------------------------------------------

create or replace function public.review_task(p_task uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or not public.can_see_project(t.project_id) then
    raise exception 'task not found';
  end if;
  if not (t.reviewer_id = auth.uid() or public.is_admin()) then
    raise exception 'only the reviewer can review this task' using errcode = '42501';
  end if;
  if t.status <> 'review' then
    raise exception 'task_not_in_review';
  end if;

  if p_approve then
    update public.tasks
    set status = 'done', review_note = null, review_note_by = null, review_note_at = null
    where id = p_task;
  else
    if p_note is null or char_length(btrim(p_note)) = 0 then
      raise exception 'review_note_required';
    end if;
    update public.tasks
    set status = 'in_progress', review_note = left(btrim(p_note), 1000), review_note_by = auth.uid(), review_note_at = now()
    where id = p_task;
  end if;
end;
$$;

-- row level security --------------------------------------------------------

alter table public.task_dependencies enable row level security;

create policy "task_dependencies: visible with the task"
  on public.task_dependencies for select to authenticated
  using (public.can_see_task(task_id));

create policy "task_dependencies: task editor adds"
  on public.task_dependencies for insert to authenticated
  with check (public.can_edit_task(task_id) and public.can_see_task(depends_on_id) and created_by = auth.uid());

create policy "task_dependencies: task editor removes"
  on public.task_dependencies for delete to authenticated
  using (public.can_edit_task(task_id));

grant select, insert, delete on public.task_dependencies to authenticated;
revoke all on public.task_dependencies from anon;

revoke all on function public.task_has_open_dependency(uuid) from public, anon;
revoke all on function public.refresh_task_block(uuid) from public, anon, authenticated;
revoke all on function public.review_task(uuid, boolean, text) from public, anon;
grant execute on function public.task_has_open_dependency(uuid) to authenticated;
grant execute on function public.review_task(uuid, boolean, text) to authenticated;
