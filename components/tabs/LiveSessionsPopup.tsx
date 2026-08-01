import Popup from '@/components/common/Popup';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { supabase } from '@/lib/supabase';
import { IDLE_MS, idleLabel, idleMsOf } from '@/lib/sessionPresence';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';

// "Who's live right now" list behind the dashboard Live Sessions card: one row
// per active work session — person, the task they're on, live-ticking elapsed
// time. Tapping a row jumps to the task.

type LiveRowData = {
  id: string;
  taskId: string;
  startedAt: string;
  lastHeartbeatAt: string | null;
  name: string;
  avatar: string | null;
  taskTitle: string;
  pipelineName: string | null;
};

function LiveRow({ row, onOpen }: { row: LiveRowData; onOpen: (taskId: string) => void }) {
  const elapsed = useElapsedTime(row.startedAt);
  const idle = idleMsOf(row.lastHeartbeatAt) > IDLE_MS;
  return (
    <TouchableOpacity
      onPress={() => onOpen(row.taskId)}
      activeOpacity={0.7}
      className="flex-row items-center gap-3 px-4 py-3 rounded-2xl hover:bg-surface-overlay transition-colors"
    >
      <View className="relative">
        <View className="w-9 h-9 rounded-full overflow-hidden bg-surface-overlay items-center justify-center border border-surface-border">
          {row.avatar ? (
            <Image source={{ uri: row.avatar }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <Text className="text-brand-primary font-black text-sm">{row.name.charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View
          className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-card ${
            idle ? 'bg-state-warning' : 'bg-state-success'
          }`}
        />
      </View>
      <View className="flex-1 min-w-0">
        <Text className="text-typography-main font-bold text-[13px]" numberOfLines={1}>{row.name}</Text>
        <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
          {row.taskTitle}{row.pipelineName ? ` · ${row.pipelineName}` : ''}
        </Text>
        {idle && (
          <Text className="text-state-warning text-[10px] font-medium">{idleLabel(idleMsOf(row.lastHeartbeatAt))}</Text>
        )}
      </View>
      <Text
        className={`font-mono text-[13px] ${idle ? 'text-typography-dim' : 'text-state-success'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {elapsed}
      </Text>
      <FontAwesome name="chevron-right" size={10} className="text-typography-dim" />
    </TouchableOpacity>
  );
}

export default function LiveSessionsPopup({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<LiveRowData[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setRows(null);
    supabase
      .from('task_work_sessions')
      .select('id, task_id, started_at, last_heartbeat_at, user:user_id(full_name, avatar_url), task:task_id(title, pipeline:pipeline_id(name))')
      .eq('status', 'active')
      .order('started_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data || []).map((s: any) => ({
          id: s.id,
          taskId: s.task_id,
          startedAt: s.started_at,
          lastHeartbeatAt: s.last_heartbeat_at,
          name: s.user?.full_name || 'User',
          avatar: s.user?.avatar_url ?? null,
          taskTitle: s.task?.title || 'Unknown task',
          pipelineName: s.task?.pipeline?.name ?? null,
        })));
      });
    return () => { cancelled = true; };
  }, [visible]);

  const openTask = (taskId: string) => {
    onClose();
    router.push(`/task/${taskId}` as any);
  };

  return (
    <Popup visible={visible} onClose={onClose} title="Live now" dimBackdrop presentation="auto" maxHeight="80%" maxWidth={420}>
      {rows === null ? (
        <View className="items-center py-12">
          <ActivityIndicator />
        </View>
      ) : rows.length === 0 ? (
        <View className="items-center py-12 px-6">
          <FontAwesome name="moon-o" size={26} className="text-typography-dim" />
          <Text className="text-typography-main font-black text-base mt-4">All quiet</Text>
          <Text className="text-typography-muted text-sm mt-1">No one is working right now</Text>
        </View>
      ) : (
        <View className="py-2">
          {rows.map(r => <LiveRow key={r.id} row={r} onOpen={openTask} />)}
        </View>
      )}
    </Popup>
  );
}
