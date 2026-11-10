-- Access tests for Stage 6 part 2 (change requests). Each check raises on failure.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
\o /dev/null

create schema t;
grant usage on schema t to authenticated;
create function t.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
$$;
create function t.expect_error(stmt text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm !~* pattern then
      raise exception 'expected error like "%" from [%], got "%"', pattern, stmt, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error like "%" from [%], but it succeeded', pattern, stmt;
end;
$$;
create function t.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end;
$$;
grant execute on all functions in schema t to authenticated;

insert into auth.users (id, email, invited_at) values ('00000000-0000-0000-0000-00000000000a', 'fadli@example.com', null);
insert into auth.users (id, email, invited_at) values
  ('00000000-0000-0000-0000-00000000000b', 'alfa@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'fauzi@example.com', now());

\set fadli '''00000000-0000-0000-0000-00000000000a'''
\set alfa '''00000000-0000-0000-0000-00000000000b'''
\set fauzi '''00000000-0000-0000-0000-00000000000c'''
\set p1 '''10000000-0000-0000-0000-000000000001'''
\set p2 '''10000000-0000-0000-0000-000000000002'''
\set tk '''20000000-0000-0000-0000-000000000001'''
\set tk_fadli '''20000000-0000-0000-0000-000000000002'''
\set tk_other '''20000000-0000-0000-0000-000000000003'''

select t.login(:fadli);
set role authenticated;
insert into public.projects (id, name) values (:p1, 'Website'), (:p2, 'Iklan');
insert into public.project_members (project_id, user_id) values (:p1, :alfa), (:p1, :fauzi), (:p2, :fauzi);
insert into public.tasks (id, project_id, title, deadline, start_date, assignee_id) values
  (:tk, :p1, 'Desain hero', '2026-12-10', '2026-12-01', :alfa),
  (:tk_fadli, :p1, 'Tugas Fadli', '2026-12-10', null, :fadli),
  (:tk_other, :p2, 'Iklan Meta', '2026-12-10', null, :fauzi);
reset role;

-- Fauzi sees the task in Website, but Alfarizi owns it.
select t.login(:fauzi);
set role authenticated;
select t.expect_error($$select public.submit_change_request('20000000-0000-0000-0000-000000000001', 'priority', 'urgent', '   ')$$, 'reason_required');
select t.expect(true, 'a reason is required');
select t.expect_error($$select public.submit_change_request('20000000-0000-0000-0000-000000000001', 'deadline', '2026-12-10', 'sama')$$, 'no_change');
select t.expect(true, 'asking for the current value is refused');
select t.expect_error($$select public.submit_change_request('20000000-0000-0000-0000-000000000001', 'deadline', 'besok', 'x')$$, 'value_invalid');
select t.expect(true, 'a bad date is refused');
select t.expect_error($$select public.submit_change_request('20000000-0000-0000-0000-000000000001', 'title', '', 'x')$$, 'value_required');
select t.expect(true, 'an empty title is refused');
select t.expect_error($$select public.submit_change_request('20000000-0000-0000-0000-000000000003', 'priority', 'urgent', 'x')$$, 'edit_directly|task_not_found');
select t.expect(true, 'the owner of a task edits it directly instead of asking');
select public.submit_change_request('20000000-0000-0000-0000-000000000001', 'deadline', '2026-12-20', 'Klien minta mundur');
select t.expect((select count(*) = 1 from public.change_requests where old_value = '2026-12-10' and status = 'pending'), 'request saved with the old value and pending status');
select t.expect_error($$select public.submit_change_request('20000000-0000-0000-0000-000000000001', 'deadline', '2026-12-21', 'lagi')$$, 'duplicate_request');
select t.expect(true, 'only one open request per field');
select t.expect_error($$insert into public.change_requests (task_id, field, new_value, reason) values ('20000000-0000-0000-0000-000000000001', 'title', 'x', 'x')$$, 'permission denied|row-level security');
select t.expect(true, 'requests cannot be written directly');
select t.expect_error($$select public.decide_change_request((select id from public.change_requests), true)$$, 'not allowed');
select t.expect(true, 'the asker cannot approve their own request');
reset role;

-- Alfarizi (owner) sees it and approves.
select t.login(:alfa);
set role authenticated;
select t.expect((select count(*) = 1 from public.change_requests), 'task owner sees the request');
select public.submit_change_request('20000000-0000-0000-0000-000000000002', 'assignee_id', '00000000-0000-0000-0000-00000000000c', 'Fauzi lebih longgar');
select t.expect(true, 'a member can ask about the admin''s task');
select t.expect_error($$select public.decide_change_request((select id from public.change_requests where field = 'deadline'), false, '')$$, 'note_required');
select t.expect(true, 'rejecting needs a note');
select t.expect_error($$select public.decide_change_request((select id from public.change_requests where field = 'assignee_id'), true)$$, 'not allowed');
select t.expect(true, 'the asker cannot decide even if they own another task');
select public.decide_change_request((select id from public.change_requests where field = 'deadline'), true, 'Oke');
select t.expect((select deadline = '2026-12-20' from public.tasks where id = :tk), 'approving applies the new deadline');
select t.expect((select status = 'approved' and decided_by = :alfa and decision_note = 'Oke' from public.change_requests where field = 'deadline'), 'approval is logged');
select t.expect_error($$select public.decide_change_request((select id from public.change_requests where field = 'deadline'), false, 'x')$$, 'already_decided');
select t.expect(true, 'a decided request cannot be decided again');
reset role;

-- Fauzi cannot see Alfarizi's other requests; he withdraws his own.
select t.login(:fauzi);
set role authenticated;
select public.submit_change_request('20000000-0000-0000-0000-000000000001', 'priority', 'urgent', 'Penting');
select public.cancel_change_request((select id from public.change_requests where field = 'priority'));
select t.expect((select status = 'cancelled' from public.change_requests where field = 'priority'), 'the asker withdraws an open request');
select t.expect_error($$select public.cancel_change_request((select id from public.change_requests where field = 'deadline'))$$, 'not allowed');
select t.expect(true, 'a decided request cannot be withdrawn');
reset role;

-- The admin decides anything; a rejected deadline before the start date stays pending.
select t.login(:fauzi);
set role authenticated;
select public.submit_change_request('20000000-0000-0000-0000-000000000001', 'deadline', '2026-11-01', 'Dimajukan');
reset role;
select t.login(:fadli);
set role authenticated;
select t.expect((select count(*) = 4 from public.change_requests), 'admin sees every request');
select t.expect_error($$select public.decide_change_request((select id from public.change_requests where new_value = '2026-11-01'), true)$$, 'tasks_start_before_deadline');
select t.expect((select status = 'pending' from public.change_requests where new_value = '2026-11-01'), 'a change the task refuses stays pending');
select public.decide_change_request((select id from public.change_requests where new_value = '2026-11-01'), false, 'Terlalu cepat');
select t.expect((select status = 'rejected' and decision_note = 'Terlalu cepat' from public.change_requests where new_value = '2026-11-01'), 'admin rejects with a note');
select public.decide_change_request((select id from public.change_requests where field = 'assignee_id'), true);
select t.expect((select assignee_id = :fauzi from public.tasks where id = :tk_fadli), 'approving an assignee change reassigns the task');
reset role;
\echo all change request tests passed
