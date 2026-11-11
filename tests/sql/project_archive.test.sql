-- Tests for auto-finishing and archiving projects. Each check raises on failure.
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
insert into auth.users (id, email, invited_at) values ('00000000-0000-0000-0000-00000000000b', 'alfa@example.com', now());
\set fadli '''00000000-0000-0000-0000-00000000000a'''
\set alfa '''00000000-0000-0000-0000-00000000000b'''
\set p1 '''10000000-0000-0000-0000-000000000001'''
\set p2 '''10000000-0000-0000-0000-000000000002'''

-- A Done task from before the migration gets completed_at = updated_at (simulated: the column starts empty).
select t.login(:fadli);
set role authenticated;
insert into public.projects (id, name) values (:p1, 'Website'), (:p2, 'Iklan');
insert into public.project_members (project_id, user_id) values (:p1, :alfa);
insert into public.tasks (id, project_id, title, deadline, assignee_id) values
  ('20000000-0000-0000-0000-000000000001', :p1, 'A', '2026-12-01', :fadli),
  ('20000000-0000-0000-0000-000000000002', :p1, 'B', '2026-12-01', :fadli),
  ('20000000-0000-0000-0000-000000000003', :p2, 'C', '2026-12-01', :fadli);

select t.expect((select completed_at is null from public.tasks where id = '20000000-0000-0000-0000-000000000001'), 'open task has no completed_at');
select t.expect((select status = 'aktif' and not archived from public.projects where id = :p1), 'project with open tasks stays active');

update public.tasks set status = 'done' where id = '20000000-0000-0000-0000-000000000001';
select t.expect((select completed_at is not null from public.tasks where id = '20000000-0000-0000-0000-000000000001'), 'completed_at set when a task turns Done');
select t.expect((select status = 'aktif' and not archived from public.projects where id = :p1), 'one task still open: project not finished');

update public.tasks set status = 'done' where id = '20000000-0000-0000-0000-000000000002';
select t.expect((select status = 'selesai' and archived from public.projects where id = :p1), 'all tasks Done: project is Selesai and archived');
select t.expect((select status = 'aktif' and not archived from public.projects where id = :p2), 'other project untouched');
select t.expect((select finished_at is not null and not at_risk from public.project_overview where id = :p1), 'overview reports finish date, no late flag');

-- Read-only.
select t.expect_error($$update public.tasks set title = 'baru' where id = '20000000-0000-0000-0000-000000000001'$$, 'project_archived');
select t.expect_error($$update public.tasks set deadline = '2027-01-01' where id = '20000000-0000-0000-0000-000000000001'$$, 'project_archived');
select t.expect_error($$update public.tasks set project_id = '10000000-0000-0000-0000-000000000001' where id = '20000000-0000-0000-0000-000000000003'$$, 'project_archived');
select t.expect(true, 'cannot move a task into an archived project');

-- Reopen one task: project is active again, completed_at cleared.
update public.tasks set status = 'in_progress' where id = '20000000-0000-0000-0000-000000000002';
select t.expect((select status = 'aktif' and not archived from public.projects where id = :p1), 'reopening a task reactivates the project');
select t.expect((select completed_at is null from public.tasks where id = '20000000-0000-0000-0000-000000000002'), 'completed_at cleared on reopen');
update public.tasks set title = 'B2' where id = '20000000-0000-0000-0000-000000000002';
select t.expect((select title = 'B2' from public.tasks where id = '20000000-0000-0000-0000-000000000002'), 'tasks editable again after reactivation');

-- Finish again, then add a new task: project reactivates.
update public.tasks set status = 'done' where id = '20000000-0000-0000-0000-000000000002';
select t.expect((select archived from public.projects where id = :p1), 'finished again');
insert into public.tasks (id, project_id, title, deadline) values ('20000000-0000-0000-0000-000000000004', :p1, 'D', '2026-12-05');
select t.expect((select status = 'aktif' and not archived from public.projects where id = :p1), 'a new task reactivates the project');

-- Trash: trashing the last open task finishes the project; restoring it reactivates.
select public.trash_task('20000000-0000-0000-0000-000000000004');
select t.expect((select archived from public.projects where id = :p1), 'trashing the last open task finishes the project');
select public.restore_task('20000000-0000-0000-0000-000000000004');
select t.expect((select status = 'aktif' and not archived from public.projects where id = :p1), 'restoring a task from Trash reactivates the project');

-- Restore from the archive by hand (what the Pulihkan button does).
update public.tasks set status = 'done' where id = '20000000-0000-0000-0000-000000000004';
select t.expect((select archived from public.projects where id = :p1), 'archived again');
update public.projects set archived = false, status = 'aktif' where id = :p1;
update public.tasks set title = 'D2' where id = '20000000-0000-0000-0000-000000000004';
select t.expect((select title = 'D2' from public.tasks where id = '20000000-0000-0000-0000-000000000004'), 'manual restore makes tasks editable');

-- A project with no tasks never auto-archives.
insert into public.projects (id, name) values ('10000000-0000-0000-0000-000000000009', 'Kosong');
select t.expect((select status = 'aktif' and not archived from public.projects where id = '10000000-0000-0000-0000-000000000009'), 'empty project stays active');

-- Triggers are not callable by users.
select t.expect_error($$select public.sync_project_completion('10000000-0000-0000-0000-000000000001')$$, 'permission denied');
select t.expect(true, 'sync function is not callable by signed-in users');
reset role;
\echo all project archive tests passed
