-- A year rendered as "2,025".
--
-- The parser is not confused about this. spreadsheetMapping classifies a `year`
-- primitive with 0.9 confidence and gets it right on the real register. What
-- happens next is that importPlan's fieldTypeForPrimitive collapses BOTH `money`
-- and `year` to the storage type `number` -- correct, because both live in
-- value_num and a year is not a date we can invent a day for -- and at that
-- point the distinction is gone. project_field_defs has nowhere to keep it.
-- So the read UI sees `number` and does the only sensible thing a number
-- deserves, `toLocaleString()`, which groups thousands. 2025 -> "2,025".
--
-- The tempting fix is a regex on the label at render time. That is precisely the
-- failure this document keeps naming (§13.14, §16.1): knowledge that exists in
-- ONE place gets thrown away, then re-derived by a worse rule somewhere else,
-- and the two definitions drift. The parser already knows. Give it somewhere to
-- write it down.
--
-- `format` is a DISPLAY hint, deliberately separate from `data_type`:
--   * storage is unchanged -- a year is still value_num, so filters, the typed
--     equality in fn_project_field_matches, the one-value CHECK and the
--     "a populated field's type is frozen" rule are all untouched;
--   * data_type stays the set the value trigger validates against, so no
--     CHECK constraint anywhere has to learn a sixth type.
--
-- Only 'year' changes rendering today. 'money' and 'percent' are accepted and
-- carried so the parser stops discarding what it knows -- a currency setting or
-- a percent suffix later needs the column populated, not a backfill invented
-- after the fact from labels nobody kept.

ALTER TABLE public.project_field_defs
  ADD COLUMN IF NOT EXISTS format TEXT;

DO $ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_field_defs'::regclass
      AND conname = 'project_field_defs_format_ck'
  ) THEN
    ALTER TABLE public.project_field_defs
      ADD CONSTRAINT project_field_defs_format_ck
      CHECK (format IS NULL OR format = ANY (ARRAY['plain','year','money','percent']));
  END IF;
END
$ck$;

COMMENT ON COLUMN public.project_field_defs.format IS
  'Display hint from the import parser''s content primitive. NULL = plain. Never affects storage or filtering -- data_type does that.';

-- ── carry it through the writer ─────────────────────────────────────────────
-- Patched from the LIVE body rather than retyped: recreating an RPC from a
-- remembered body has silently dropped behaviour in this repo twice (see the
-- notes on rpc_filehub_group_list_files). Four surgical replacements, each of
-- which fails loudly if the anchor is missing.
--
-- The 7-arg signature is DROPped explicitly. CREATE OR REPLACE with an added
-- parameter creates an OVERLOAD, not a replacement -- that killed the whole
-- pipeline editor on 2026-08-02 (20260802_drop_stale_stage_rpc_overloads.sql)
-- and PostgREST then answers PGRST203 for every call.
DO $patch$
DECLARE
  v_def TEXT;
  v_sig_needle  TEXT := 'p_id uuid DEFAULT NULL::uuid)';
  v_sig_repl    TEXT := 'p_id uuid DEFAULT NULL::uuid, p_format text DEFAULT NULL::text)';
  v_upd_needle  TEXT := '        sort_order    = COALESCE(p_sort_order, sort_order),';
  v_upd_repl    TEXT := '        sort_order    = COALESCE(p_sort_order, sort_order),' || E'\n' ||
                        '        format        = COALESCE(p_format, format),';
  v_ins_needle  TEXT := '(company_id, key, label, data_type, enum_options, source_column, sort_order, created_by)';
  v_ins_repl    TEXT := '(company_id, key, label, data_type, enum_options, source_column, sort_order, format, created_by)';
  v_val_needle  TEXT := 'COALESCE(p_sort_order, 0), v_uid)';
  v_val_repl    TEXT := 'COALESCE(p_sort_order, 0), p_format, v_uid)';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc
  WHERE proname = 'rpc_save_project_field_def' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_save_project_field_def not found';
  END IF;

  IF position('p_format' IN v_def) > 0 THEN
    RAISE NOTICE 'rpc_save_project_field_def already takes p_format; nothing to patch';
    RETURN;
  END IF;

  IF position(v_sig_needle IN v_def) = 0
     OR position(v_upd_needle IN v_def) = 0
     OR position(v_ins_needle IN v_def) = 0
     OR position(v_val_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not locate all four anchors in rpc_save_project_field_def — refusing to patch blindly';
  END IF;

  v_def := replace(v_def, v_sig_needle, v_sig_repl);
  v_def := replace(v_def, v_upd_needle, v_upd_repl);
  v_def := replace(v_def, v_ins_needle, v_ins_repl);
  v_def := replace(v_def, v_val_needle, v_val_repl);

  DROP FUNCTION public.rpc_save_project_field_def(text, text, text, text[], text, integer, uuid);
  EXECUTE v_def;
  RAISE NOTICE 'rpc_save_project_field_def now carries the parser''s display format';
END
$patch$;

-- DROP takes the grants with it; pg_get_functiondef never carried them.
REVOKE EXECUTE ON FUNCTION public.rpc_save_project_field_def(text, text, text, text[], text, integer, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_save_project_field_def(text, text, text, text[], text, integer, uuid, text) TO authenticated;

-- ── backfill what was imported before the column existed ────────────────────
-- ponytail: this IS the label regex the header note argues against -- as a
-- ONE-TIME repair of rows whose primitive was already discarded, not as the
-- app's ongoing rule. Every def written from here on carries the parser's own
-- answer. Deliberately conservative: it must look like a year column AND every
-- value it holds must be a plausible year, so an "Audit 2025" fee column (whose
-- values are money) is never caught by the header alone.
UPDATE public.project_field_defs d
SET    format = 'year'
WHERE  d.format IS NULL
  AND  d.data_type = 'number'
  AND  d.deleted_at IS NULL
  AND  (d.label ~* '\yyear\y|\yfy\y' OR d.source_column ~* '\yyear\y|\yfy\y')
  AND  EXISTS (SELECT 1 FROM public.project_field_values v WHERE v.field_def_id = d.id)
  AND  NOT EXISTS (
         SELECT 1 FROM public.project_field_values v
         WHERE v.field_def_id = d.id
           AND (v.value_num IS NULL OR v.value_num < 1900 OR v.value_num > 2999
                OR v.value_num <> trunc(v.value_num))
       );

DO $verify$
DECLARE
  v_args TEXT;
  v_sigs INT;
  v_years INT;
BEGIN
  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_save_project_field_def' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_save_project_field_def must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;

  SELECT pg_get_function_identity_arguments(oid) INTO v_args FROM pg_proc
  WHERE proname = 'rpc_save_project_field_def' AND pronamespace = 'public'::regnamespace;
  IF v_args <> 'p_key text, p_label text, p_data_type text, p_enum_options text[], p_source_column text, p_sort_order integer, p_id uuid, p_format text' THEN
    RAISE EXCEPTION 'rpc_save_project_field_def has the wrong signature: %', v_args;
  END IF;

  -- The behaviour that would have been silently lost by retyping the body.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rpc_save_project_field_def' AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%is in use%' AND prosrc LIKE '%while it has values%'
  ) THEN
    RAISE EXCEPTION 'the patched body lost the frozen-type or in-use-enum-option guard';
  END IF;

  SELECT count(*) INTO v_years FROM public.project_field_defs
  WHERE format = 'year' AND deleted_at IS NULL;
  RAISE NOTICE 'project field format: one signature, guards intact, % existing column(s) backfilled as year', v_years;
END
$verify$;
