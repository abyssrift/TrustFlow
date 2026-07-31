import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

// #172 P2 -- "awaiting client" flag (plan §5: composes with any stage, in any
// vertical, so it's a flag next to the stage rather than a stage itself).
// Shared by ProjectDashboard.tsx and ProjectDashboardSheet.tsx. Styled with
// inline useThemeColors values throughout (not className tokens) since it's
// rendered inside both the centered-Popup (RN Modal) and DraggableSheet
// variants of the project detail view -- see Tooltip.tsx for the same
// sanctioned exception and why.

export default function ProjectBlockedToggle({
  blocked, blockedReason, onSave, disabled,
}: {
  blocked: boolean;
  blockedReason: string | null;
  onSave: (blocked: boolean, reason: string | null) => Promise<boolean>;
  disabled?: boolean;
}) {
  const c = useThemeColors();
  const [reasonDraft, setReasonDraft] = useState(blockedReason || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setReasonDraft(blockedReason || ''); }, [blockedReason]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    await onSave(next, next ? reasonDraft : null);
    setSaving(false);
  };

  const saveReason = async () => {
    if (reasonDraft.trim() === (blockedReason || '')) return;
    setSaving(true);
    await onSave(true, reasonDraft);
    setSaving(false);
  };

  return (
    <View className="rounded-2xl border p-4" style={{ backgroundColor: blocked ? c.danger + '0D' : c.card, borderColor: blocked ? c.danger + '55' : c.border }}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2 flex-1 pr-3">
          <FontAwesome name="exclamation-triangle" size={12} color={blocked ? c.danger : c.textMuted} />
          <Text className="text-sm font-black" style={{ color: blocked ? c.danger : c.textMain }}>Blocked / Awaiting Client</Text>
          {saving && <ActivityIndicator size="small" color={c.textMuted} />}
        </View>
        <Switch
          value={blocked}
          onValueChange={toggle}
          disabled={disabled || saving}
          trackColor={{ false: c.border, true: c.danger }}
          thumbColor="white"
        />
      </View>
      {blocked && (
        <View className="mt-3">
          <TextInput
            value={reasonDraft}
            onChangeText={setReasonDraft}
            onBlur={saveReason}
            editable={!disabled}
            placeholder="Reason (optional) — e.g. waiting on client documents"
            placeholderTextColor={c.textDim}
            className="rounded-xl px-3 py-2.5 text-sm"
            style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain }}
          />
        </View>
      )}
    </View>
  );
}
