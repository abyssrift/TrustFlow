import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';

const PRIORITY_MAP: Record<string, { color: string; label: string }> = {
  urgent: { color: '#ef4444', label: 'URGENT' },
  high:   { color: '#f59e0b', label: 'HIGH' },
  medium: { color: '#94a3b8', label: 'NORMAL' },
  low:    { color: '#22c55e', label: 'LOW' },
};

export default function TaskHeader() {
  const { data } = useTaskDetail();
  const { isActive, activeSession, startWork, stopWork } = useTimer();
  const [busy, setBusy] = React.useState(false);
  const [elapsedLocal, setElapsedLocal] = React.useState(0);
  const router = useRouter();

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isActive && activeSession?.task_id === data?.task.id) {
      const start = new Date(activeSession.started_at).getTime();
      setElapsedLocal(Math.floor((Date.now() - start) / 1000));
      timer = setInterval(() => {
        setElapsedLocal(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isActive, activeSession, data?.task.id]);

  if (!data) return null;

  const { task, current_stage } = data;
  const prio = PRIORITY_MAP[task.priority] || PRIORITY_MAP.medium;

  const handleBack = () => {
    // If we have a pipeline, go back to it directly.
    // router.back() falls through to the dashboard when there's no stack.
    if (data.pipeline?.id) {
      router.replace(`/(tabs)/tasks?pipelineId=${data.pipeline.id}` as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/tasks' as any);
    }
  };

  return (
    <View className="px-5 pt-12 pb-4 bg-surface-card border-b border-surface-border">
      {/* Top row: back + badges */}
      <View className="flex-row items-center mb-3">
        <TouchableOpacity
          onPress={handleBack}
          className="mr-4 bg-surface-background p-2 rounded-xl border border-surface-border active:opacity-50"
        >
          <FontAwesome name="chevron-left" size={16} color="#94a3b8" />
        </TouchableOpacity>

        <View className="flex-1 flex-row items-center flex-wrap gap-2">
          {/* Priority badge */}
          <View className="bg-surface-background px-2 py-0.5 rounded-md border border-surface-border">
            <Text style={{ color: prio.color }} className="text-[9px] font-black uppercase tracking-tighter">
              {prio.label}
            </Text>
          </View>

          {/* Stage badge */}
          {current_stage && (
            <View className="flex-row items-center bg-brand-primary/10 px-2.5 py-0.5 rounded-full border border-brand-primary/30">
              <View style={{ backgroundColor: current_stage.color || '#6366f1' }} className="w-1.5 h-1.5 rounded-full mr-1.5" />
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wider">
                {current_stage.name}
              </Text>
            </View>
          )}

          {/* Sub-task badge */}
          {task.parent_task_id && (
            <View className="bg-brand-primary/20 px-1.5 py-0.5 rounded-sm">
              <Text className="text-brand-primary text-[8px] font-black italic">SUB-TASK</Text>
            </View>
          )}

          {/* Error state badge */}
          {task.error_state && (
            <View className="bg-state-danger/10 px-2 py-0.5 rounded-md border border-state-danger/30">
              <Text className="text-state-danger text-[8px] font-black uppercase">{task.error_state}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Title & Actions Row */}
      <View className="flex-row items-center justify-between mt-1">
        <View className="flex-1 mr-4">
          <Text className="text-typography-main text-2xl font-black tracking-tight">
            {task.title}
          </Text>
          {/* Muted info row */}
          <View className="flex-row items-center gap-4 mt-1">
            {task.category && (
              <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wider">{task.category}</Text>
            )}
            {data.pipeline && (
              <Text className="text-typography-dim text-[10px] font-bold">
                <FontAwesome name="code-fork" size={9} color="#64748b" /> {data.pipeline.name}
              </Text>
            )}
          </View>
        </View>

        {/* Compact Timer Control */}
        <View className="flex-row items-center gap-3">
          {isActive && activeSession?.task_id === task.id ? (
            <View className="flex-row items-center bg-brand-primary/10 pl-3 pr-1 py-1 rounded-full border border-brand-primary/20">
              <Text className="text-brand-primary font-mono text-xs font-bold mr-3">
                {Math.floor(elapsedLocal / 3600).toString().padStart(2, '0')}:
                {Math.floor((elapsedLocal % 3600) / 60).toString().padStart(2, '0')}:
                {(elapsedLocal % 60).toString().padStart(2, '0')}
              </Text>
              <TouchableOpacity 
                onPress={async () => {
                  setBusy(true);
                  await stopWork();
                  setBusy(false);
                }}
                disabled={busy}
                className="w-7 h-7 rounded-full bg-brand-primary items-center justify-center"
              >
                <FontAwesome name="stop" size={8} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              onPress={async () => {
                setBusy(true);
                await startWork(task.id, task.title);
                setBusy(false);
              }}
              disabled={busy}
              className="flex-row items-center bg-surface-background border border-surface-border px-3 py-1.5 rounded-xl active:bg-surface-overlay"
            >
              {busy ? (
                <ActivityIndicator size="small" color="rgb(var(--brand-primary))" />
              ) : (
                <>
                  <FontAwesome name="play" size={10} color="rgb(var(--brand-primary))" />
                  <Text className="text-brand-primary text-[10px] font-black uppercase ml-2">Start Working</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}
