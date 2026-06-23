import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/useThemeColors';
import { ALL_EVENT_TYPES, ALL_STRATEGIES, EVENT_META, STRATEGY_LABELS } from '@/lib/notificationRuleConstants';
import { useRuleEditorForm } from '@/lib/useRuleEditorForm';
import type { RuleEditorModalProps } from './RuleEditorModal';

export default function RuleEditorModal({ visible, existing, onClose, onSaved }: RuleEditorModalProps) {
  const c = useThemeColors();
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
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 }}>
        <View
          className="w-full rounded-3xl overflow-hidden"
          style={{ maxWidth: 600, maxHeight: '90%', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
        >
          <View className="flex-row items-center justify-between px-6 pt-5 pb-4" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
            <Text style={{ color: c.textMain }} className="font-black text-xl tracking-tight">
              {existing ? 'Edit Rule' : 'New Rule'}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              className="w-8 h-8 rounded-full items-center justify-center"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <FontAwesome name="times" size={14} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView className="px-6" contentContainerStyle={{ paddingTop: 20, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
            {/* Name */}
            <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest mb-2">Rule Name *</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Notify on Assignment"
              placeholderTextColor={c.textDim}
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain }}
              className="rounded-xl px-4 py-3 text-sm mb-4"
            />

            {/* Description */}
            <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest mb-2">Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Optional, shown in the rule list"
              placeholderTextColor={c.textDim}
              multiline
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain, minHeight: 56 }}
              className="rounded-xl px-4 py-3 text-sm mb-4"
            />

            {/* Event Type */}
            <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest mb-2">Trigger Event</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {ALL_EVENT_TYPES.map((et) => {
                const active = eventType === et;
                return (
                  <TouchableOpacity
                    key={et}
                    onPress={() => setEventType(et)}
                    className="px-3 py-2 rounded-xl"
                    style={{ backgroundColor: active ? c.primary : c.background, borderWidth: 1, borderColor: active ? c.primary : c.border }}
                  >
                    <Text style={{ color: active ? '#fff' : c.textMuted }} className="text-[10px] font-black">
                      {EVENT_META[et]?.label ?? et}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Strategies */}
            <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest mb-2">Notify Recipients *</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {ALL_STRATEGIES.map((s) => {
                const active = strategies.includes(s);
                return (
                  <TouchableOpacity
                    key={s}
                    onPress={() => toggleStrategy(s)}
                    className="px-3 py-2 rounded-xl"
                    style={{ backgroundColor: active ? c.primary + '1A' : c.background, borderWidth: 1, borderColor: active ? c.primary : c.border }}
                  >
                    <Text style={{ color: active ? c.primary : c.textMuted }} className="text-[10px] font-black">
                      {STRATEGY_LABELS[s]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Recipient Config */}
            <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest mb-1">Recipient Config (JSON)</Text>
            <Text style={{ color: c.textMuted }} className="text-[10px] mb-2">e.g. {`{"payload_field":"manager_id"}`} for payload_user, or {`{"role":"Admin"}`} for role.</Text>
            <TextInput
              value={recipientConfigJson}
              onChangeText={setRecipientConfigJson}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={c.textDim}
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain, minHeight: 72, fontFamily: 'monospace' }}
              className="rounded-xl px-4 py-3 text-xs mb-4"
            />

            {/* Conditions */}
            <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest mb-1">Conditions (JSON)</Text>
            <Text style={{ color: c.textMuted }} className="text-[10px] mb-2">All keys must match the event payload exactly. Leave as {`{}`} to match every event.</Text>
            <TextInput
              value={conditionsJson}
              onChangeText={setConditionsJson}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={c.textDim}
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain, minHeight: 72, fontFamily: 'monospace' }}
              className="rounded-xl px-4 py-3 text-xs mb-2"
            />
          </ScrollView>

          <View className="px-6 pb-6 pt-3" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            <TouchableOpacity
              onPress={submit}
              disabled={saving}
              className="py-4 rounded-2xl items-center"
              style={{ backgroundColor: c.primary }}
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
        </View>
      </View>
    </Modal>
  );
}
