-- /api/notify reads and writes with the service key (role service_role). This project does not grant
-- service_role access to new tables by default, so the notification email function got
-- "permission denied for table notification_settings". Run once in the Supabase SQL Editor.

grant usage on schema public to service_role;
grant select on public.tasks, public.projects, public.profiles to service_role;
grant select, update on public.notifications to service_role;
grant select, insert, update on public.notification_settings to service_role;
