import { useElapsedTime } from '@/hooks/useElapsedTime';
import { useTicker } from '@/hooks/useTicker';
import { IDLE_MS, idleLabel, idleMsOf } from '@/lib/sessionPresence';
import React, { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import type { ActiveSessionUser } from './TaskCardActions';

// The "who's working now" affordance on a task card. At rest it's just an
// overlapping profile-picture stack with one status dot — green pulse when the
// worker is active, amber when idle. On hover (web) it fans out and reveals a
// popover: name, session start / idle time, and a live-ticking duration.
// On native the stack still renders; hover is a no-op.

// Ring matches the card/popover background so overlapping avatars read as a
// clean stack rather than a smudge.
function Avatar({ user, size = 28 }: { user: ActiveSessionUser; size?: number }) {
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

// Presence dot: green pulse = actively working, amber = idle/away.
// Memoized so the parent's 1s tick (see useTicker below) doesn't re-mount the
// CSS `pulse-animation` on every render — that was spamming Reanimated's
// "reading value during render" warning and re-doing animation setup work
// every second while a session was active.
const StatusDot = React.memo(function StatusDot({ idle }: { idle: boolean }) {
  return (
    <View
      className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-card ${
        idle ? 'bg-state-warning' : 'bg-state-success pulse-animation'
      }`}
    />
  );
});

const formatStart = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function SessionRow({ s }: { s: ActiveSessionUser }) {
  const elapsed = useElapsedTime(s.startedAt);
  const idleMs = idleMsOf(s.lastHeartbeatAt);
  const idle = idleMs > IDLE_MS;
  return (
    <View className="flex-row items-center gap-2.5 px-2 py-1.5">
      <View className="relative">
        <Avatar user={s} size={34} />
        <StatusDot idle={idle} />
      </View>
      <View className="flex-1 min-w-0">
        <Text className="text-typography-main font-bold text-[13px]" numberOfLines={1}>{s.name}</Text>
        <Text className={`text-[10px] font-medium ${idle ? 'text-state-warning' : 'text-typography-dim'}`}>
          {idle ? idleLabel(idleMs) : `since ${formatStart(s.startedAt)}`}
        </Text>
      </View>
      <Text
        className={`font-mono text-[13px] ${idle ? 'text-typography-dim' : 'text-state-success'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {elapsed}
      </Text>
    </View>
  );
}

export default function ActiveSessionAvatars({
  sessions,
  className = 'self-start mb-4',
  align = 'left',
}: {
  sessions: ActiveSessionUser[];
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  const [hovered, setHovered] = useState(false);
  // Re-render each second so idle state flips as heartbeats go stale.
  useTicker(sessions?.[0]?.startedAt ?? null);
  if (!sessions?.length) return null;

  const shown = sessions.slice(0, 5);
  const extra = sessions.length - shown.length;
  // Stack dot summarizes the group: amber only when nobody is actively working.
  const allIdle = sessions.every(s => idleMsOf(s.lastHeartbeatAt) > IDLE_MS);

  return (
    <View
      className={`relative ${className}`}
      // Lift the whole subtree over later-painted siblings while the popover is open.
      style={{ zIndex: hovered ? 9999 : undefined }}
      // @ts-ignore web-only hover handlers (react-native-web forwards these to the DOM node)
      onMouseEnter={() => setHovered(true)}
      // @ts-ignore
      onMouseLeave={() => setHovered(false)}
    >
      {/* Overlapping stack — the hover trigger. Avatars fan out gently on hover. */}
      <View className="flex-row items-center py-0.5">
        {shown.map((s, i) => (
          <View
            key={s.userId}
            className="relative transition-all duration-200 ease-out"
            style={{
              marginLeft: i === 0 ? 0 : -12,
              zIndex: shown.length - i,
              transform: [{ translateX: hovered ? i * 6 : 0 }],
            }}
          >
            <Avatar user={s} />
            {i === 0 && <StatusDot idle={allIdle} />}
          </View>
        ))}
        {extra > 0 && (
          <View
            className="w-7 h-7 rounded-full bg-surface-overlay border-2 border-surface-card items-center justify-center transition-all duration-200 ease-out"
            style={{ marginLeft: -12, transform: [{ translateX: hovered ? shown.length * 6 : 0 }] }}
          >
            <Text className="text-typography-muted text-[9px] font-black">+{extra}</Text>
          </View>
        )}
      </View>

      {/* Hover popover — opacity + lift + subtle scale, eased for a soft entrance. */}
      <View
        pointerEvents={hovered ? 'auto' : 'none'}
        className={`absolute ${align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : ''} top-full mt-2 w-60 bg-surface-card rounded-2xl border border-surface-border p-1.5 premium-shadow z-50 transition-all duration-200 ease-out ${hovered ? 'opacity-100' : 'opacity-0'}`}
        // center: anchor the fixed-width popover under the stack (w-60 = 240px → shift half its width)
        style={[
          align === 'center' && { left: '50%' as const, marginLeft: -120 },
          { transform: [{ translateY: hovered ? 0 : -6 }, { scale: hovered ? 1 : 0.97 }] },
        ]}
      >
        {/* Cap the list so a busy company (dashboard usage) can't grow the popover past the viewport. */}
        <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
          {sessions.map((s) => <SessionRow key={s.userId} s={s} />)}
        </ScrollView>
      </View>
    </View>
  );
}
