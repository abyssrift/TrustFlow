import { useCallback, useEffect, useState } from 'react';

import { friendlyFieldError, type FieldDataType, type FieldFormat, type ProjectFieldValue } from '@/lib/projectFields';
import { supabase } from '@/lib/supabase';

// Issue #197 — the read/write side of plan §18.3's typed custom fields.
//
// The backend shipped complete in 20260802_project_custom_fields.sql and had
// exactly one caller: SpreadsheetImportSheet, which WRITES. Nothing read the
// values back, so an import "kept" a column the user then never saw again —
// worse than dropping it honestly, because the user believes it is in the app.
//
// Everything here is a thin wrapper. There is no second definition of who may
// see what: `project_field_defs` is company-wide by RLS and
// `project_field_values` is gated by fn_project_accessible, so a plain
// PostgREST select is already correctly scoped (same reasoning as
// useProjectLifecycle's direct `projects` select). The RPCs run their own
// `project.edit` check.
//
// The PURE half — formatting a cell, parsing one back, sorting, error copy —
// lives in lib/projectFields.ts so it can be checked without a Supabase
// client, and is re-exported here so a component has one import to reach for.

export {
  FIELD_TYPE_LABELS,
  fieldSortValue,
  fieldValueToInput,
  formatFieldValue,
  friendlyFieldError,
} from '@/lib/projectFields';
export type { FieldDataType, FieldFormat, ProjectFieldValue } from '@/lib/projectFields';

export type ProjectFieldDef = {
  id: string;
  key: string;
  label: string;
  data_type: FieldDataType;
  enum_options: string[] | null;
  source_column: string | null;
  sort_order: number;
  /** Display hint from the import parser — see lib/projectFields.ts. */
  format: FieldFormat | null;
};

const DEF_COLUMNS = 'id, key, label, data_type, enum_options, source_column, sort_order, format';

export function sortDefs(defs: ProjectFieldDef[]): ProjectFieldDef[] {
  return [...defs].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

/** Every live custom field for the signed-in company. */
export function useProjectFieldDefs() {
  const [defs, setDefs] = useState<ProjectFieldDef[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    // A deployment without the §18.3 migration errors here; that is not worth
    // an error banner on a surface custom fields are only one part of, so it
    // degrades to "this company has none" — exactly what the importer does.
    const { data } = await supabase.from('project_field_defs').select(DEF_COLUMNS).is('deleted_at', null);
    setDefs(sortDefs((data ?? []) as ProjectFieldDef[]));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { defs, loading, refresh };
}

/** One project's cells, keyed by field key — the same shape rpc_projects_table returns. */
export function useProjectFieldValues(projectId: string | null) {
  const [values, setValues] = useState<Record<string, ProjectFieldValue>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase
      .from('project_field_values')
      .select('field_def_id, value_text, value_num, value_date, value_bool, project_field_defs!inner(key)')
      .eq('project_id', projectId);
    const next: Record<string, ProjectFieldValue> = {};
    for (const row of (data ?? []) as any[]) {
      const key = row.project_field_defs?.key;
      if (!key) continue;
      // Exactly one column is populated — project_field_values_one_value_ck.
      next[key] = row.value_text ?? row.value_num ?? row.value_date ?? row.value_bool ?? null;
    }
    setValues(next);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { values, loading, refresh };
}

export type SaveFieldDefInput = {
  id?: string | null;
  key: string;
  label: string;
  data_type: FieldDataType;
  enum_options?: string[] | null;
  sort_order?: number | null;
  format?: FieldFormat | null;
};

/** Resolves to null on success, or a sentence fit to show a user. */
export async function saveFieldDef(input: SaveFieldDefInput): Promise<string | null> {
  const { error } = await supabase.rpc('rpc_save_project_field_def', {
    p_key: input.key,
    p_label: input.label,
    p_data_type: input.data_type,
    p_enum_options: input.data_type === 'enum' ? (input.enum_options ?? []) : null,
    p_source_column: null,
    p_sort_order: input.sort_order ?? null,
    p_id: input.id ?? null,
    p_format: input.format ?? null,
  });
  return error ? friendlyFieldError(error.message) : null;
}

/** Soft delete. Resolves to `{ retained }` or an error sentence. */
export async function deleteFieldDef(id: string): Promise<{ retained: number } | string> {
  const { data, error } = await supabase.rpc('rpc_delete_project_field_def', { p_id: id });
  if (error) return friendlyFieldError(error.message);
  return { retained: Number((data as any)?.values_retained ?? 0) };
}

/**
 * One cell. `rpc_set_project_field_values` is bulk because the importer writes
 * hundreds at once; a single-row array is the same call (§18.3), so there is
 * no reason for a second RPC. `null` clears the cell.
 */
export async function setProjectFieldValue(
  projectId: string,
  fieldDefId: string,
  value: string | number | boolean | null,
): Promise<string | null> {
  const { error } = await supabase.rpc('rpc_set_project_field_values', {
    p_values: [{ project_id: projectId, field_def_id: fieldDefId, value }],
  });
  return error ? friendlyFieldError(error.message) : null;
}
