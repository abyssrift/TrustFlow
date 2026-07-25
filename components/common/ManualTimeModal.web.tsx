import Popup from '@/components/common/Popup';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';

const todayIso = () => new Date().toISOString().split('T')[0];
const formatWorkedDate = (d: string) => {
  if (d === todayIso()) return 'Today';
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

type Props = {
  visible: boolean;
  taskId: string;
  stageId: string;
  transitionId?: string | null;
  minTimerSeconds?: number;
  onSuccess: (isFlagged: boolean, flagReason: string | null, approvalStatus: string) => void;
  onCancel: () => void;
};

export default function ManualTimeModal({ visible, taskId, stageId, transitionId, minTimerSeconds = 300, onSuccess, onCancel }: Props) {
  const minMinutes = Math.max(1, Math.round(minTimerSeconds / 60));
  const colors = useThemeColors();
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [reason, setReason] = useState('');
  const [workedDate, setWorkedDate] = useState(todayIso());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setHours('');
    setMinutes('');
    setReason('');
    setWorkedDate(todayIso());
    setShowDatePicker(false);
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
        p_worked_date:      workedDate,
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
    if (loading) return;
    reset();
    onCancel();
  };

  return (
    <Popup visible={visible} onClose={handleCancel} dimBackdrop maxHeight="90%" presentation="auto" maxWidth={520} containerClassName="w-[95%] max-h-[90vh] rounded-[2.5rem] overflow-hidden premium-shadow-lg">
      <View className="bg-surface-card w-full rounded-[2.5rem] border border-surface-border overflow-hidden premium-shadow-lg" style={{ maxWidth: 520 }}>

        {/* Header */}
        <View className="p-10 pb-0 items-center relative">
          <TouchableOpacity
            onPress={handleCancel}
            disabled={loading}
            className="absolute top-6 right-6 w-9 h-9 bg-surface-background rounded-full items-center justify-center border border-surface-border hover:bg-surface-overlay transition-colors"
          >
            <FontAwesome name="times" size={14} color={colors.textMuted} />
          </TouchableOpacity>

          <View className="w-20 h-20 rounded-full bg-state-warning/10 items-center justify-center mb-6">
            <FontAwesome name="clock-o" size={32} color={colors.warning} />
          </View>
          <Text className="text-typography-main text-3xl font-black tracking-tight mb-4 text-center">
            Declare Work Hours
          </Text>
          <Text className="text-typography-muted text-center font-medium leading-relaxed">
            Less than {minMinutes} minute{minMinutes === 1 ? '' : 's'} of active timer was recorded for this stage. How long did you actually work on this task?
          </Text>
        </View>

        {/* Inputs */}
        <View className="px-10 pb-6 pt-6">

          {/* Time inputs */}
          <View className="flex-row gap-4 mb-4 items-end">
            <View className="flex-1">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Hours</Text>
              <TextInput
                className="bg-surface-background border border-surface-border rounded-2xl px-4 py-4 text-typography-main text-lg font-bold text-center focus:border-brand-primary transition-all"
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
                className="bg-surface-background border border-surface-border rounded-2xl px-4 py-4 text-typography-main text-lg font-bold text-center focus:border-brand-primary transition-all"
                keyboardType="number-pad"
                maxLength={2}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                value={minutes}
                onChangeText={v => setMinutes(v.replace(/[^0-9]/g, ''))}
              />
            </View>
          </View>

          {/* Worked on */}
          <View className="mb-4">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Worked On</Text>
            <TouchableOpacity
              onPress={() => setShowDatePicker(s => !s)}
              className="bg-surface-background border border-surface-border rounded-2xl px-4 py-3 flex-row items-center justify-between hover:bg-surface-overlay transition-colors"
            >
              <Text className="text-typography-main font-medium text-sm">{formatWorkedDate(workedDate)}</Text>
              <FontAwesome name="calendar-o" size={12} color={colors.textMuted} />
            </TouchableOpacity>
            {showDatePicker && (
              <View className="mt-2">
                <PremiumCalendarPicker
                  selectedDate={workedDate}
                  onSelect={d => { setWorkedDate(d > todayIso() ? todayIso() : d); setShowDatePicker(false); }}
                  accentColor={colors.warning}
                  scale="compact"
                />
              </View>
            )}
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
              className="bg-surface-background border border-surface-border rounded-2xl px-4 py-3 text-typography-main focus:border-brand-primary transition-all"
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

        </View>

        {/* Action buttons */}
        <View className="px-10 pb-10 flex-row gap-6 border-t border-surface-border pt-6">
          <TouchableOpacity
            onPress={handleCancel}
            disabled={loading}
            className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center hover:bg-surface-overlay transition-colors"
          >
            <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={loading}
            className="flex-[2] py-5 rounded-2xl bg-state-warning items-center premium-shadow active:scale-[0.98] transition-all"
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white font-black uppercase tracking-widest text-lg">Submit</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Popup>
  );
}
