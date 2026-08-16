import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import Popup from '@/components/common/Popup';
import { useAlert } from '@/contexts/AlertContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  FIELD_TYPE_LABELS,
  deleteFieldDef,
  saveFieldDef,
  sortDefs,
  useProjectFieldDefs,
  type FieldDataType,
  type ProjectFieldDef,
} from '@/hooks/useProjectFields';

// Issue #197 item 4: rename / retype / reorder / delete. Items 1 + 5 (show +
// edit a value on a project) shipped in ProjectFieldsCard — this is the
// company-wide counterpart, the definitions rather than one project's values.
// saveFieldDef/deleteFieldDef already existed here (used only by the import
// sheet, which only ever creates) — this is the first UI to call them for
// update/delete, and the reason `rpc_save_project_field_def` already refuses
// to change a populated field's type: that guard was dead code with no way
// to trigger it until now.
//
// No drag-and-drop: sort_order has no uniqueness constraint, so a plain
// swap-with-neighbour via two saveFieldDef calls is the whole feature. A
// field list from a spreadsheet import is a handful of columns, not
// hundreds — reordering one at a time is not a real limitation here.

const TYPE_OPTIONS: { value: FieldDataType; label: string; icon: string }[] = [
  { value: 'text', label: 'Text', icon: 'font' },
  { value: 'number', label: 'Number', icon: 'hashtag' },
  { value: 'date', label: 'Date', icon: 'calendar' },
  { value: 'boolean', label: 'Yes / No', icon: 'check-square-o' },
  { value: 'enum', label: 'Choice list', icon: 'list-ul' },
];

function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'field'
  );
}

type Draft = {
  id: string | null;
  key: string;
  label: string;
  data_type: FieldDataType;
  enumOptions: string; // comma-separated in the form; parsed on save
  keyTouched: boolean;
};

const BLANK: Draft = { id: null, key: '', label: '', data_type: 'text', enumOptions: '', keyTouched: false };

export default function ManageProjectFieldsPopup({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const { showConfirm } = useAlert();
  const { successToast, errorToast } = useToast();
  const { defs, loading, refresh } = useProjectFieldDefs();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const sorted = sortDefs(defs);

  const startCreate = () => { setProblem(null); setDraft({ ...BLANK }); };
  const startEdit = (d: ProjectFieldDef) => {
    setProblem(null);
    setDraft({
      id: d.id,
      key: d.key,
      label: d.label,
      data_type: d.data_type,
      enumOptions: (d.enum_options ?? []).join(', '),
      keyTouched: true,
    });
  };

  const save = async () => {
    if (!draft) return;
    const label = draft.label.trim();
    if (!label) { setProblem('A label is required.'); return; }
    const key = (draft.keyTouched ? draft.key : slugify(label)).trim();
    if (!/^[a-z0-9_]{1,64}$/.test(key)) {
      setProblem('Key must be 1-64 characters: lowercase letters, numbers or underscores.');
      return;
    }
    const enumOptions = draft.data_type === 'enum'
      ? draft.enumOptions.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    if (draft.data_type === 'enum' && (!enumOptions || enumOptions.length === 0)) {
      setProblem('Add at least one option, separated by commas.');
      return;
    }

    setSaving(true);
    setProblem(null);
    const err = await saveFieldDef({ id: draft.id, key, label, data_type: draft.data_type, enum_options: enumOptions });
    setSaving(false);
    if (err) { setProblem(err); return; }
    successToast(draft.id ? `${label} updated.` : `${label} added.`, 'Saved');
    setDraft(null);
    refresh();
  };

  const remove = (d: ProjectFieldDef) => {
    showConfirm(
      `Delete "${d.label}"?`,
      'Existing values stay on disk but stop showing anywhere. Adding a field back with the same key brings them back.',
      async () => {
        const result = await deleteFieldDef(d.id);
        if (typeof result === 'string') { errorToast(result, 'Could not delete'); return; }
        successToast(
          result.retained > 0
            ? `${d.label} removed. ${result.retained} saved value${result.retained === 1 ? '' : 's'} kept, hidden.`
            : `${d.label} removed.`,
          'Deleted',
        );
        refresh();
      },
      undefined,
      'Delete',
      'Cancel',
      'destructive',
    );
  };

  const move = async (d: ProjectFieldDef, dir: -1 | 1) => {
    const i = sorted.findIndex(x => x.id === d.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const other = sorted[j];
    setMovingId(d.id);
    const [err1, err2] = await Promise.all([
      saveFieldDef({ id: d.id, key: d.key, label: d.label, data_type: d.data_type, enum_options: d.enum_options, sort_order: other.sort_order }),
      saveFieldDef({ id: other.id, key: other.key, label: other.label, data_type: other.data_type, enum_options: other.enum_options, sort_order: d.sort_order }),
    ]);
    setMovingId(null);
    if (err1 || err2) { errorToast(err1 || err2 || 'Could not reorder', 'Reorder failed'); return; }
    refresh();
  };

  return (
    <Popup
      visible={visible}
      onClose={() => { setDraft(null); onClose(); }}
      presentation="auto"
      maxWidth={640}
      title="Manage custom fields"
      footer={draft ? 'dual-action' : 'none'}
      primaryAction={draft ? { label: saving ? 'Saving…' : 'Save', onPress: save, variant: saving ? 'disabled' : 'default' } : undefined}
      secondaryAction={draft ? { label: 'Cancel', onPress: () => setDraft(null) } : undefined}
    >
      <View className="gap-4">
        <Text className="text-typography-muted text-xs">
          Columns your spreadsheet imports created that TrustFlow had no field of its own for. Rename, retype, reorder or remove them here — every project's saved values follow along.
        </Text>

        {!draft && (
          <TouchableOpacity
            onPress={startCreate}
            className="flex-row items-center justify-center gap-2 bg-surface-card border border-dashed border-surface-border rounded-xl py-3 hover:bg-surface-overlay"
          >
            <FontAwesome name="plus" size={12} color={c.primary} />
            <Text className="text-brand-primary text-sm font-bold">Add a field</Text>
          </TouchableOpacity>
        )}

        {draft && (
          <View className="bg-surface-card border border-surface-border rounded-2xl p-4 gap-3">
            <Text className="text-typography-label text-[10px] font-black uppercase tracking-wider">
              {draft.id ? 'Edit field' : 'New field'}
            </Text>

            <View className="gap-1.5">
              <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider">Label</Text>
              <TextInput
                value={draft.label}
                onChangeText={label => setDraft(d => d && ({ ...d, label, key: d.keyTouched ? d.key : slugify(label) }))}
                placeholder="e.g. Inventory Count Needed"
                placeholderTextColor={c.textDim}
                className="bg-surface-background border border-surface-border rounded-lg px-3 text-typography-main text-sm"
                style={{ height: 40 }}
              />
            </View>

            <View className="gap-1.5">
              <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider">Key</Text>
              <TextInput
                value={draft.key}
                onChangeText={key => setDraft(d => d && ({ ...d, key: key.toLowerCase(), keyTouched: true }))}
                placeholder="inventory_count_needed"
                placeholderTextColor={c.textDim}
                autoCapitalize="none"
                className="bg-surface-background border border-surface-border rounded-lg px-3 text-typography-main text-sm font-mono"
                style={{ height: 40 }}
              />
              <Text className="text-typography-dim text-[10px]">Lowercase letters, numbers and underscores only. Used internally — the label is what shows on a project.</Text>
            </View>

            <View className="gap-1.5">
              <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider">Type</Text>
              <View className="flex-row flex-wrap gap-2">
                {TYPE_OPTIONS.map(opt => {
                  const active = draft.data_type === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setDraft(d => d && ({ ...d, data_type: opt.value }))}
                      className="flex-row items-center gap-1.5 rounded-lg border px-3"
                      style={{ height: 34, borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primary + '1A' : 'transparent' }}
                    >
                      <FontAwesome name={opt.icon as any} size={11} color={active ? c.primary : c.textMuted} />
                      <Text className={`text-xs font-semibold ${active ? 'text-brand-primary' : 'text-typography-main'}`}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {draft.data_type === 'enum' && (
              <View className="gap-1.5">
                <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider">Options</Text>
                <TextInput
                  value={draft.enumOptions}
                  onChangeText={enumOptions => setDraft(d => d && ({ ...d, enumOptions }))}
                  placeholder="Yes, No, Pending"
                  placeholderTextColor={c.textDim}
                  className="bg-surface-background border border-surface-border rounded-lg px-3 text-typography-main text-sm"
                  style={{ height: 40 }}
                />
                <Text className="text-typography-dim text-[10px]">Comma-separated.</Text>
              </View>
            )}

            {!!problem && (
              <View className="px-3 py-2 rounded-xl bg-state-danger/10 border border-state-danger/30">
                <Text className="text-state-danger text-[11px] font-semibold">{problem}</Text>
              </View>
            )}
          </View>
        )}

        {loading ? (
          <Text className="text-typography-muted text-xs">Loading…</Text>
        ) : sorted.length === 0 && !draft ? (
          <Text className="text-typography-muted text-xs">
            No custom fields yet — they appear automatically the first time a spreadsheet import has a column TrustFlow doesn't recognize.
          </Text>
        ) : (
          <View className="gap-2">
            {sorted.map((d, i) => (
              <View
                key={d.id}
                className="flex-row items-center gap-2 bg-surface-card border border-surface-border rounded-xl px-3"
                style={{ height: 52 }}
              >
                <View className="gap-0.5" style={{ marginRight: 4 }}>
                  <TouchableOpacity
                    disabled={i === 0 || movingId === d.id}
                    onPress={() => move(d, -1)}
                    accessibilityLabel={`Move ${d.label} up`}
                    style={{ opacity: i === 0 ? 0.25 : 1 }}
                  >
                    <FontAwesome name="chevron-up" size={10} color={c.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={i === sorted.length - 1 || movingId === d.id}
                    onPress={() => move(d, 1)}
                    accessibilityLabel={`Move ${d.label} down`}
                    style={{ opacity: i === sorted.length - 1 ? 0.25 : 1 }}
                  >
                    <FontAwesome name="chevron-down" size={10} color={c.textMuted} />
                  </TouchableOpacity>
                </View>

                <View className="flex-1 min-w-0">
                  <Text numberOfLines={1} className="text-typography-main text-sm font-bold">{d.label}</Text>
                  <Text numberOfLines={1} className="text-typography-dim text-[10px]">
                    {FIELD_TYPE_LABELS[d.data_type]}{d.source_column ? ` · from “${d.source_column}”` : ''}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => startEdit(d)}
                  accessibilityLabel={`Edit ${d.label}`}
                  className="p-2 rounded-lg hover:bg-surface-overlay"
                >
                  <FontAwesome name="pencil" size={13} color={c.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => remove(d)}
                  accessibilityLabel={`Delete ${d.label}`}
                  className="p-2 rounded-lg hover:bg-surface-overlay"
                >
                  <FontAwesome name="trash-o" size={13} color={c.danger} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>
    </Popup>
  );
}
