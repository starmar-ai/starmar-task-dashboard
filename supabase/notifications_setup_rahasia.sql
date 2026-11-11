-- Jalankan SEKALI di Supabase SQL Editor, setelah 20261111030000_notifications.sql.
-- 1. Ganti GANTI_DENGAN_NOTIFY_SECRET dengan nilai NOTIFY_SECRET yang sama persis dengan di Vercel.
-- 2. Kalau alamat aplikasi lo bukan yang di bawah, ganti juga.
-- Jangan commit file ini setelah diisi rahasia.

insert into public.notify_config (key, value) values
  ('url', 'https://starmar-task-dashboard.vercel.app/api/notify'),
  ('secret', 'GANTI_DENGAN_NOTIFY_SECRET')
on conflict (key) do update set value = excluded.value;
