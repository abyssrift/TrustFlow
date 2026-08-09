import { useThemeColors } from '@/hooks/useThemeColors';
import { useTicker } from '@/hooks/useTicker';
import React from 'react';
import { Text, View } from 'react-native';
import { Avatar, groupSessions, StatusDot, WorkingPulse } from './activeSessionAvatarsCore';
import type { ActiveSessionUser } from './TaskCardActions';

// Native: just the overlapping avatar stack — no hover on touch devices, so
// there's no popover to show. Web gets the interactive version with a
// portaled popover; see ActiveSessionAvatars.web.tsx.
export default function ActiveSessionAvatars({
  sessions,
  className = 'self-start mb-4',
}: {
  sessions: ActiveSessionUser[];
  className?: string;
}) {
  // Re-render each second so idle state flips as heartbeats go stale.
  useTicker(sessions?.[0]?.startedAt ?? null);
  const colors = useThemeColors();
  if (!sessions?.length) return null;

  const { shown, extra, allIdle } = groupSessions(sessions);

  return (
    <View className={`relative ${className}`}>
      <View className="flex-row items-center py-0.5">
        {shown.map((s, i) => (
          <View
            key={s.userId}
            className="relative"
            style={{ marginLeft: i === 0 ? 0 : -12, zIndex: shown.length - i }}
          >
            <Avatar user={s} />
            {i === 0 && <StatusDot idle={allIdle} />}
          </View>
        ))}
        {extra > 0 && (
          <View
            className="w-7 h-7 rounded-full bg-surface-overlay border-2 border-surface-card items-center justify-center"
            style={{ marginLeft: -12 }}
          >
            <Text className="text-typography-muted text-[9px] font-black">+{extra}</Text>
          </View>
        )}
        {sessions.length <= 3 && (
          <WorkingPulse count={sessions.length as 1 | 2 | 3} color={allIdle ? colors.warning : colors.success} />
        )}
      </View>
    </View>
  );
}
