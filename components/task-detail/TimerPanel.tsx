import ManualTimeModal from '@/components/common/ManualTimeModal';
import { useTaskDetail, WorkSessionData } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useTicker } from '@/hooks/useTicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
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

// Who + when, at a glance: small avatar so "Recent Sessions" reads as an audit
// trail (matches this task's other member/name affordances) rather than just
// a bare duration list.
function SessionAvatar({ name, avatarUrl }: { name: string | null; avatarUrl?: string | null }) {
  return (
    <View className="w-6 h-6 rounded-full overflow-hidden bg-surface-overlay items-center justify-center flex-shrink-0">
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Text className="text-brand-primary font-black text-[9px]">
          {(name ?? '?').charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const formatSessionWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function TimerPanel() {
  const { data, refresh } = useTaskDetail();
  const { warningToast } = useToast();
  const colors = useThemeColors();
  const { activeSession, serverTimeOffset } = useTimer();
  // Live-count the in-progress session so Total Effort matches the task card
  // (StageActions), which adds the running session's elapsed time. Completed
  // sessions live in total_time_spent_seconds; the active one is 0 until it stops.
  const liveElapsed = useTicker(
    activeSession && data && activeSession.task_id === data.task.id ? activeSession.started_at : null,
    { offsetMs: serverTimeOffset }
  );
  const [showManualTime, setShowManualTime] = useState(false);
  if (!data) return null;

  const totalSpent = (data.stats.total_time_spent_seconds || 0) + liveElapsed;
  const recentSessions = data.work_sessions
    .filter(ws => ws.status === 'completed')
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, 5);
  const stageNameById = new Map(data.all_stages.map(st => [st.id, st.name]));

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
            recentSessions.map((s: WorkSessionData) => (
              <View key={s.id} className="flex-row items-center justify-between py-2 border-t border-surface-border/10">
                <View className="flex-row items-center flex-1 min-w-0 gap-2">
                  <SessionAvatar name={s.user_name} avatarUrl={s.avatar_url} />
                  <View className="flex-1 min-w-0">
                    <Text className="text-typography-main text-[10px] font-bold" numberOfLines={1}>
                      {s.user_name ?? 'Unknown member'}
                    </Text>
                    <Text className="text-typography-dim text-[9px]" numberOfLines={1}>
                      {formatSessionWhen(s.started_at)}
                      {s.stage_id && stageNameById.get(s.stage_id) ? ` · ${stageNameById.get(s.stage_id)}` : ''}
                    </Text>
                  </View>
                </View>
                <Text className="text-typography-muted font-mono text-[10px] ml-2 flex-shrink-0">{formatDuration(s.total_seconds_spent)}</Text>
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
