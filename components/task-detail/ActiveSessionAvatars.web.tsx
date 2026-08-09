import { useElapsedTime } from '@/hooks/useElapsedTime';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useTicker } from '@/hooks/useTicker';
import { IDLE_MS, idleLabel, idleMsOf } from '@/lib/sessionPresence';
import { positionTooltip } from '@/lib/tooltipPosition';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Text, View } from 'react-native';
import { Avatar, formatSessionStart, groupSessions, StatusDot, WorkingPulse } from './activeSessionAvatarsCore';
import type { ActiveSessionUser } from './TaskCardActions';

// The "who's working now" affordance on a task card. At rest it's an
// overlapping avatar stack; on hover it fans out and portals a popover to
// document.body with position:fixed. Portaling (not just a high z-index)
// is what actually escapes an ancestor card's stacking context / overflow —
// a plain absolute+z-index popover was getting painted under later sibling
// cards (e.g. the Recent Activity panel) regardless of how high the z-index
// went. lib/tooltipPosition flips above when there's no room below and
// clamps horizontally, so it stays on-screen on narrow/mobile-web widths too.
//
// Theme tokens don't reach portaled DOM (same trap as RN Modal on web), so
// the popover row below is styled inline from useThemeColors instead of
// NativeWind classes.
function SessionRow({ s, colors }: { s: ActiveSessionUser; colors: ReturnType<typeof useThemeColors> }) {
  const elapsed = useElapsedTime(s.startedAt);
  const idleMs = idleMsOf(s.lastHeartbeatAt);
  const idle = idleMs > IDLE_MS;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px' }}>
      <div style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            overflow: 'hidden',
            background: colors.border,
            border: `2px solid ${colors.card}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {s.avatar ? (
            <img src={s.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ color: colors.primary, fontWeight: 900, fontSize: 14 }}>
              {s.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 10,
            height: 10,
            borderRadius: 5,
            border: `2px solid ${colors.card}`,
            background: idle ? colors.warning : colors.success,
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: colors.textMain,
            fontWeight: 700,
            fontSize: 13,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {s.name}
        </div>
        <div style={{ color: idle ? colors.warning : colors.textDim, fontSize: 10, fontWeight: 600 }}>
          {idle ? idleLabel(idleMs) : `since ${formatSessionStart(s.startedAt)}`}
        </div>
      </div>
      <div
        style={{
          color: idle ? colors.textDim : colors.success,
          fontFamily: 'monospace',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {elapsed}
      </div>
    </div>
  );
}

export default function ActiveSessionAvatars({
  sessions,
  className = 'self-start mb-4',
}: {
  sessions: ActiveSessionUser[];
  className?: string;
}) {
  const colors = useThemeColors();
  const anchorRef = useRef<View>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Re-render each second so idle state flips as heartbeats go stale.
  useTicker(sessions?.[0]?.startedAt ?? null);

  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  // Two-pass: render the popover hidden, measure it and the anchor, place it.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = (anchorRef.current as any)?.getBoundingClientRect?.();
    const pop = popRef.current;
    if (!rect || !pop) return;
    setPos(
      positionTooltip(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        { width: pop.offsetWidth, height: pop.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        'bottom',
      ),
    );
  }, [open, sessions.length]);

  // Anything that moves the anchor just hides the popover; next hover re-measures.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);

  if (!sessions?.length) return null;

  const { shown, extra, allIdle } = groupSessions(sessions);

  return (
    <View
      ref={anchorRef}
      className={`relative ${className}`}
      // @ts-ignore web-only hover handlers (react-native-web forwards these to the DOM node)
      onMouseEnter={show}
      // @ts-ignore
      onMouseLeave={hide}
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
              transform: [{ translateX: open ? i * 6 : 0 }],
            }}
          >
            <Avatar user={s} />
            {i === 0 && <StatusDot idle={allIdle} />}
          </View>
        ))}
        {extra > 0 && (
          <View
            className="w-7 h-7 rounded-full bg-surface-overlay border-2 border-surface-card items-center justify-center transition-all duration-200 ease-out"
            style={{ marginLeft: -12, transform: [{ translateX: open ? shown.length * 6 : 0 }] }}
          >
            <Text className="text-typography-muted text-[9px] font-black">+{extra}</Text>
          </View>
        )}
        {sessions.length <= 3 && (
          <WorkingPulse count={sessions.length as 1 | 2 | 3} color={allIdle ? colors.warning : colors.success} />
        )}
      </View>

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: 'fixed',
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? 'visible' : 'hidden',
              width: 240,
              background: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: 16,
              padding: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              zIndex: 9999,
              maxHeight: 300,
              overflowY: 'auto',
            }}
          >
            {/* Capped so a busy company (dashboard usage) can't grow the popover past the viewport — it scrolls internally instead. */}
            {sessions.map(s => (
              <SessionRow key={s.userId} s={s} colors={colors} />
            ))}
          </div>,
          document.body,
        )}
    </View>
  );
}
