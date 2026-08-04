import type { FieldDataType, FieldFormat } from './imports/importPlan';

// The pure half of custom fields: how a stored cell becomes text, and how that
// text goes back. Split out of hooks/useProjectFields.ts so it can be checked
// without a Supabase client — the "2,025" bug lived in exactly four lines here
// and nothing could have caught it while they sat behind a network module.
//
// FIELD_TYPE_LABELS and the two type unions are re-exported from importPlan
// rather than re-declared: they mirror CHECK constraints, and a second copy
// that drifts is an insert failure nobody sees until a user hits it.

export { FIELD_TYPE_LABELS } from './imports/importPlan';
export type { FieldDataType, FieldFormat } from './imports/importPlan';

/** The shape both this module and `rpc_projects_table.custom_fields` speak. */
export type FieldDef = {
  data_type: FieldDataType;
  format?: FieldFormat | null;
};

/** A single cell, as `rpc_projects_table.custom_fields` and the hook return it. */
export type ProjectFieldValue = string | number | boolean | null;

/** Presentation for one cell. Never renders a bare `null` or a raw `true`. */
export function formatFieldValue(def: FieldDef, value: ProjectFieldValue | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (def.data_type) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'date': {
      // Values are stored as DATE, so the payload is 'YYYY-MM-DD' with no zone.
      // Splitting beats `new Date(...)`, which shifts the day in west-of-UTC
      // browsers — the §21 "a date a different tool already broke" trap, and
      // not one worth re-introducing at render time.
      // Shape-checked, not just split: "not-a-date".split('-') is three
      // truthy parts, and the old `!y || !m || !d` guard passed it straight
      // through to render as "date/a/not". Unreachable today (the column is a
      // DATE, so the payload is always ISO) but a silent nonsense string is a
      // bad thing to leave in a formatter.
      const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
      if (!iso) return String(value);
      return `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      // A year is a label, not a quantity: no thousands separator, ever. This
      // is the "2,025" bug, and the reason `format` is a stored column rather
      // than a regex on the label right here.
      if (def.format === 'year') return String(Math.trunc(n));
      if (def.format === 'percent') return `${n.toLocaleString()}%`;
      // ponytail: 'money' groups exactly like a plain number until a company
      // has a currency to render — the format is carried so that becomes a
      // render edit, not a backfill from labels nobody kept.
      return n.toLocaleString();
    }
    default:
      return String(value);
  }
}

/** Same value, as text a filter or an input can round-trip. */
export function fieldValueToInput(def: FieldDef, value: ProjectFieldValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (def.data_type === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Sortable projection, so a custom column sorts like the built-in ones. */
export function fieldSortValue(def: FieldDef, value: ProjectFieldValue | undefined): number | string {
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
