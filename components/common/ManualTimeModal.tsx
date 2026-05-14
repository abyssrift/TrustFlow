import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

type Props = {
  visible: boolean;
  taskId: string;
  stageId: string;
  transitionId?: string | null;
  onSuccess: (isFlagged: boolean, flagReason: string | null, approvalStatus: string) => void;
  onCancel: () => void;
};

export default function ManualTimeModal({ visible, taskId, stageId, transitionId, onSuccess, onCancel }: Props) {
  const colors = useThemeColors();
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setHours('');
    setMinutes('');
    setReason('');
    setError(null);
  };

  const handleSubmit = async () => {
    const h = parseInt(hours || '0', 10);
    const m = parseInt(minutes || '0', 10);
    const totalMinutes = h * 60 + m;

    if (isNaN(h) || isNaN(m) || totalMinutes <= 0) {
      setError('Please enter at least 1 minute of work time.');
      return;
    }
    if (totalMinutes > 1440) {
      setError('Cannot declare more than 24 hours for a single stage.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_log_manual_time', {
        p_task_id:          taskId,
        p_stage_id:         stageId,
        p_declared_minutes: totalMinutes,
        p_reason:           reason.trim() || null,
        p_transition_id:    transitionId ?? null,
      });
      if (rpcError) throw rpcError;
      reset();
      onSuccess(data.is_flagged, data.flag_reason, data.approval_status);
    } catch (err: any) {
      setError(err.message || 'Failed to log time. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View className="flex-1 bg-black/70 items-center justify-center p-6">
        <View className="bg-surface-card w-full max-w-lg rounded-[40px] border border-surface-border premium-shadow overflow-hidden">

          {/* Header */}
          <View className="p-10 items-center">
            <View className="w-20 h-20 rounded-full bg-state-warning/10 items-center justify-center mb-6">
              <FontAwesome name="clock-o" size={32} color={colors.warning} />
            </View>
            <Text className="text-typography-main text-3xl font-black tracking-tight mb-4 text-center">
              Declare Work Hours
            </Text>
            <Text className="text-typography-muted text-center font-medium leading-relaxed">
              Less than 5 minutes of active timer was recorded for this stage. How long did you actually work on this task?
            </Text>
          </View>

          {/* Inputs */}
          <View className="px-10 pb-6">

            {/* Time inputs */}
            <View className="flex-row gap-4 mb-4 items-end">
              <View className="flex-1">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Hours</Text>
                <TextInput
                  className="bg-surface-background border border-surface-border rounded-2xl px-4 py-4 text-typography-main text-lg font-bold text-center"
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  value={hours}
                  onChangeText={v => setHours(v.replace(/[^0-9]/g, ''))}
                />
              </View>
              <View className="pb-4">
                <Text className="text-typography-muted text-2xl font-bold">:</Text>
              </View>
              <View className="flex-1">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Minutes</Text>
                <TextInput
                  className="bg-surface-background border border-surface-border rounded-2xl px-4 py-4 text-typography-main text-lg font-bold text-center"
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  value={minutes}
                  onChangeText={v => setMinutes(v.replace(/[^0-9]/g, ''))}
                />
              </View>
            </View>

            {/* Reason */}
            <View className="mb-4">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">
                Reason{' '}
                <Text className="text-typography-muted/50 normal-case tracking-normal font-medium">
                  (optional)
                </Text>
              </Text>
              <TextInput
                className="bg-surface-background border border-surface-border rounded-2xl px-4 py-3 text-typography-main"
                placeholder="e.g. worked offline, forgot to start timer..."
                placeholderTextColor={colors.textMuted}
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={2}
              />
            </View>

            {/* Error */}
            {error && (
              <View className="mb-4 bg-state-danger/10 border border-state-danger/30 rounded-xl p-3">
                <Text className="text-state-danger text-sm font-medium">{error}</Text>
              </View>
            )}

            {/* Fraud notice */}
            <View className="bg-state-warning/5 border border-state-warning/20 rounded-2xl p-4">
              <View className="flex-row items-start gap-3">
                <FontAwesome name="shield" size={14} color={colors.warning} style={{ marginTop: 1 }} />
                <Text className="text-state-warning/80 text-xs font-medium leading-relaxed flex-1">
                  All declarations are logged and auditable. Entries that significantly exceed the task estimate or stage average are automatically flagged for manager review.
                </Text>
              </View>
            </View>
          </View>

          {/* Action buttons */}
          <View className="px-10 pb-10 flex-row gap-6 border-t border-surface-border pt-6">
            <TouchableOpacity
              onPress={handleCancel}
              disabled={loading}
              className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center"
            >
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading}
              className="flex-[2] py-5 rounded-2xl bg-state-warning items-center shadow-lg"
            >
              {loading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-white font-black uppercase tracking-widest text-xs">Submit Declaration</Text>
              )}
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}
