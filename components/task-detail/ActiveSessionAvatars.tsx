import { useElapsedTime } from '@/hooks/useElapsedTime';
import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { ActiveSessionUser } from './TaskCardActions';

// Replaces the old "NAME IS ACTIVE" banner with a profile-picture stack that
// reveals live session detail (name, start time, running duration) on hover.
// Hover is web-only; on native the avatars + status label still render, just
// without the popover (mouse events are no-ops there).

function Avatar({ user, size = 28, ring = true }: { user: ActiveSessionUser; size?: number; ring?: boolean }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className={`overflow-hidden bg-brand-primary/20 items-center justify-center ${ring ? 'border-2 border-state-success' : ''}`}
    >
      {user.avatar ? (
        <Image source={{ uri: user.avatar }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Text className="text-brand-primary font-black" style={{ fontSize: Math.round(size * 0.4) }}>
          {user.name.charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const formatStart = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function SessionRow({ s }: { s: ActiveSessionUser }) {
  const elapsed = useElapsedTime(s.startedAt);
  return (
    <View className="flex-row items-center gap-3 py-2 border-t border-surface-border/10 first:border-t-0">
      <Avatar user={s} size={36} />
      <View className="flex-1 min-w-0">
        <Text className="text-typography-main font-black text-xs" numberOfLines={1}>{s.name}</Text>
        <Text className="text-typography-dim text-[10px] font-bold">Started {formatStart(s.startedAt)}</Text>
      </View>
      <View className="items-end">
        <Text className="text-state-success font-mono font-black text-sm">{elapsed}</Text>
        <View className="flex-row items-center gap-1 mt-0.5">
          <View className="w-1.5 h-1.5 rounded-full bg-state-success pulse-animation" />
          <Text className="text-state-success text-[8px] font-black uppercase tracking-wider">Working</Text>
        </View>
      </View>
    </View>
  );
}

export default function ActiveSessionAvatars({ sessions }: { sessions: ActiveSessionUser[] }) {
  const [hovered, setHovered] = useState(false);
  if (!sessions?.length) return null;

  const shown = sessions.slice(0, 3);
  const extra = sessions.length - shown.length;

  return (
    <View
      className="relative self-start mb-4"
      // @ts-ignore web-only hover handlers (react-native-web passes these to the DOM node)
      onMouseEnter={() => setHovered(true)}
      // @ts-ignore
      onMouseLeave={() => setHovered(false)}
    >
      {/* Overlapping avatar stack — the hover trigger. No label; identity/detail
          lives in the popover below. */}
      <View className="flex-row items-center">
        {shown.map((s, i) => (
          <View key={s.userId} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: shown.length - i }}>
            <Avatar user={s} />
          </View>
        ))}
        {extra > 0 && (
          <View
            className="w-7 h-7 rounded-full bg-surface-overlay border-2 border-surface-card items-center justify-center"
            style={{ marginLeft: -10 }}
          >
            <Text className="text-typography-muted text-[9px] font-black">+{extra}</Text>
          </View>
        )}
      </View>

      {/* Hover popover — animates in via the shared `transition-all` CSS on web */}
      <View
        pointerEvents={hovered ? 'auto' : 'none'}
        className={`absolute left-0 top-full mt-2 w-64 bg-surface-card rounded-2xl border border-surface-border p-3 premium-shadow z-50 transition-all duration-200 ${hovered ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: [{ translateY: hovered ? 0 : -6 }] }}
      >
        <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest mb-1">
          Active Session{sessions.length > 1 ? 's' : ''}
        </Text>
        {sessions.map((s) => <SessionRow key={s.userId} s={s} />)}
      </View>
    </View>
  );
}
