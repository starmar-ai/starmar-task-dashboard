-- Stage 6 part 2: "Ajukan perubahan" (change requests).
--
-- A member who can see a task but does not own it (not assignee, not creator, not admin) can ask for
-- one change: a field, the new value, and a reason. The task owner or the admin approves or rejects.
-- Approving applies the change to the task. Nothing is ever applied automatically, and a request that
-- waits a long time only produces a reminder in the app.
-- The table doubles as the log: who asked, what was asked, who decided, when, and the note.

create type public.change_request_field as enum ('title', 'description', 'priority', 'start_date', 'deadline', 'assignee_id');
create type public.change_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  requester_id uuid references public.profiles (id) on delete set null default auth.uid(),
  field public.change_request_field not null,
  -- Values are kept as text: dates as YYYY-MM-DD, priority as its name, assignee as a profile id.
  old_value text,
  new_value text,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  status public.change_request_status not null default 'pending',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  created_at timestamptz not null default now()
);

create index change_requests_task_idx on public.change_requests (task_id);
create index change_requests_pending_idx on public.change_requests (created_at) where status = 'pending';
-- One open request per person, task, and field: ask again after it is decided.
create unique index change_requests_one_pending
  on public.change_requests (task_id, requester_id, field) where status = 'pending';

alter table public.change_requests enable row level security;

-- Seen by the person who asked, the task owner, and the admin. All writes go through the functions below.
create policy "change_requests: asker, task owner, and admin see them"
  on public.change_requests for select to authenticated
  using (
    public.is_active_user()
    and (requester_id = auth.uid() or public.can_edit_task(task_id))
  );

grant select on public.change_requests to authenticated;

-- Ask for a change. p_value is null to clear an optional field (start date, description, assignee).
create or replace function public.submit_change_request(p_task uuid, p_field public.change_request_field, p_value text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  tk public.tasks%rowtype;
  cur text;
  val text := nullif(btrim(coalesce(p_value, '')), '');
  new_id uuid;
begin
  if me is null or not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into tk from public.tasks where id = p_task and deleted_at is null;
  if not found or not public.can_see_project(tk.project_id) then
    raise exception 'task_not_found' using errcode = '42501';
  end if;
  if public.can_edit_task(p_task) then
    raise exception 'edit_directly';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason_required';
  end if;

  cur := case p_field
    when 'title' then tk.title
    when 'description' then tk.description
    when 'priority' then tk.priority::text
    when 'start_date' then tk.start_date::text
    when 'deadline' then tk.deadline::text
    when 'assignee_id' then tk.assignee_id::text
  end;

  -- Check the value now so a request that could never be applied is refused up front.
  if p_field in ('title', 'deadline', 'priority') and val is null then
    raise exception 'value_required';
  end if;
  if p_field = 'title' and char_length(val) > 200 then
    raise exception 'value_invalid';
  end if;
  if p_field = 'priority' then
    perform val::public.task_priority;
  elsif p_field in ('start_date', 'deadline') and val is not null then
    perform val::date;
  elsif p_field = 'assignee_id' and val is not null then
    if not public.user_can_see_project(val::uuid, tk.project_id) then
      raise exception 'person_not_in_project';
    end if;
  end if;
  if val is not distinct from cur then
    raise exception 'no_change';
  end if;

  insert into public.change_requests (task_id, requester_id, field, old_value, new_value, reason)
  values (p_task, me, p_field, cur, val, btrim(p_reason))
  returning id into new_id;
  return new_id;
exception
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'value_invalid';
  when unique_violation then
    raise exception 'duplicate_request';
end;
$$;

-- Approve or reject. The task owner (assignee or creator) or the admin decides, never the asker.
-- Approving applies the change to the task in the same step; if the task rejects it (for example the
-- new deadline falls before the start date) nothing is applied and the request stays pending.
create or replace function public.decide_change_request(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.change_requests%rowtype;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if me is null or not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.change_requests where id = p_id for update;
  if not found then
    raise exception 'request_not_found' using errcode = '42501';
  end if;
  if not (public.is_admin() or (public.can_edit_task(r.task_id) and r.requester_id is distinct from me)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'already_decided';
  end if;

  if p_approve then
    if not exists (select 1 from public.tasks where id = r.task_id and deleted_at is null) then
      raise exception 'task_not_found';
    end if;
    case r.field
      when 'title' then update public.tasks set title = r.new_value where id = r.task_id;
      when 'description' then update public.tasks set description = r.new_value where id = r.task_id;
      when 'priority' then update public.tasks set priority = r.new_value::public.task_priority where id = r.task_id;
      when 'start_date' then update public.tasks set start_date = r.new_value::date where id = r.task_id;
      when 'deadline' then update public.tasks set deadline = r.new_value::date where id = r.task_id;
      when 'assignee_id' then update public.tasks set assignee_id = r.new_value::uuid where id = r.task_id;
    end case;
  elsif note is null then
    raise exception 'note_required';
  end if;

  update public.change_requests
  set status = case when p_approve then 'approved'::public.change_request_status else 'rejected'::public.change_request_status end,
      decided_by = me,
      decided_at = now(),
      decision_note = note
  where id = p_id;
end;
$$;

-- The asker withdraws their own request while it is still open.
create or replace function public.cancel_change_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.change_requests
  set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where id = p_id and requester_id = auth.uid() and status = 'pending' and public.is_active_user();
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.submit_change_request(uuid, public.change_request_field, text, text) from public, anon;
revoke all on function public.decide_change_request(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_change_request(uuid) from public, anon;
grant execute on function public.submit_change_request(uuid, public.change_request_field, text, text) to authenticated;
grant execute on function public.decide_change_request(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_change_request(uuid) to authenticated;
