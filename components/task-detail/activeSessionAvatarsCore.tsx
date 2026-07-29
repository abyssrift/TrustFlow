import { IDLE_MS, idleMsOf } from '@/lib/sessionPresence';
import React from 'react';
import { Image, Text, View } from 'react-native';
import type { ActiveSessionUser } from './TaskCardActions';

// Shared, non-portaled pieces of the "who's working now" avatar stack — the
// part of ActiveSessionAvatars that stays inside the normal page tree on both
// platforms, so NativeWind theme-token classes render correctly here (unlike
// the hover popover on web, which portals out to document.body and loses
// them — see ActiveSessionAvatars.web.tsx).

export function Avatar({ user, size = 28 }: { user: ActiveSessionUser; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="overflow-hidden bg-surface-overlay items-center justify-center border-2 border-surface-card"
    >
      {user.avatar ? (
        <Image source={{ uri: user.avatar }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Text className="text-brand-primary font-black" style={{ fontSize: Math.round(size * 0.42) }}>
          {user.name.charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

export const StatusDot = React.memo(function StatusDot({ idle }: { idle: boolean }) {
  return (
    <View
      className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-card ${
        idle ? 'bg-state-warning' : 'bg-state-success pulse-animation'
      }`}
    />
  );
});

export function groupSessions(sessions: ActiveSessionUser[]) {
  const shown = sessions.slice(0, 5);
  const extra = sessions.length - shown.length;
  const allIdle = sessions.every(s => idleMsOf(s.lastHeartbeatAt) > IDLE_MS);
  return { shown, extra, allIdle };
}

export const formatSessionStart = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
