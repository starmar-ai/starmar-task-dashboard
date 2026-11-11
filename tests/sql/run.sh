#!/usr/bin/env bash
# Runs every migration on a fresh local database, then the access tests.
# Needs a running local Postgres; set PGHOST/PGPORT/PGUSER if it is not the default.
set -euo pipefail
cd "$(dirname "$0")/../.."
db=starmar_rls_test
dropdb --if-exists "$db"
createdb "$db"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f tests/sql/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d "$db" -c "grant select, insert, update, delete on all tables in schema public to authenticated, service_role"
psql -v ON_ERROR_STOP=1 -d "$db" -f tests/sql/team_access.test.sql

# Each test file starts from a fresh database so one cannot depend on another's data.
dropdb --if-exists "$db"
createdb "$db"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f tests/sql/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d "$db" -c "grant select, insert, update, delete on all tables in schema public to authenticated, service_role"
psql -v ON_ERROR_STOP=1 -d "$db" -f tests/sql/change_requests.test.sql

dropdb --if-exists "$db"
createdb "$db"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f tests/sql/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d "$db" -c "grant select, insert, update, delete on all tables in schema public to authenticated, service_role"
psql -v ON_ERROR_STOP=1 -d "$db" -f tests/sql/project_archive.test.sql
