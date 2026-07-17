// ====================================================================
// IslandTimerBridge (web) — publishes the running work timer to the island
// ====================================================================
//
// On desktop web the old floating timer pill is switched off (see
// TimerIsland's `floating` prop); this bridge is what makes the timer show up
// instead — as an activity in the topbar dynamic island. Renders nothing
// itself; it just mirrors TimerContext into IslandContext while a session is
// active and clears it when the session ends (or this unmounts).
// ====================================================================

import { useIslandActivity, type IslandActivity } from '@/contexts/IslandContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { useTicker } from '@/hooks/useTicker';
import { useRouter } from 'expo-router';
import React from 'react';

function formatHMS(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function IslandTimerBridge() {
  const { isActive, activeSession, stopWork, serverTimeOffset } = useTimer();
  const { successToast, errorToast } = useToast();
  const router = useRouter();
  const elapsedSeconds = useTicker(isActive ? activeSession?.started_at ?? null : null, { offsetMs: serverTimeOffset });

  const activity = React.useMemo<IslandActivity | null>(() => {
    if (!isActive) return null;
    const committing = activeSession?.id === 'pending';
    const taskTitle = activeSession?.task?.title || 'Active session';
    const taskId = activeSession?.task_id;
    return {
      id: 'timer',
      kind: 'timer',
      icon: 'clock-o',
      accent: 'primary',
      compactLabel: formatHMS(elapsedSeconds),
      pulse: true,
      progress: null,
      title: taskTitle,
      subtitle: committing ? 'Committing…' : `Working · ${formatHMS(elapsedSeconds)}`,
      onPress: taskId ? () => router.push(`/task/${taskId}` as any) : undefined,
      actions: [
        {
          key: 'stop',
          icon: 'stop',
          label: 'Stop timer',
          tone: 'danger',
          onPress: async () => {
            try {
              await stopWork();
              successToast('Work session stopped.');
            } catch (err: any) {
              errorToast(err?.message || 'Could not stop work session.');
            }
          },
        },
      ],
    };
  }, [isActive, activeSession, elapsedSeconds, router, stopWork, successToast, errorToast]);

  useIslandActivity(activity);
  return null;
}
