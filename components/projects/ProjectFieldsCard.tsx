import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import Calendar from '@/components/common/Calendar';
import Popup from '@/components/common/Popup';
import { MetaStat, SectionCard } from '@/components/entities/EntityUI';
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

/** Renders nothing when the company has no custom fields — which is every
 *  company that has never imported a spreadsheet. An empty "Custom fields"
 *  panel on every project would be noise about a feature they do not use. */
export default function ProjectFieldsCard() {
  const { projectId } = useProjectDetail();
  const { hasPermission } = useAuth();
  const { defs, loading: defsLoading } = useProjectFieldDefs();
  const { values, loading: valuesLoading, refresh } = useProjectFieldValues(projectId);
  const [editing, setEditing] = useState<ProjectFieldDef | null>(null);

  const canEdit = hasPermission('project.edit');

  if (defsLoading || valuesLoading || defs.length === 0) return null;

  const filled = defs.filter(d => values[d.key] !== undefined && values[d.key] !== null).length;

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
      >
        <View className="flex-row flex-wrap" style={{ gap: 20 }}>
          {defs.map(def => {
            const shown = formatFieldValue(def, values[def.key]);
            const hint =
              `${FIELD_TYPE_LABELS[def.data_type]}${def.source_column ? ` · from the “${def.source_column}” column` : ''}` +
              (canEdit ? ' · click to edit' : '');
            return (
              <TouchableOpacity
                key={def.id}
                disabled={!canEdit}
                onPress={() => setEditing(def)}
                accessibilityRole={canEdit ? 'button' : undefined}
                accessibilityLabel={canEdit ? `Edit ${def.label}` : undefined}
                style={{ minWidth: 132 }}
                className={`-mx-1.5 px-1.5 py-1 rounded-lg ${canEdit ? 'hover:bg-surface-overlay' : ''}`}
              >
                <MetaStat label={def.label} value={shown} hint={hint} />
              </TouchableOpacity>
            );
          })}
        </View>
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

/**
 * One cell, one decision — so this is deliberately a NARROW popup (see
 * ux-consistency's "do NOT widen these"; ConfirmModal is 512). The dense
 * multi-column rule applies to composers, not to a single value.
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
    let value: string | number | boolean | null;
    if (raw === '') {
      value = null;
    } else if (def.data_type === 'number') {
      const n = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(n)) {
        setProblem('That is not a number. Digits, a minus sign and a decimal point only.');
        return;
      }
      value = n;
    } else if (def.data_type === 'boolean') {
      value = raw === 'true';
    } else {
      value = raw;
    }

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
        ) : def.data_type === 'boolean' ? (
          <View className="flex-row gap-2">
            {[
              { v: 'true', label: 'Yes' },
              { v: 'false', label: 'No' },
            ].map(o => {
              const active = draft === o.v;
              return (
                <TouchableOpacity
                  key={o.v}
                  onPress={() => setDraft(active ? '' : o.v)}
                  className="flex-1 items-center justify-center rounded-xl border"
                  style={{
                    minHeight: 44,
                    borderColor: active ? c.primary : c.border,
                    backgroundColor: active ? c.primary + '1A' : 'transparent',
                  }}
                >
                  <Text className={`text-sm font-bold ${active ? 'text-brand-primary' : 'text-typography-main'}`}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : def.data_type === 'date' ? (
          // Inline Calendar (ux-consistency: never a one-off date grid). It
          // needs a definite-width parent or MonthGrid's percentage cells
          // collapse — hence flex-1, not a bare row child.
          <View className="flex-row">
            <View className="flex-1">
              <Calendar selectedDate={draft || null} onSelect={iso => setDraft(iso)} />
            </View>
          </View>
        ) : (
          <View className="flex-row items-center bg-surface-background border border-surface-border rounded-lg px-3 py-2.5">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder={def.data_type === 'number' ? 'e.g. 8000' : 'Type a value'}
              placeholderTextColor={c.textDim}
              keyboardType={def.data_type === 'number' ? 'numeric' : 'default'}
              accessibilityLabel={def.label}
              className="flex-1 text-typography-main text-sm bg-transparent"
            />
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
