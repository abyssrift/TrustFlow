import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import Popup from '@/components/common/Popup';
import { FilterChip } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FIELD_TYPE_LABELS, type ProjectFieldDef } from '@/hooks/useProjectFields';

// Issue #197 items 2+3. rpc_projects_table has carried custom_fields JSONB
// and p_field_filters (20260802_project_custom_fields.sql,
// 20260803_projects_table_field_filter.sql) since early August; nothing in
// ProjectsTable read or filtered by either. These two controls are the
// missing pieces — which columns to show, and the one filter condition the
// issue's motivating case needs ("Inventory Count Needed = YES every week").
//
// Both render nothing when the company has no custom fields, the same rule
// ProjectFieldsCard and ManageProjectFieldsPopup already follow — an empty
// "Columns" button on every company that has never imported a spreadsheet
// would be noise about a feature they don't use.

export type CustomFieldFilter = { key: string; op: 'eq' | 'set' | 'unset'; value: string };

const OP_LABELS: Record<CustomFieldFilter['op'], string> = {
  eq: 'Equals',
  set: 'Has any value',
  unset: 'Is blank',
};

function filterSummary(filter: CustomFieldFilter, def: ProjectFieldDef | undefined): string {
  const label = def?.label ?? filter.key;
  if (filter.op !== 'eq') return `${label}: ${filter.op === 'set' ? 'any value' : 'blank'}`;
  return `${label}: ${filter.value || '…'}`;
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center gap-1.5 rounded-lg border px-3"
      style={{ height: 34, borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primary + '1A' : 'transparent' }}
    >
      <Text className={`text-xs font-semibold ${active ? 'text-brand-primary' : 'text-typography-main'}`}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Trigger chip + popup for the single active custom-field filter. Sent to
 * the server as p_field_filters — filtering the fetched page client-side
 * would answer "which of this page matches", not "which projects match"
 * (see 20260803_projects_table_field_filter.sql's header for why that
 * distinction matters once paging is involved).
 *
 * Scope is deliberately one condition at a time, matching the single-select
 * stage filter and the "blocked only" toggle already in this filter bar —
 * not a second, differently-shaped filter system next to them.
 */
export function CustomFieldFilterControl({
  defs,
  value,
  onChange,
  touchTarget,
}: {
  defs: ProjectFieldDef[];
  value: CustomFieldFilter | null;
  onChange: (next: CustomFieldFilter | null) => void;
  touchTarget?: boolean;
}) {
  const c = useThemeColors();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<CustomFieldFilter | null>(value);

  if (defs.length === 0) return null;

  const activeDef = value ? defs.find(d => d.key === value.key) : undefined;
  const draftDef = draft ? defs.find(d => d.key === draft.key) : undefined;
  const canApply = !!draft && (draft.op !== 'eq' || draft.value.trim() !== '');

  const open = () => { setDraft(value); setVisible(true); };
  const apply = () => {
    if (!canApply || !draft) return;
    onChange(draft);
    setVisible(false);
  };
  const clear = () => { onChange(null); setDraft(null); setVisible(false); };

  return (
    <>
      <FilterChip
        label={value ? filterSummary(value, activeDef) : 'Custom field'}
        icon="sliders"
        active={!!value}
        onPress={open}
        touchTarget={touchTarget}
      />

      <Popup
        visible={visible}
        onClose={() => setVisible(false)}
        presentation="auto"
        maxWidth={440}
        title="Filter by custom field"
        footer="dual-action"
        primaryAction={{ label: 'Apply', onPress: apply, variant: canApply ? 'default' : 'disabled' }}
        secondaryAction={{ label: 'Cancel', onPress: () => setVisible(false) }}
      >
        <View className="gap-4">
          <View className="gap-1.5">
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider">Field</Text>
            <View className="flex-row flex-wrap gap-2">
              {defs.map(d => (
                <Pill
                  key={d.id}
                  label={d.label}
                  active={draft?.key === d.key}
                  onPress={() => setDraft(draft?.key === d.key ? null : { key: d.key, op: 'eq', value: '' })}
                />
              ))}
            </View>
          </View>

          {draft && draftDef && (
            <>
              <View className="gap-1.5">
                <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider">Condition</Text>
                <View className="flex-row flex-wrap gap-2">
                  {(Object.keys(OP_LABELS) as CustomFieldFilter['op'][]).map(op => (
                    <Pill
                      key={op}
                      label={OP_LABELS[op]}
                      active={draft.op === op}
                      onPress={() => setDraft(d => d && { ...d, op, value: op === 'eq' ? d.value : '' })}
                    />
                  ))}
                </View>
              </View>

              {draft.op === 'eq' && (
                <View className="gap-1.5">
                  <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider">Value</Text>
                  {draftDef.data_type === 'boolean' ? (
                    <View className="flex-row gap-2">
                      <Pill label="Yes" active={draft.value === 'true'} onPress={() => setDraft(d => d && { ...d, value: 'true' })} />
                      <Pill label="No" active={draft.value === 'false'} onPress={() => setDraft(d => d && { ...d, value: 'false' })} />
                    </View>
                  ) : draftDef.data_type === 'enum' ? (
                    <View className="flex-row flex-wrap gap-2">
                      {(draftDef.enum_options ?? []).map(opt => (
                        <Pill key={opt} label={opt} active={draft.value === opt} onPress={() => setDraft(d => d && { ...d, value: opt })} />
                      ))}
                    </View>
                  ) : (
                    <>
                      <TextInput
                        value={draft.value}
                        onChangeText={v => setDraft(d => d && { ...d, value: v })}
                        placeholder={draftDef.data_type === 'date' ? 'YYYY-MM-DD' : draftDef.data_type === 'number' ? 'e.g. 8000' : 'Type a value'}
                        placeholderTextColor={c.textDim}
                        keyboardType={draftDef.data_type === 'number' ? 'numeric' : 'default'}
                        autoCapitalize="none"
                        className="bg-surface-background border border-surface-border rounded-lg px-3 text-typography-main text-sm"
                        style={{ height: 40 }}
                      />
                      {draftDef.data_type === 'date' && (
                        <Text className="text-typography-dim text-[10px]">Matches this exact date.</Text>
                      )}
                    </>
                  )}
                </View>
              )}
            </>
          )}

          {!!value && (
            <TouchableOpacity onPress={clear} className="flex-row items-center gap-2 self-start py-1">
              <FontAwesome name="eraser" size={11} color={c.textMuted} />
              <Text className="text-typography-muted text-[11px] font-semibold">Clear this filter</Text>
            </TouchableOpacity>
          )}
        </View>
      </Popup>
    </>
  );
}

/**
 * Icon button + popup letting the viewer opt custom fields into the table as
 * extra columns (desktop) / extra footer lines (mobile card). Purely a
 * display preference — persisted per-device by the caller, not sent to the
 * server and not counted as a "filter" the way the stage chip / blocked
 * toggle / CustomFieldFilterControl above are.
 */
export function CustomColumnsControl({
  defs,
  selectedKeys,
  onChange,
  touchTarget,
}: {
  defs: ProjectFieldDef[];
  selectedKeys: string[];
  onChange: (next: string[]) => void;
  touchTarget?: boolean;
}) {
  const c = useThemeColors();
  const [visible, setVisible] = useState(false);

  if (defs.length === 0) return null;

  const toggle = (key: string) => {
    onChange(selectedKeys.includes(key) ? selectedKeys.filter(k => k !== key) : [...selectedKeys, key]);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Choose custom field columns"
        className="flex-row items-center gap-1.5 rounded-full border px-3 justify-center"
        style={{
          minHeight: touchTarget ? 44 : undefined,
          paddingVertical: touchTarget ? 0 : 6,
          borderColor: selectedKeys.length > 0 ? c.primary : c.border,
          backgroundColor: selectedKeys.length > 0 ? c.primary + '1A' : 'transparent',
        }}
      >
        <FontAwesome name="columns" size={11} color={selectedKeys.length > 0 ? c.primary : c.textMuted} />
        <Text className={`text-xs font-semibold ${selectedKeys.length > 0 ? 'text-brand-primary' : 'text-typography-main'}`}>
          Columns{selectedKeys.length > 0 ? ` (${selectedKeys.length})` : ''}
        </Text>
      </TouchableOpacity>

      <Popup
        visible={visible}
        onClose={() => setVisible(false)}
        presentation="auto"
        maxWidth={440}
        title="Custom field columns"
        footer="none"
      >
        <View className="gap-3">
          <Text className="text-typography-muted text-xs">
            Show any of your spreadsheet's imported columns alongside the built-in ones. This choice is saved on this device only.
          </Text>
          <View className="gap-2">
            {defs.map(d => {
              const active = selectedKeys.includes(d.key);
              return (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => toggle(d.key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={d.label}
                  className="flex-row items-center gap-2.5 rounded-xl border px-3"
                  style={{ minHeight: 44, borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primary + '1A' : 'transparent' }}
                >
                  <FontAwesome name={active ? 'check-square' : 'square-o'} size={14} color={active ? c.primary : c.textDim} />
                  <View className="flex-1 min-w-0">
                    <Text numberOfLines={1} className={`text-sm font-semibold ${active ? 'text-brand-primary' : 'text-typography-main'}`}>{d.label}</Text>
                    <Text numberOfLines={1} className="text-typography-dim text-[10px]">{FIELD_TYPE_LABELS[d.data_type]}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Popup>
    </>
  );
}
