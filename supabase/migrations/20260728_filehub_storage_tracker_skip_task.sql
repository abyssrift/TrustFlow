-- FileHub unification (#151/#152 follow-up): task-file pointers must be inert
-- for the storage-quota counter too. The _filehub_storage_tracker trigger adds
-- filehub_files.size_bytes to company_billing.storage_used_bytes on insert, so
-- the Phase 2 backfill + write-through pointer INSERTs inflated every company's
-- quota with bytes that (a) already live in the task-attachments /
-- submission-attachments buckets and (b) are NOT quota-enforced on upload (task
-- files never go through rpc_filehub_upload_commit's check). Counting them is
-- both double-counting and asymmetric, so task pointers stay out of the quota —
-- consistent with how they're excluded from analytics / overview / global search.

-- Skip visibility='task' rows entirely (INSERT, soft-delete, restore, replace).
CREATE OR REPLACE FUNCTION public._filehub_storage_tracker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delta bigint;
BEGIN
  IF COALESCE(NEW.visibility, OLD.visibility) = 'task' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := COALESCE(NEW.size_bytes, 0);
  ELSE
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

-- Back out the inflation: subtract the bytes of currently-LIVE task pointers
-- that the tracker already added (soft-deleted ones already netted to 0, and no
-- task pointer had been soft-deleted before the delete-sync triggers shipped).
UPDATE public.company_billing cb
SET storage_used_bytes = GREATEST(0, cb.storage_used_bytes - t.bytes)
FROM (
  SELECT company_id, SUM(size_bytes) AS bytes
  FROM public.filehub_files
  WHERE visibility = 'task' AND deleted_at IS NULL
  GROUP BY company_id
) t
WHERE cb.company_id = t.company_id;
