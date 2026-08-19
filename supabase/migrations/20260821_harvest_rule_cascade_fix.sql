-- Issue #284, Phase 3 (cascade correction): harvested_files.harvest_rule_id
-- must not CASCADE.
--
-- Full plan: C:\Users\j\.claude\plans\recursive-skipping-treasure.md,
-- "Cascade correction, found before starting Phase 3" note.
--
-- Phase 1 (20260819_harvest_rules_schema.sql) set harvest_rule_id NOT NULL
-- REFERENCES harvest_rules(id) ON DELETE CASCADE. That was harmless while
-- nothing could delete a rule. Phase 3 adds rpc_delete_harvest_rule, which
-- makes it load-bearing: CASCADE would mean deleting a rule's CONFIGURATION
-- retroactively deletes every file it already delivered -- already-sealed,
-- already-visible deliverable content vanishing from a project's Files tab
-- because someone edited an unrelated setting later. That directly
-- contradicts source_file_version_id's own ON DELETE RESTRICT on this same
-- table, whose entire point is "a harvested pointer must never silently
-- vanish."
--
-- Fix: harvest_rule_id becomes nullable with ON DELETE SET NULL. Deleting a
-- rule orphans the "which rule produced this" provenance on already-
-- delivered files (set to NULL) without touching the files themselves.
-- Must land before rpc_delete_harvest_rule is written (this migration is
-- deliberately separate from, and precedes, the rest of Phase 3).

ALTER TABLE public.harvested_files
  ALTER COLUMN harvest_rule_id DROP NOT NULL;

ALTER TABLE public.harvested_files
  DROP CONSTRAINT harvested_files_harvest_rule_id_fkey;

ALTER TABLE public.harvested_files
  ADD CONSTRAINT harvested_files_harvest_rule_id_fkey
  FOREIGN KEY (harvest_rule_id) REFERENCES public.harvest_rules(id) ON DELETE SET NULL;

-- ============================================================
-- Migration self-check -- fail loudly, not silently
-- ============================================================
DO $$
DECLARE
  v_nullable   TEXT;
  v_confdeltype CHAR;
BEGIN
  SELECT is_nullable INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'harvested_files' AND column_name = 'harvest_rule_id';
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'MIGRATION FAILED: harvested_files.harvest_rule_id must be nullable';
  END IF;

  SELECT confdeltype INTO v_confdeltype
  FROM pg_constraint
  WHERE conname = 'harvested_files_harvest_rule_id_fkey' AND conrelid = 'public.harvested_files'::regclass;
  IF v_confdeltype <> 'n' THEN
    RAISE EXCEPTION 'MIGRATION FAILED: harvested_files_harvest_rule_id_fkey must be ON DELETE SET NULL, found action ''%''', v_confdeltype;
  END IF;

  RAISE NOTICE '20260821_harvest_rule_cascade_fix.sql wiring assertions passed';
END $$;
