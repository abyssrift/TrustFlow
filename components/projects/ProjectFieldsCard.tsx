import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useMemo, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import Calendar from '@/components/common/Calendar';
import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { FilterChip, SectionCard } from '@/components/entities/EntityUI';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  FIELD_TYPE_LABELS,
  formatFieldValue,
  fieldValueToInput,
  setProjectFieldValue,
  useProjectFieldDefs,
  useProjectFieldValues,
  type ProjectFieldDef,
  type ProjectFieldValue,
} from '@/hooks/useProjectFields';

// Issue #197 item 1 (show them) + item 5 (edit one).
//
// This is the whole point of §18.2 rule 3 becoming visible: the columns the
// parser could not name were already stored, already typed and already
// company-scoped — and appeared nowhere. A project's own detail page is the
// cheapest place to prove they survived, so it is the first one built.
//
// WHY A TABLE AND NOT A GRID OF STATS. The first version rendered these as a
// wrapped row of `MetaStat`s, which is the right component for four or five
// headline numbers and the wrong one for fourteen arbitrary spreadsheet
// columns: the eye had no column to run down, the labels wrapped at different
// heights, and — the part a user actually said out loud — nothing about it
// looked editable, even though every cell already was. A spreadsheet column
// should read like a spreadsheet column: aligned label, aligned value, and the
// value obviously a thing you can click.
//
// Two column-pairs on desktop rather than one long list, per ux-consistency's
// "use the width, go multi-column" — fourteen rows stacked single-file is a
// scroll for no reason on a 1400px screen.

/** Renders nothing when the company has no custom fields — which is every
 *  company that has never imported a spreadsheet. An empty "Custom fields"
 *  panel on every project would be noise about a feature they do not use. */
export default function ProjectFieldsCard() {
  const { projectId } = useProjectDetail();
  const { hasPermission } = useAuth();
  const { defs, loading: defsLoading } = useProjectFieldDefs();
  const { values, loading: valuesLoading, refresh } = useProjectFieldValues(projectId);
  const { width } = useWindowDimensions();

  const [editing, setEditing] = useState<ProjectFieldDef | null>(null);
  const [hideEmpty, setHideEmpty] = useState(false);

  const canEdit = hasPermission('project.edit');
  const isFilled = (d: ProjectFieldDef) => values[d.key] !== undefined && values[d.key] !== null && values[d.key] !== '';
  const filled = defs.filter(isFilled).length;

  const shown = useMemo(
    () => (hideEmpty ? defs.filter(isFilled) : defs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defs, values, hideEmpty],
  );

  // Split into two balanced columns, keeping the spreadsheet's own order
  // running DOWN each column — reading order, not a zig-zag across the pair.
  const columns = useMemo(() => {
    if (width < 900 || shown.length < 6) return [shown];
    const half = Math.ceil(shown.length / 2);
    return [shown.slice(0, half), shown.slice(half)];
  }, [shown, width]);

  if (defsLoading || valuesLoading || defs.length === 0) return null;

  return (
    <>
      <SectionCard
        title="Imported columns"
        hint={
          filled === 0
            ? 'Columns from your spreadsheets that TrustFlow has no concept of its own for. None are filled in on this project yet.'
            : `Columns from your spreadsheets that TrustFlow has no concept of its own for. ${filled} of ${defs.length} filled in here.`
        }
        icon="table"
        right={
          defs.length > filled ? (
            <FilterChip
              label={hideEmpty ? 'Showing filled only' : 'Hide empty'}
              icon={hideEmpty ? 'eye-slash' : 'eye'}
              active={hideEmpty}
              count={hideEmpty ? filled : defs.length - filled}
              onPress={() => setHideEmpty(v => !v)}
            />
          ) : undefined
        }
      >
        {shown.length === 0 ? (
          <Text className="text-typography-muted text-xs">
            Nothing is filled in on this project yet. Turn off “Showing filled only” to fill one in.
          </Text>
        ) : (
          <View className="flex-row" style={{ gap: 28 }}>
            {columns.map((col, i) => (
              <View key={i} className="flex-1 min-w-0">
                {col.map((def, r) => (
                  <FieldRow
                    key={def.id}
                    def={def}
                    value={values[def.key]}
                    projectId={projectId}
                    canEdit={canEdit}
                    first={r === 0}
                    onSaved={refresh}
                    onNeedsPopup={() => setEditing(def)}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
      </SectionCard>

      {!!editing && (
        <FieldValueEditor
          def={editing}
          projectId={projectId}
          current={values[editing.key]}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}

/** enum and date need room to choose in — a list and a month grid don't belong
 *  in a table cell. Everything else edits where it sits. */
function needsPopup(def: ProjectFieldDef) {
  return def.data_type === 'enum' || def.data_type === 'date';
}

// ── one row of the table ───────────────────────────────────────────────────

function FieldRow({
  def,
  value,
  projectId,
  canEdit,
  first,
  onSaved,
  onNeedsPopup,
}: {
  def: ProjectFieldDef;
  value: ProjectFieldValue | undefined;
  projectId: string;
  canEdit: boolean;
  first: boolean;
  onSaved: () => void;
  onNeedsPopup: () => void;
}) {
  const c = useThemeColors();
  const { errorToast } = useToast();
  const [draft, setDraft] = useState<string | null>(null); // non-null === editing in place
  const [saving, setSaving] = useState(false);
  // Escape must not save, but on web blur fires after the key handler — so the
  // key handler marks the edit abandoned and blur checks the flag.
  const cancelled = useRef(false);

  const empty = value === undefined || value === null || value === '';
  const shownValue = formatFieldValue(def, value);
  const typeLine =
    `${FIELD_TYPE_LABELS[def.data_type]}${def.source_column ? ` · from the “${def.source_column}” column` : ''}` +
    (canEdit && def.data_type === 'boolean' ? ' · click the value to cycle Yes / No / empty' : '');

  const commit = async (raw: string) => {
    setDraft(null);
    const trimmed = raw.trim();
    if (trimmed === fieldValueToInput(def, value).trim()) return; // untouched

    let next: string | number | boolean | null;
    if (trimmed === '') {
      next = null;
    } else if (def.data_type === 'number') {
      const n = Number(trimmed.replace(/,/g, ''));
      if (!Number.isFinite(n)) {
        errorToast('That is not a number. Digits, a minus sign and a decimal point only.', `${def.label} not saved`);
        return;
      }
      next = n;
    } else {
      next = trimmed;
    }

    setSaving(true);
    const err = await setProjectFieldValue(projectId, def.id, next);
    setSaving(false);
    if (err) {
      errorToast(err, 'Could not save');
      return;
    }
    onSaved();
  };

  const setBool = async (next: boolean | null) => {
    setSaving(true);
    const err = await setProjectFieldValue(projectId, def.id, next);
    setSaving(false);
    if (err) { errorToast(err, 'Could not save'); return; }
    onSaved();
  };

  const openEditor = () => {
    if (!canEdit) return;
    if (needsPopup(def)) { onNeedsPopup(); return; }
    if (def.data_type === 'boolean') { setBool(value === true ? false : value === false ? null : true); return; }
    setDraft(fieldValueToInput(def, value));
  };

  return (
    <View
      className={`flex-row items-center gap-3 py-2 ${first ? '' : 'border-t'} border-surface-border`}
      style={{ minHeight: 40 }}
    >
      <Tooltip label={typeLine} side="right">
        <Text
          numberOfLines={2}
          className="text-typography-dim text-[9px] font-black uppercase tracking-[0.14em]"
          style={{ width: 124 }}
        >
          {def.label}
        </Text>
      </Tooltip>

      <View className="flex-1 min-w-0">
        {draft !== null ? (
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            onBlur={() => (cancelled.current ? (cancelled.current = false, setDraft(null)) : commit(draft))}
            onSubmitEditing={() => commit(draft)}
            onKeyPress={(e: any) => { if (e.nativeEvent?.key === 'Escape') { cancelled.current = true; setDraft(null); } }}
            keyboardType={def.data_type === 'number' ? 'numeric' : 'default'}
            placeholder={def.data_type === 'number' ? 'e.g. 8000' : 'Type a value'}
            placeholderTextColor={c.textDim}
            accessibilityLabel={def.label}
            className="bg-surface-background border border-brand-primary rounded-lg px-2 text-typography-main text-sm font-bold"
            style={{ height: 32 }}
          />
        ) : (
          <TouchableOpacity
            disabled={!canEdit || saving}
            onPress={openEditor}
            accessibilityRole={canEdit ? 'button' : undefined}
            accessibilityLabel={canEdit ? `Edit ${def.label}` : undefined}
            className={`flex-row items-center gap-2 rounded-lg -mx-1.5 px-1.5 ${canEdit ? 'hover:bg-surface-overlay' : ''}`}
            style={{ minHeight: 32 }}
          >
            <Text
              numberOfLines={1}
              className={`text-sm font-bold flex-shrink ${empty ? 'text-typography-dim' : 'text-typography-main'}`}
            >
              {empty && canEdit ? 'Add…' : shownValue}
            </Text>
            {canEdit && !saving && (
              // Not a tooltip-only affordance: the pencil is what makes the
              // whole row read as editable, which is the thing the stat grid
              // never managed to say.
              <FontAwesome name="pencil-square-o" size={9} color={c.textDim} />
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/**
 * The two types a table cell cannot hold: a list of choices and a month grid.
 * One decision, so a NARROW popup (see ux-consistency's "do NOT widen these") —
 * the dense multi-column rule applies to composers, not to a single value.
 */
function FieldValueEditor({
  def,
  projectId,
  current,
  onClose,
  onSaved,
}: {
  def: ProjectFieldDef;
  projectId: string;
  current: ProjectFieldValue | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useThemeColors();
  const { successToast, errorToast } = useToast();
  const [draft, setDraft] = useState<string>(fieldValueToInput(def, current));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    const raw = draft.trim();
    const value: string | null = raw === '' ? null : raw;

    setSaving(true);
    setProblem(null);
    const err = await setProjectFieldValue(projectId, def.id, value);
    setSaving(false);
    if (err) {
      setProblem(err);
      errorToast(err, 'Could not save');
      return;
    }
    successToast(value === null ? `${def.label} cleared.` : `${def.label} saved.`, 'Updated');
    onSaved();
    onClose();
  };

  return (
    <Popup
      visible
      onClose={onClose}
      presentation="auto"
      maxWidth={480}
      title={def.label}
      footer="dual-action"
      primaryAction={{ label: saving ? 'Saving…' : 'Save', onPress: save, variant: saving ? 'disabled' : 'default' }}
      secondaryAction={{ label: 'Cancel', onPress: onClose }}
    >
      <View className="gap-3">
        <Text className="text-typography-muted text-[11px]">
          {FIELD_TYPE_LABELS[def.data_type]}
          {def.source_column ? ` · imported from the “${def.source_column}” spreadsheet column` : ''}
        </Text>

        {def.data_type === 'enum' ? (
          <View className="gap-1.5">
            {(def.enum_options ?? []).map(opt => {
              const active = draft === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setDraft(active ? '' : opt)}
                  className="flex-row items-center gap-2.5 rounded-xl border px-3"
                  style={{
                    minHeight: 44,
                    borderColor: active ? c.primary : c.border,
                    backgroundColor: active ? c.primary + '1A' : 'transparent',
                  }}
                >
                  <FontAwesome name={active ? 'check-circle' : 'circle-o'} size={13} color={active ? c.primary : c.textDim} />
                  <Text className={`text-sm font-semibold ${active ? 'text-brand-primary' : 'text-typography-main'}`}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          // Inline Calendar (ux-consistency: never a one-off date grid). It
          // needs a definite-width parent or MonthGrid's percentage cells
          // collapse — hence flex-1, not a bare row child.
          <View className="flex-row">
            <View className="flex-1">
              <Calendar selectedDate={draft || null} onSelect={iso => setDraft(iso)} />
            </View>
          </View>
        )}

        {draft !== '' && (
          <TouchableOpacity onPress={() => setDraft('')} className="flex-row items-center gap-2 self-start py-1">
            <FontAwesome name="eraser" size={11} color={c.textMuted} />
            <Text className="text-typography-muted text-[11px] font-semibold">Clear this value</Text>
          </TouchableOpacity>
        )}

        {!!problem && (
          <View className="px-3 py-2 rounded-xl bg-state-danger/10 border border-state-danger/30">
            <Text className="text-state-danger text-[11px] font-semibold">{problem}</Text>
          </View>
        )}
      </View>
    </Popup>
  );
}
