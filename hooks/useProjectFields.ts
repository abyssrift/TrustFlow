import { useCallback, useEffect, useState } from 'react';

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

export type FieldDataType = 'text' | 'number' | 'date' | 'enum' | 'boolean';

export const FIELD_TYPE_LABELS: Record<FieldDataType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  enum: 'Choice',
  boolean: 'Yes / No',
};

export type ProjectFieldDef = {
  id: string;
  key: string;
  label: string;
  data_type: FieldDataType;
  enum_options: string[] | null;
  source_column: string | null;
  sort_order: number;
};

/** A single cell, as `rpc_projects_table.custom_fields` and this hook return it. */
export type ProjectFieldValue = string | number | boolean | null;

const DEF_COLUMNS = 'id, key, label, data_type, enum_options, source_column, sort_order';

export function sortDefs(defs: ProjectFieldDef[]): ProjectFieldDef[] {
  return [...defs].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

/** Presentation for one cell. Never renders a bare `null` or a raw `true`. */
export function formatFieldValue(def: ProjectFieldDef, value: ProjectFieldValue | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (def.data_type) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'date': {
      // Values are stored as DATE, so the payload is 'YYYY-MM-DD' with no zone.
      // Splitting beats `new Date(...)`, which shifts the day in west-of-UTC
      // browsers — the §21 "a date a different tool already broke" trap, and
      // not one worth re-introducing at render time.
      const [y, m, d] = String(value).split('-');
      if (!y || !m || !d) return String(value);
      return `${d}/${m}/${y}`;
    }
    case 'number':
      return Number(value).toLocaleString();
    default:
      return String(value);
  }
}

/** Same value, as text a filter or an input can round-trip. */
export function fieldValueToInput(def: ProjectFieldDef, value: ProjectFieldValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (def.data_type === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Sortable projection, so a custom column sorts like the built-in ones. */
export function fieldSortValue(def: ProjectFieldDef, value: ProjectFieldValue | undefined): number | string {
  if (value === null || value === undefined) return def.data_type === 'number' ? -Infinity : '';
  if (def.data_type === 'number') return Number(value);
  if (def.data_type === 'boolean') return value ? 1 : 0;
  return String(value).toLowerCase();
}

// The RPCs raise readable sentences for the two rules that actually bite
// (§18.3: a populated field's type is frozen; an in-use enum option cannot be
// withdrawn), so those pass straight through. What is NOT readable is the
// unique-index violation and the permission denial, so those get mapped.
// Anything else falls back to a sentence that says what to do rather than a
// bare Postgres string (§14.4.4).
export function friendlyFieldError(message: string | null | undefined): string {
  const m = message || '';
  if (/project_field_defs_company_key_live|duplicate key/i.test(m)) {
    return 'Another field already uses that key. Pick a different one.';
  }
  if (/Insufficient permissions/i.test(m)) {
    return 'You do not have permission to change project fields.';
  }
  if (/invalid input syntax|invalid_text_representation/i.test(m)) {
    return 'That value does not match the field’s type. Check the format and try again.';
  }
  if (/^(Cannot|Custom field|Field |An enum|Project not found|Value )/.test(m)) return m;
  return m ? `${m} — if this keeps happening, tell an admin.` : 'Could not save the change.';
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
