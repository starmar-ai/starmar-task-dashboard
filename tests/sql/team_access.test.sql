-- Access tests for Stage 6. Each check raises on failure, so psql stops at the first broken rule.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
\o /dev/null

create schema t;
grant usage on schema t to authenticated;

create function t.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
$$;

-- Runs a statement and checks it fails with a message matching the pattern.
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

-- People: Fadli signs up first (admin), Alfarizi and Fauzi are invited, a stranger signs up alone.
insert into auth.users (id, email, invited_at) values
  ('00000000-0000-0000-0000-00000000000a', 'fadli@example.com', null);
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000b', 'alfa@example.com', now(), '{"full_name":"Alfarizi"}'),
  ('00000000-0000-0000-0000-00000000000c', 'fauzi@example.com', now(), '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'stranger@example.com', null, '{}');

select t.expect((select role = 'admin' and active from public.profiles where email = 'fadli@example.com'), 'first account is an active admin');
select t.expect((select role = 'member' and active and full_name = 'Alfarizi' from public.profiles where email = 'alfa@example.com'), 'invited account is an active member with its name');
select t.expect((select role = 'member' and not active from public.profiles where email = 'stranger@example.com'), 'uninvited sign-up starts inactive');

\set fadli '''00000000-0000-0000-0000-00000000000a'''
\set alfa '''00000000-0000-0000-0000-00000000000b'''
\set fauzi '''00000000-0000-0000-0000-00000000000c'''
\set stranger '''00000000-0000-0000-0000-00000000000d'''

-- Fadli sets up two projects and a few tasks.
select t.login(:fadli);
set role authenticated;
insert into public.projects (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Website'),
  ('10000000-0000-0000-0000-000000000002', 'Iklan');
insert into public.project_members (project_id, user_id) values
  ('10000000-0000-0000-0000-000000000001', :alfa),
  ('10000000-0000-0000-0000-000000000002', :fauzi);
insert into public.tasks (id, project_id, title, deadline, assignee_id, reviewer_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Desain hero', '2026-12-01', :alfa, :fadli),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Tugas Fadli', '2026-12-01', :fadli, null),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Iklan Meta', '2026-12-01', :fauzi, null);
select t.expect_error($$insert into public.tasks (project_id, title, deadline, assignee_id) values ('10000000-0000-0000-0000-000000000002', 'x', '2026-12-01', '00000000-0000-0000-0000-00000000000b')$$, 'person_not_in_project');
select t.expect(true, 'admin cannot assign someone outside the project');
select t.expect((select count(*) = 4 from public.profiles), 'admin sees the whole team');
select t.expect((select count(*) = 1 from public.team_status() where user_id = :alfa and invited_at is not null), 'admin reads invite status');
reset role;

-- Alfarizi: member of Website only.
select t.login(:alfa);
set role authenticated;
select t.expect((select count(*) = 1 from public.projects), 'member sees only their project');
select t.expect((select count(*) = 2 from public.tasks), 'member sees tasks of their project only');
select t.expect((select count(*) = 0 from public.tasks where project_id = '10000000-0000-0000-0000-000000000002'), 'member does not see other projects'' tasks');
select t.expect_error($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'only an admin can change roles');
select t.expect(true, 'member cannot make themselves admin');
update public.profiles set active = false where id = :fauzi;
select t.expect((select active from public.profiles where id = :fauzi), 'member cannot revoke someone else');
select t.expect_error($$insert into public.project_members (project_id, user_id) values ('10000000-0000-0000-0000-000000000002', auth.uid())$$, 'row-level security');
select t.expect(true, 'member cannot add themselves to a project');
select t.expect_error($$select * from public.team_status()$$, 'only an admin');
select t.expect(true, 'member cannot read invite status');
select t.expect_error($$select public.user_can_see_project(auth.uid(), '10000000-0000-0000-0000-000000000002')$$, 'permission denied');
select t.expect(true, 'member cannot call the per-person access check');

update public.tasks set title = 'diubah' where id = '20000000-0000-0000-0000-000000000002';
select t.expect((select title = 'Tugas Fadli' from public.tasks where id = '20000000-0000-0000-0000-000000000002'), 'member cannot edit a task they do not own');
update public.tasks set title = 'Desain hero v2' where id = '20000000-0000-0000-0000-000000000001';
select t.expect((select title = 'Desain hero v2' from public.tasks where id = '20000000-0000-0000-0000-000000000001'), 'assignee edits their own task');
select t.expect_error($$update public.tasks set reviewer_id = null where id = '20000000-0000-0000-0000-000000000001'$$, 'reviewer_locked');
select t.expect(true, 'assignee cannot remove the reviewer Fadli set');
select t.expect_error($$update public.tasks set reviewer_id = auth.uid() where id = '20000000-0000-0000-0000-000000000001'$$, 'reviewer_locked');
select t.expect(true, 'assignee cannot make themselves the reviewer');
select t.expect_error($$update public.tasks set status = 'done' where id = '20000000-0000-0000-0000-000000000001'$$, 'needs_review');
select t.expect(true, 'assignee cannot finish a task that needs review');
select t.expect_error($$update public.tasks set created_by = auth.uid() where id = '20000000-0000-0000-0000-000000000001'$$, 'task creator');
select t.expect(true, 'member cannot take over created_by');
select t.expect_error($$update public.tasks set assignee_id = '00000000-0000-0000-0000-00000000000c' where id = '20000000-0000-0000-0000-000000000001'$$, 'person_not_in_project');
select t.expect(true, 'cannot hand a task to someone outside the project');

insert into public.tasks (id, project_id, title, deadline) values
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Tugas Alfa', '2026-12-02');
select t.expect((select assignee_id = :alfa and created_by = :alfa from public.tasks where id = '20000000-0000-0000-0000-000000000004'), 'member creates a task in their project');
update public.tasks set reviewer_id = :fadli where id = '20000000-0000-0000-0000-000000000004';
select t.expect((select reviewer_id = :fadli from public.tasks where id = '20000000-0000-0000-0000-000000000004'), 'creator picks a reviewer with access');
select t.expect_error($$insert into public.tasks (project_id, title, deadline) values ('10000000-0000-0000-0000-000000000002', 'x', '2026-12-01')$$, 'row-level security|person_not_in_project');
select t.expect(true, 'member cannot create tasks in another project');
select t.expect_error($$update public.tasks set project_id = '10000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000004'$$, 'row-level security|person_not_in_project');
select t.expect(true, 'member cannot move a task into a project they cannot see');
reset role;

-- The stranger who signed up without an invite.
select t.login(:stranger);
set role authenticated;
select t.expect((select count(*) = 1 from public.profiles), 'inactive account sees only its own profile');
select t.expect((select count(*) = 0 from public.projects), 'inactive account sees no projects');
select t.expect_error($$insert into public.labels (name) values ('spam')$$, 'row-level security');
select t.expect(true, 'inactive account cannot create labels');
reset role;

-- Fadli revokes Alfarizi, and the admin guard rails hold.
select t.login(:fadli);
set role authenticated;
select t.expect_error($$update public.profiles set active = false where id = auth.uid()$$, 'cannot_revoke_self|cannot_revoke_admin');
select t.expect(true, 'admin cannot revoke themselves');
select t.expect_error($$update public.profiles set role = 'member' where id = auth.uid()$$, 'at least one admin');
select t.expect(true, 'the last admin cannot be demoted');
update public.profiles set role = 'admin' where id = :fauzi;
select t.expect_error($$update public.profiles set active = false where id = '00000000-0000-0000-0000-00000000000c'$$, 'cannot_revoke_admin');
select t.expect(true, 'an admin must be demoted before being revoked');
update public.profiles set role = 'member' where id = :fauzi;
update public.profiles set active = false where id = :alfa;
select t.expect_error($$update public.tasks set assignee_id = '00000000-0000-0000-0000-00000000000b' where id = '20000000-0000-0000-0000-000000000002'$$, 'person_not_in_project');
select t.expect(true, 'revoked people cannot be assigned');
reset role;

select t.login(:alfa);
set role authenticated;
select t.expect((select count(*) = 0 from public.projects), 'revoked member sees no projects');
select t.expect((select count(*) = 0 from public.tasks), 'revoked member sees no tasks');
update public.tasks set title = 'hack' where id = '20000000-0000-0000-0000-000000000004';
reset role;
select t.expect((select title = 'Tugas Alfa' from public.tasks where id = '20000000-0000-0000-0000-000000000004'), 'revoked member cannot edit their old task');

-- Server side (service key, no user id) can restore access.
select t.login(null);
set role service_role;
update public.profiles set active = true where id = :alfa;
reset role;
select t.expect((select active from public.profiles where id = :alfa), 'server side restores access');

\o
\echo all team access tests passed
