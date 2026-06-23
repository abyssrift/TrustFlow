import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import DraggableSheet from '@/components/common/DraggableSheet';
import { useThemeColors } from '@/hooks/useThemeColors';
import { ALL_EVENT_TYPES, ALL_STRATEGIES, EVENT_META, NotificationRule, STRATEGY_LABELS } from '@/lib/notificationRuleConstants';
import { useRuleEditorForm } from '@/lib/useRuleEditorForm';

export type RuleEditorModalProps = {
  visible: boolean;
  existing: NotificationRule | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function RuleEditorModal({ visible, existing, onClose, onSaved }: RuleEditorModalProps) {
  const colors = useThemeColors();
  const {
    name, setName,
    description, setDescription,
    eventType, setEventType,
    strategies, toggleStrategy,
    conditionsJson, setConditionsJson,
    recipientConfigJson, setRecipientConfigJson,
    saving, submit,
  } = useRuleEditorForm({ visible, existing, onClose, onSaved });

  return (
    <DraggableSheet
      visible={visible}
      onClose={onClose}
      dimBackdrop
      maxHeight="90%"
      containerClassName="bg-surface-card w-full rounded-t-3xl border-t border-surface-border"
    >
      <View className="flex-row items-center justify-between px-6 pt-4 pb-4 border-b border-surface-border">
        <Text className="text-typography-main font-black text-xl tracking-tight">
          {existing ? 'Edit Rule' : 'New Rule'}
        </Text>
        <TouchableOpacity
          onPress={onClose}
          className="w-8 h-8 bg-surface-background rounded-full items-center justify-center border border-surface-border"
        >
          <FontAwesome name="times" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView className="px-6 py-5" showsVerticalScrollIndicator={false}>
        {/* Name */}
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Rule Name *</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Notify on Assignment"
          placeholderTextColor={colors.textDim}
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm mb-4"
        />

        {/* Description */}
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Optional, shown in the rule list"
          placeholderTextColor={colors.textDim}
          multiline
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm mb-4"
          style={{ minHeight: 56 }}
        />

        {/* Event Type */}
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Trigger Event</Text>
        <View className="flex-row flex-wrap gap-2 mb-4">
          {ALL_EVENT_TYPES.map((et) => (
            <TouchableOpacity
              key={et}
              onPress={() => setEventType(et)}
              className={`px-3 py-2 rounded-xl border ${
                eventType === et ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
              }`}
            >
              <Text className={`text-[10px] font-black ${eventType === et ? 'text-white' : 'text-typography-muted'}`}>
                {EVENT_META[et]?.label ?? et}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Strategies */}
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Notify Recipients *</Text>
        <View className="flex-row flex-wrap gap-2 mb-4">
          {ALL_STRATEGIES.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => toggleStrategy(s)}
              className={`px-3 py-2 rounded-xl border ${
                strategies.includes(s) ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'
              }`}
            >
              <Text className={`text-[10px] font-black ${strategies.includes(s) ? 'text-brand-primary' : 'text-typography-muted'}`}>
                {STRATEGY_LABELS[s]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Recipient Config */}
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Recipient Config (JSON)</Text>
        <Text className="text-typography-muted text-[10px] mb-2">e.g. {`{"payload_field":"manager_id"}`} for payload_user, or {`{"role":"Admin"}`} for role.</Text>
        <TextInput
          value={recipientConfigJson}
          onChangeText={setRecipientConfigJson}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={colors.textDim}
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-xs mb-4 font-mono"
          style={{ minHeight: 72, fontFamily: 'monospace' }}
        />

        {/* Conditions */}
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Conditions (JSON)</Text>
        <Text className="text-typography-muted text-[10px] mb-2">All keys must match the event payload exactly. Leave as {`{}`} to match every event.</Text>
        <TextInput
          value={conditionsJson}
          onChangeText={setConditionsJson}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={colors.textDim}
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-xs mb-6 font-mono"
          style={{ minHeight: 72, fontFamily: 'monospace' }}
        />
      </ScrollView>

      <View className="px-6 pb-6 pt-2 border-t border-surface-border">
        <TouchableOpacity
          onPress={submit}
          disabled={saving}
          className="bg-brand-primary py-4 rounded-2xl items-center"
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text className="text-white font-black uppercase tracking-widest text-xs">
              {existing ? 'Save Changes' : 'Create Rule'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </DraggableSheet>
  );
}
