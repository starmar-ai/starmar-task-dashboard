-- Checklist items inside a task.
-- Everyone who can see the task can read its checklist.
-- Adding, ticking, renaming, reordering and removing: the task owner (assignee or creator) or the admin.

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  done boolean not null default false,
  position integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index task_checklist_items_task_idx on public.task_checklist_items (task_id, position, created_at);

alter table public.task_checklist_items enable row level security;

create policy "task_checklist_items: visible with the task"
  on public.task_checklist_items for select to authenticated
  using (public.can_see_task(task_id));

create policy "task_checklist_items: task owner adds"
  on public.task_checklist_items for insert to authenticated
  with check (public.is_active_user() and public.can_edit_task(task_id));

create policy "task_checklist_items: task owner edits"
  on public.task_checklist_items for update to authenticated
  using (public.is_active_user() and public.can_edit_task(task_id))
  with check (public.is_active_user() and public.can_edit_task(task_id));

create policy "task_checklist_items: task owner removes"
  on public.task_checklist_items for delete to authenticated
  using (public.is_active_user() and public.can_edit_task(task_id));

-- The Data API roles need explicit grants on new tables.
grant select, insert, update, delete on public.task_checklist_items to authenticated;
revoke all on public.task_checklist_items from anon;
