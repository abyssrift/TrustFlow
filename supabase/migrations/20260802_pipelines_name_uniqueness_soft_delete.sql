-- Fix: delete a pipeline, try to create another with the same name, get
--   duplicate key value violates unique constraint "pipelines_company_id_name_key"
--
-- Same defect as #180, one table over. rpc_delete_pipeline SOFT-deletes
-- (`SET deleted_at = NOW(), is_default = FALSE`), but
-- pipelines_company_id_name_key is a TOTAL unique constraint. A soft-deleted
-- row keeps occupying its (company_id, name) slot forever, so the name is
-- burned — invisible in the UI, permanently unusable, with a raw Postgres
-- error as the only feedback. Local currently has 5 soft-deleted pipelines
-- each holding a name hostage.
--
-- This table already knew the rule. Two of its three non-primary indexes are
-- already predicated:
--     idx_pipelines_company_id    ... WHERE (deleted_at IS NULL)
--     idx_pipelines_one_default   ... WHERE (is_default = true AND deleted_at IS NULL)
-- Only name-uniqueness was left total. The fix is to finish the job, not to
-- invent anything.
--
-- NULLS NOT DISTINCT is preserved: two pipelines with a NULL name in the same
-- company still collide, exactly as before.
--
-- Safety: total -> partial is a RELAXATION. Every pair the new index rejects
-- was already rejected by the old one, so it cannot fail on existing rows in
-- any environment, including prod.
--
-- Deliberately NOT changed, though the same sweep found them:
--   * portfolios_company_idempotency_key — MUST stay total. Making an
--     idempotency key partial lets the same key run twice, which is the exact
--     inverse of its purpose (plan §7 hazard 2, and the same reasoning
--     20260731_project_hierarchy_6 used to leave it alone).
--   * companies_slug_key / companies_join_code_key — a soft-deleted company's
--     slug still lives in URLs and invite links. Recycling it is a product
--     decision, not a bug fix.
--   * roles_company_id_name_key / teams_company_id_name_key — these tables
--     have a deleted_at column but NO delete RPC writes it; they are hard
--     deleted, so there is no soft-deleted row to block anything. Predicating
--     them now would be speculative.
--   * users_email_company_id_key — needs the re-invite/restore path thought
--     through first (a partial index there permits two rows with one email,
--     which the restore path would then have to disambiguate).

ALTER TABLE public.pipelines DROP CONSTRAINT IF EXISTS pipelines_company_id_name_key;
DROP INDEX IF EXISTS public.pipelines_company_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS pipelines_company_id_name_key
  ON public.pipelines (company_id, name) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

DO $verify$
DECLARE
  v_pred TEXT;
BEGIN
  SELECT pg_get_expr(x.indpred, x.indrelid) INTO v_pred
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  WHERE i.relname = 'pipelines_company_id_name_key';

  IF v_pred IS NULL THEN
    RAISE EXCEPTION 'pipelines_company_id_name_key is still a TOTAL unique index — soft-deleted names remain reserved';
  END IF;

  RAISE NOTICE 'pipelines name uniqueness is now partial: %', v_pred;
END
$verify$;
