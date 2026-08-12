-- ⚠ RUN THIS FILE OUTSIDE A TRANSACTION BLOCK. ⚠
--
-- CREATE INDEX CONCURRENTLY cannot run inside one ("CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block", 25001), and every path that applies a
-- migration here -- supabase db push, the Supabase MCP's apply_migration, and
-- psql -1 -- wraps the file it is given in one. That is why these two statements
-- are split out of 20260811_company_live_sessions.sql instead of living beside
-- the function they serve: that file is transactional and this one must not be.
-- No other migration in this repo uses CONCURRENTLY, so there is no house
-- pattern to copy.
--
-- Apply it by pasting into the Supabase SQL Editor (each statement autocommits)
-- or `psql "$DATABASE_URL" -f` WITHOUT -1 / --single-transaction.
--
-- If a concurrent build is not worth the ceremony, dropping CONCURRENTLY makes
-- both statements safe inside an ordinary migration -- at the cost of an ACCESS
-- EXCLUSIVE lock on task_work_sessions for the length of the build, which
-- blocks every running timer's heartbeat while it holds. Hence CONCURRENTLY.
--
-- Re-running is safe: IF NOT EXISTS. If a CONCURRENTLY build is interrupted it
-- leaves an INVALID index behind that IF NOT EXISTS will then skip forever --
-- check with
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- and DROP INDEX CONCURRENTLY any hit before re-running.

-- Recommended by a prior review and never applied: per-user recency lookups
-- ("this person's latest session"). It does NOT serve rpc_company_live_sessions
-- -- that query leads with status, not user_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_sessions_user_recent
  ON public.task_work_sessions (user_id, last_heartbeat_at DESC);

-- This one does. task_work_sessions is append-only history and grows without
-- bound, while the live set is at most one row per employee, so a partial index
-- keeps rpc_company_live_sessions off a full-history seq scan on every single
-- dashboard load and stays tiny forever.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_sessions_active_heartbeat
  ON public.task_work_sessions (last_heartbeat_at)
  WHERE status = 'active';
