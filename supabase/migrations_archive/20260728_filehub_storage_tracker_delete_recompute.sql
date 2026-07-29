-- Storage-quota counter drift fix (surfaced by the FileHub unification audit but
-- pre-existing and independent of it): _filehub_storage_tracker fired only on
-- INSERT / UPDATE OF size_bytes, deleted_at — never on DELETE. A file HARD-
-- deleted while still live (deleted_at IS NULL) — e.g. a folder cascade delete
-- or an admin row delete — therefore kept its +size_bytes contribution forever,
-- since only a soft-delete (UPDATE deleted_at) ever subtracted it. Over time
-- company_billing.storage_used_bytes drifted far above real usage (one company:
-- 238 MB tracked vs 21 MB actual).
--
-- Fix: add a DELETE branch that subtracts a row's bytes ONLY if it was still
-- live at delete time (an already-soft-deleted row was subtracted at soft-delete
-- time, so subtracting again on the eventual purge would double-count). Then do a
-- one-time authoritative recompute so every company starts from the truth.

CREATE OR REPLACE FUNCTION public._filehub_storage_tracker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delta bigint;
BEGIN
  -- Task-file pointers never count toward the quota (bytes live in the task
  -- buckets; task uploads bypass rpc_filehub_upload_commit's enforcement).
  IF COALESCE(NEW.visibility, OLD.visibility) = 'task' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := COALESCE(NEW.size_bytes, 0);
  ELSIF TG_OP = 'DELETE' THEN
    -- Only live rows still contribute; soft-deleted rows were already subtracted.
    IF OLD.deleted_at IS NULL THEN
      v_delta := -COALESCE(OLD.size_bytes, 0);
    ELSE
      v_delta := 0;
    END IF;
  ELSE  -- UPDATE
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_delta := -COALESCE(NEW.size_bytes, 0);
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_delta := COALESCE(NEW.size_bytes, 0);
    ELSE
      v_delta := COALESCE(NEW.size_bytes, 0) - COALESCE(OLD.size_bytes, 0);
    END IF;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE public.company_billing
    SET storage_used_bytes = GREATEST(0, storage_used_bytes + v_delta)
    WHERE company_id = COALESCE(NEW.company_id, OLD.company_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS filehub_storage_tracker ON public.filehub_files;
CREATE TRIGGER filehub_storage_tracker
  AFTER INSERT OR DELETE OR UPDATE OF size_bytes, deleted_at ON public.filehub_files
  FOR EACH ROW EXECUTE FUNCTION public._filehub_storage_tracker();

-- One-time authoritative recompute for every company (fixes the historical
-- drift and any residual). Invariant: sum of current-version sizes of live,
-- non-task files. Companies with no files settle to 0.
UPDATE public.company_billing cb
SET storage_used_bytes = COALESCE((
  SELECT SUM(f.size_bytes)
  FROM public.filehub_files f
  WHERE f.company_id = cb.company_id
    AND f.deleted_at IS NULL
    AND f.visibility <> 'task'
), 0);
