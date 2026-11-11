-- Notifications: in-app bell + email (one daily summary, plus an immediate email only for urgent tasks).
--
-- How it works
--   * Things that happen (assigned, review step, comment, change request, unblocked) are written to
--     public.notifications by triggers, the moment they happen.
--   * Deadline things (due tomorrow / today, overdue, team overdue for the admin, change request waiting
--     for 2 working days) are written by public.generate_deadline_notifications(), which pg_cron runs
--     every hour. It acts for each person from 08:00 in their own timezone, on workdays (Mon-Fri).
--     Every deadline notification has a unique key, so running it again never creates a duplicate.
--   * The same hourly job then calls the Vercel function /api/notify, which emails each person their
--     summary once per day at 08:00 and sends the immediate emails for urgent tasks.
--   * Each person chooses what they get in Settings (public.notification_settings).
--
-- Run this in the Supabase SQL Editor. Afterwards run notifications_setup_rahasia.sql once
-- (it stores the address and the shared secret that /api/notify checks).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- tables --------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- kind is the group a person can switch off; event is the exact thing that happened.
  kind text not null check (kind in ('assigned', 'due_soon', 'overdue', 'review', 'comment', 'request', 'unblocked', 'team_overdue')),
  event text not null check (event in (
    'assigned', 'due_tomorrow', 'due_today', 'overdue', 'team_overdue',
    'review_requested', 'review_approved', 'review_rejected',
    'comment', 'request_new', 'request_approved', 'request_rejected', 'request_stale', 'unblocked'
  )),
  task_id uuid not null references public.tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  -- Free text for the message: comment excerpt, review note, decision note, or the assignee's name.
  detail text check (detail is null or char_length(detail) <= 300),
  -- For request events: which field the request is about.
  field text,
  urgent boolean not null default false,
  -- True when the email should go out right away instead of waiting for the daily summary.
  email_now boolean not null default false,
  dedupe_key text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz,
  unique (user_id, dedupe_key)
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_unsent_idx on public.notifications (user_id) where emailed_at is null;

create table public.notification_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Groups the person does not want, in the bell and in email.
  muted_kinds text[] not null default '{}',
  email_daily boolean not null default true,
  email_urgent boolean not null default true,
  -- Local date of the last daily summary, so it goes out once per day.
  digest_sent_on date,
  updated_at timestamptz not null default now()
);

-- Address and secret of /api/notify. Nobody signed in can read this table.
create table public.notify_config (
  key text primary key,
  value text not null
);

alter table public.notifications enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notify_config enable row level security;

create policy "notifications: own only"
  on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());

create policy "notification_settings: own only"
  on public.notification_settings for select to authenticated
  using (user_id = auth.uid());

revoke all on public.notifications, public.notification_settings, public.notify_config from public, anon, authenticated;
grant select on public.notifications, public.notification_settings to authenticated;

-- writing one notification ---------------------------------------------------

-- Skips the person who did the thing, people who cannot see the task, and groups they switched off.
create or replace function public.notify_user(
  p_user uuid,
  p_kind text,
  p_event text,
  p_task uuid,
  p_detail text,
  p_actor uuid,
  p_urgent boolean,
  p_email_now boolean,
  p_key text default null,
  p_field text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  proj uuid;
  muted text[];
begin
  if p_user is null or p_user is not distinct from p_actor then
    return;
  end if;
  select project_id into proj from public.tasks where id = p_task;
  if not found or not public.user_can_see_project(p_user, proj) then
    return;
  end if;
  select muted_kinds into muted from public.notification_settings where user_id = p_user;
  if muted is not null and p_kind = any (muted) then
    return;
  end if;
  insert into public.notifications (user_id, kind, event, task_id, actor_id, detail, field, urgent, email_now, dedupe_key)
  values (p_user, p_kind, p_event, p_task, p_actor, left(p_detail, 300), p_field, p_urgent, p_email_now, coalesce(p_key, gen_random_uuid()::text))
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

-- triggers for things that just happened -------------------------------------

create or replace function public.notify_on_task_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  urgent boolean := new.priority = 'urgent';
begin
  perform public.notify_user(new.assignee_id, 'assigned', 'assigned', new.id, null, auth.uid(), urgent, urgent);
  return null;
end;
$$;

create trigger tasks_notify_insert
  after insert on public.tasks
  for each row execute function public.notify_on_task_insert();

create or replace function public.notify_on_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  urgent boolean := new.priority = 'urgent';
  me uuid := auth.uid();
begin
  if new.deleted_at is not null then
    return null;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    perform public.notify_user(new.assignee_id, 'assigned', 'assigned', new.id, null, me, urgent, urgent);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'review' and new.reviewer_id is not null then
      perform public.notify_user(new.reviewer_id, 'review', 'review_requested', new.id, null, me, urgent, urgent);
    elsif old.status = 'review' and new.status = 'done' then
      perform public.notify_user(new.assignee_id, 'review', 'review_approved', new.id, null, me, urgent, urgent);
    elsif old.status = 'review' and new.status = 'in_progress' then
      perform public.notify_user(new.assignee_id, 'review', 'review_rejected', new.id, new.review_note, me, urgent, urgent);
    end if;

    if old.status = 'blocked' and new.status <> 'blocked' then
      perform public.notify_user(new.assignee_id, 'unblocked', 'unblocked', new.id, null, me, urgent, urgent);
    end if;
  end if;
  return null;
end;
$$;

create trigger tasks_notify_update
  after update on public.tasks
  for each row execute function public.notify_on_task_update();

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tk public.tasks%rowtype;
  who uuid;
  urgent boolean;
begin
  select * into tk from public.tasks where id = new.task_id and deleted_at is null;
  if not found then
    return null;
  end if;
  urgent := tk.priority = 'urgent';
  for who in
    select distinct u from unnest(array[tk.assignee_id, tk.created_by, tk.reviewer_id]) as u where u is not null
  loop
    perform public.notify_user(who, 'comment', 'comment', tk.id, new.body, new.author_id, urgent, urgent);
  end loop;
  return null;
end;
$$;

create trigger task_comments_notify
  after insert on public.task_comments
  for each row execute function public.notify_on_comment();

create or replace function public.notify_on_change_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tk public.tasks%rowtype;
  who uuid;
  urgent boolean;
begin
  select * into tk from public.tasks where id = new.task_id;
  if not found then
    return null;
  end if;
  urgent := tk.priority = 'urgent';

  if tg_op = 'INSERT' then
    -- The task owner and every admin hear about a new request.
    for who in
      select distinct u from (
        select unnest(array[tk.assignee_id, tk.created_by]) as u
        union all
        select id from public.profiles where role = 'admin' and active
      ) s where u is not null
    loop
      perform public.notify_user(who, 'request', 'request_new', tk.id, new.reason, new.requester_id, urgent, urgent, null, new.field::text);
    end loop;
  elsif new.status in ('approved', 'rejected') and old.status = 'pending' then
    perform public.notify_user(
      new.requester_id, 'request',
      case new.status when 'approved' then 'request_approved' else 'request_rejected' end,
      tk.id, new.decision_note, new.decided_by, urgent, urgent, null, new.field::text
    );
  end if;
  return null;
end;
$$;

create trigger change_requests_notify
  after insert or update of status on public.change_requests
  for each row execute function public.notify_on_change_request();

-- the hourly job -------------------------------------------------------------

-- Working days (Mon-Fri) after a, up to and including b. Same counting as the app's change-request reminder.
create or replace function public.working_days_between(a date, b date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
  from generate_series(a::timestamp + interval '1 day', b::timestamp, interval '1 day') d
  where extract(isodow from d) < 6;
$$;

create or replace function public.generate_deadline_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  tk record;
  cr record;
  local_now timestamp;
  today date;
  next_workday date;
  urgent boolean;
begin
  for p in select id, role, timezone from public.profiles where active loop
    local_now := now() at time zone p.timezone;
    today := local_now::date;
    -- From 08:00 local time, on workdays only.
    continue when extract(hour from local_now) < 8 or extract(isodow from today) > 5;
    next_workday := today + case when extract(isodow from today) = 5 then 3 else 1 end;

    -- Their own tasks: due soon, due today, overdue (once each).
    for tk in
      select id, deadline, priority from public.tasks
      where assignee_id = p.id and deleted_at is null and status <> 'done' and deadline <= next_workday
    loop
      urgent := tk.priority = 'urgent';
      if tk.deadline < today then
        perform public.notify_user(p.id, 'overdue', 'overdue', tk.id, null, null, urgent, false, 'overdue:' || tk.id || ':' || tk.deadline);
      elsif tk.deadline = today then
        perform public.notify_user(p.id, 'due_soon', 'due_today', tk.id, null, null, urgent, false, 'due_today:' || tk.id || ':' || tk.deadline);
      else
        perform public.notify_user(p.id, 'due_soon', 'due_tomorrow', tk.id, null, null, urgent, false, 'due_tomorrow:' || tk.id || ':' || tk.deadline);
      end if;
    end loop;

    if p.role = 'admin' then
      -- Team tasks that are more than one working day late.
      for tk in
        select t.id, t.deadline, t.priority, a.full_name
        from public.tasks t
        left join public.profiles a on a.id = t.assignee_id
        where t.deleted_at is null and t.status <> 'done'
          and t.assignee_id is distinct from p.id
          and t.deadline < today
          and public.working_days_between(t.deadline, today) >= 2
      loop
        perform public.notify_user(
          p.id, 'team_overdue', 'team_overdue', tk.id, tk.full_name, null,
          tk.priority = 'urgent', false, 'team_overdue:' || tk.id || ':' || tk.deadline
        );
      end loop;

      -- Change requests nobody answered for 2 working days (reminder only, never applied).
      for cr in
        select id, task_id, field from public.change_requests
        where status = 'pending'
          and public.working_days_between((created_at at time zone p.timezone)::date, today) >= 2
      loop
        perform public.notify_user(p.id, 'request', 'request_stale', cr.task_id, null, null, false, false, 'stale:' || cr.id, cr.field::text);
      end loop;
    end if;
  end loop;

  -- Housekeeping: read ones go after 30 days, everything after 90.
  delete from public.notifications
  where (read_at is not null and read_at < now() - interval '30 days') or created_at < now() - interval '90 days';
end;
$$;

-- Calls /api/notify. A failure here must never break the change that caused it.
create or replace function public.fire_notify(p_mode text, p_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  addr text;
  secret text;
begin
  select value into addr from public.notify_config where key = 'url';
  select value into secret from public.notify_config where key = 'secret';
  if addr is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := addr,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := jsonb_build_object('mode', p_mode, 'id', p_id)
  );
exception
  when others then
    raise warning 'fire_notify failed: %', sqlerrm;
end;
$$;

create or replace function public.run_notification_cron()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.generate_deadline_notifications();
  perform public.fire_notify('digest');
end;
$$;

create or replace function public.notify_urgent_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fire_notify('urgent', new.id);
  return null;
end;
$$;

create trigger notifications_urgent_email
  after insert on public.notifications
  for each row when (new.email_now)
  execute function public.notify_urgent_email();

-- what the app calls ---------------------------------------------------------

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

create or replace function public.save_notification_settings(p_muted text[], p_daily boolean, p_urgent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.notification_settings (user_id, muted_kinds, email_daily, email_urgent)
  values (
    auth.uid(),
    coalesce(array(select k from unnest(p_muted) k where k in ('assigned', 'due_soon', 'overdue', 'review', 'comment', 'request', 'unblocked', 'team_overdue')), '{}'),
    coalesce(p_daily, true),
    coalesce(p_urgent, true)
  )
  on conflict (user_id) do update
  set muted_kinds = excluded.muted_kinds,
      email_daily = excluded.email_daily,
      email_urgent = excluded.email_urgent,
      updated_at = now();
end;
$$;

revoke all on function public.notify_user(uuid, text, text, uuid, text, uuid, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.generate_deadline_notifications() from public, anon, authenticated;
revoke all on function public.fire_notify(text, uuid) from public, anon, authenticated;
revoke all on function public.run_notification_cron() from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.save_notification_settings(text[], boolean, boolean) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.save_notification_settings(text[], boolean, boolean) to authenticated;

-- schedule: every hour on the hour ---------------------------------------------

do $$
begin
  perform cron.unschedule('starmar-notifications');
exception
  when others then null;
end;
$$;

select cron.schedule('starmar-notifications', '0 * * * *', 'select public.run_notification_cron()');
