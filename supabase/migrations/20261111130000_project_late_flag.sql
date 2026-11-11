-- The project flag ("Ada yang telat") now means exactly one thing: the project has at least one
-- unfinished task past its deadline. Before, it also fired when the last task deadline had passed
-- and the project was not marked Selesai. With open tasks that case is already covered by the
-- overdue count, so the extra rule only fired for projects whose tasks were all Done: a flag with
-- nothing late behind it. The column keeps its name (at_risk) so the app and the view shape stay the same.

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
  (coalesce(stats.overdue, 0) > 0) as at_risk
from public.projects p
left join lateral (
  select
    count(*) as total,
    count(*) filter (where t.status = 'done') as done,
    count(*) filter (
      where t.status <> 'done' and t.deadline < (now() at time zone 'Asia/Jakarta')::date
    ) as overdue,
    min(coalesce(t.start_date, t.deadline)) as first_date,
    max(t.deadline) as last_deadline
  from public.tasks t
  where t.project_id = p.id
) stats on true;
