import ManualTimeModal from '@/components/common/ManualTimeModal';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import CollapsibleCard from './CollapsibleCard';

function formatDuration(seconds: number) {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

export default function TimerPanel() {
  const { data, refresh } = useTaskDetail();
  const { warningToast } = useToast();
  const colors = useThemeColors();
  const [showManualTime, setShowManualTime] = useState(false);
  if (!data) return null;

  const totalSpent = data.stats.total_time_spent_seconds || 0;
  const recentSessions = data.work_sessions
    .filter(ws => ws.status === 'completed')
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, 5);

  // Same gate the advance action enforces (StageActions) — only offer the QOL
  // shortcut where a declaration would actually be accepted.
  const stage = data.current_stage;
  const myEntry = data.my_manual_time_entry;
  const gateActive =
    !!stage?.requires_timer &&
    !stage?.is_initial &&
    (stage?.min_timer_seconds ?? 300) > 0 &&
    data.permissions.is_assigned;
  const canDeclare = gateActive && myEntry?.approval_status !== 'pending' && myEntry?.approval_status !== 'approved';

  return (
    <>
      <CollapsibleCard
        icon="history"
        title="Total Effort"
        defaultCollapsed
        headerRight={<Text className="text-typography-main text-sm font-black">{formatDuration(totalSpent)}</Text>}
      >
        {/* Sessions List */}
        <View className="gap-1">
          <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest mb-2">Recent Sessions</Text>
          {recentSessions.length === 0 ? (
            <Text className="text-typography-dim text-[10px] italic">No completed sessions yet.</Text>
          ) : (
            recentSessions.map((s) => (
              <View key={s.id} className="flex-row items-center justify-between py-2 border-t border-surface-border/10">
                <View className="flex-row items-center">
                  <View className="w-1 h-1 rounded-full bg-typography-dim mr-2 opacity-50" />
                  <View>
                    <Text className="text-typography-main text-[10px] font-bold">
                      {new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                </View>
                <Text className="text-typography-muted font-mono text-[10px]">{formatDuration(s.total_seconds_spent)}</Text>
              </View>
            ))
          )}
        </View>

        {canDeclare && (
          <TouchableOpacity
            onPress={() => setShowManualTime(true)}
            className="flex-row items-center justify-center gap-2 mt-3 py-2.5 rounded-xl border border-state-warning/30 bg-state-warning/10 active:opacity-75"
          >
            <FontAwesome name="clock-o" size={11} color={colors.warning} />
            <Text className="text-state-warning text-[10px] font-black uppercase tracking-widest">Declare Work Time</Text>
          </TouchableOpacity>
        )}
      </CollapsibleCard>

      {stage && (
        <ManualTimeModal
          visible={showManualTime}
          taskId={data.task.id}
          stageId={stage.id}
          minTimerSeconds={stage.min_timer_seconds}
          onSuccess={() => {
            setShowManualTime(false);
            refresh();
            warningToast('Your time declaration has been sent to your manager for approval.');
          }}
          onCancel={() => setShowManualTime(false)}
        />
      )}
    </>
  );
}
