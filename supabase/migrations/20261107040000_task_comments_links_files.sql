-- Task comments, links, and file attachments.
-- Anyone who can see a task can comment, add a link, or upload a file.
-- Removing: the person who added it, the task owner (assignee or creator), or the admin.
-- Files live in the private Storage bucket "task-files", max 5 MB each, path <task_id>/<random>/<file name>.

-- helpers -------------------------------------------------------------------

create or replace function public.can_see_task(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = tid and public.can_see_project(t.project_id)
  );
$$;

-- comments ------------------------------------------------------------------

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- links ---------------------------------------------------------------------

create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  url text not null check (char_length(url) <= 2000 and url ~* '^https?://[^\s]+$'),
  label text check (label is null or char_length(btrim(label)) between 1 and 80),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index task_links_task_idx on public.task_links (task_id, created_at);

-- attachments ---------------------------------------------------------------

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  storage_path text not null unique check (split_part(storage_path, '/', 1) = task_id::text),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  size_bytes bigint not null check (size_bytes between 0 and 5242880),
  mime_type text,
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index task_attachments_task_idx on public.task_attachments (task_id, created_at);

-- row level security --------------------------------------------------------

alter table public.task_comments enable row level security;
alter table public.task_links enable row level security;
alter table public.task_attachments enable row level security;

create policy "task_comments: visible with the task"
  on public.task_comments for select to authenticated
  using (public.can_see_task(task_id));

create policy "task_comments: anyone who sees the task comments"
  on public.task_comments for insert to authenticated
  with check (public.can_see_task(task_id) and author_id = auth.uid());

create policy "task_comments: author or admin deletes"
  on public.task_comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create policy "task_links: visible with the task"
  on public.task_links for select to authenticated
  using (public.can_see_task(task_id));

create policy "task_links: anyone who sees the task adds"
  on public.task_links for insert to authenticated
  with check (public.can_see_task(task_id) and created_by = auth.uid());

create policy "task_links: adder, task owner, or admin removes"
  on public.task_links for delete to authenticated
  using (created_by = auth.uid() or public.can_edit_task(task_id));

create policy "task_attachments: visible with the task"
  on public.task_attachments for select to authenticated
  using (public.can_see_task(task_id));

create policy "task_attachments: anyone who sees the task uploads"
  on public.task_attachments for insert to authenticated
  with check (public.can_see_task(task_id) and uploaded_by = auth.uid());

create policy "task_attachments: uploader, task owner, or admin removes"
  on public.task_attachments for delete to authenticated
  using (uploaded_by = auth.uid() or public.can_edit_task(task_id));

-- The Data API roles need explicit grants on new tables.
grant select, insert, delete on public.task_comments to authenticated;
grant select, insert, delete on public.task_links to authenticated;
grant select, insert, delete on public.task_attachments to authenticated;
revoke all on public.task_comments, public.task_links, public.task_attachments from anon;

-- storage bucket ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;

-- The first folder of an object path is the task id. A malformed path never matches.
create or replace function public.task_file_task_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

create policy "task-files: read with the task"
  on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and public.can_see_task(public.task_file_task_id(name)));

create policy "task-files: upload to a visible task"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and public.can_see_task(public.task_file_task_id(name)));

create policy "task-files: uploader, task owner, or admin deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-files'
    and (owner_id = auth.uid()::text or public.can_edit_task(public.task_file_task_id(name)))
  );

-- storage usage for the indicator: bytes used by the whole workspace --------

create or replace function public.task_files_usage()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'task-files';
$$;

revoke all on function public.can_see_task(uuid) from public, anon;
revoke all on function public.task_file_task_id(text) from public, anon;
revoke all on function public.task_files_usage() from public, anon;
grant execute on function public.can_see_task(uuid) to authenticated;
grant execute on function public.task_file_task_id(text) to authenticated;
grant execute on function public.task_files_usage() to authenticated;
