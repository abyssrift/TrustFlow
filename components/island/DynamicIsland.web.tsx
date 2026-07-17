// ====================================================================
// DynamicIsland (web) — the floating topbar island
// ====================================================================
//
// This is the pill that straddles the top bar's bottom edge (rendered by
// RetractableTopBar via TopBarPullTab). It fuses two jobs:
//
//   1. A permanent LEADING control — the chevron that shows/hides the top bar.
//      Always present, even when nothing else is going on.
//   2. A multiplexer for transient activities published to IslandContext — a
//      running work timer, a background upload, a report being generated.
//
// Collapsed, it shows the chevron plus the single most-recently-touched
// activity (icon + label + progress ring). Hovering morphs a panel open BELOW
// the pill listing every live activity with its actions and any decisions it
// needs answered. With no activities it's just the chevron, and hover only
// reveals its Show/Hide label — today's idle behaviour, unchanged.
//
// Web-only + raw DOM: reliable :hover, CSS transitions for the macOS-island
// morph, an inline <svg> ring, and theme colours as inline styles (never a
// className on a detached node, which is how RNW portals fall back to black).
// ====================================================================

import { useIsland, type IslandAccent, type IslandActivity, type IslandTone } from '@/contexts/IslandContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';

type Colors = ReturnType<typeof useThemeColors>;

const accentColor = (c: Colors, a: IslandAccent) =>
  a === 'success' ? c.success : a === 'warning' ? c.warning : a === 'danger' ? c.danger : c.primary;

const toneColor = (c: Colors, t: IslandTone | undefined) =>
  t === 'neutral' || !t ? c.textMuted : accentColor(c, t);

export type IslandLeading = {
  icon: string; // FontAwesome name (the chevron)
  label: string; // hover label when idle ("Show" / "Hide")
  onPress: () => void;
  accessibilityLabel?: string;
};

export default function DynamicIsland({ leading }: { leading: IslandLeading }) {
  const { activities } = useIsland();
  const colors = useThemeColors();
  const [expanded, setExpanded] = React.useState(false);
  const [hoverLead, setHoverLead] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasActivities = activities.length > 0;

  const open = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setExpanded(true); };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setExpanded(false), 160);
  };
  React.useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  React.useEffect(() => { if (!hasActivities) setExpanded(false); }, [hasActivities]);

  const lead = activities[0];
  const leadAccent = lead ? accentColor(colors, lead.accent) : colors.textDim;
  const pendingDecisions = activities.reduce((n, a) => n + (a.decisions?.length ?? 0), 0);
  const extraCount = activities.length - 1;
  const panelOpen = expanded && hasActivities;

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}
      onMouseEnter={() => { setHoverLead(true); open(); }}
      onMouseLeave={() => { setHoverLead(false); scheduleClose(); }}
    >
      {/* Collapsed pill — always visible; the chevron toggle lives here so it's
          reachable whether or not anything's active. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          height: hasActivities ? 26 : 22,
          padding: hasActivities ? '0 8px 0 4px' : '0 4px',
          borderRadius: 999,
          background: colors.card,
          border: `1px solid ${hasActivities ? `${leadAccent}55` : colors.border}`,
          boxShadow: '0 6px 22px rgba(0,0,0,0.30)',
          maxWidth: 360,
          transition: 'height 200ms ease, border-color 200ms ease, background 200ms ease',
          opacity: panelOpen ? 0.001 : 1, // hand off to the panel while open
          pointerEvents: panelOpen ? 'none' : 'auto',
        }}
      >
        {/* Chevron — toggles the top bar. */}
        <button
          type="button"
          onClick={leading.onPress}
          aria-label={leading.accessibilityLabel ?? leading.label}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, borderRadius: 999, border: 'none',
            background: 'transparent', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <FontAwesome name={leading.icon as any} size={hasActivities ? 9 : 10} color={colors.textDim} />
        </button>

        {hasActivities ? (
          <>
            <LeadGlyph activity={lead} accent={leadAccent} colors={colors} />
            <span style={{ color: colors.textMain, fontSize: 11.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {lead.compactLabel}
            </span>
            {pendingDecisions > 0 && (
              <span style={{ display: 'inline-flex', width: 7, height: 7, borderRadius: 999, background: colors.warning }} />
            )}
            {extraCount > 0 && (
              <span style={{ color: colors.textDim, fontSize: 10, fontWeight: 800, paddingRight: 2 }}>+{extraCount}</span>
            )}
          </>
        ) : (
          // Idle: hover reveals the Show/Hide label, exactly like before.
          <div
            style={{
              overflow: 'hidden',
              maxWidth: hoverLead ? 48 : 0,
              opacity: hoverLead ? 1 : 0,
              transition: 'max-width 260ms ease, opacity 260ms ease',
            }}
          >
            <span style={{ color: colors.textMuted, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{leading.label}</span>
          </div>
        )}
      </div>

      {/* Expanded panel — morphs down from the pill. */}
      <div
        style={{
          position: 'absolute', top: 0, left: '50%',
          transform: `translateX(-50%) translateY(${panelOpen ? 0 : -8}px) scale(${panelOpen ? 1 : 0.94})`,
          transformOrigin: 'top center',
          width: 340,
          background: colors.card,
          border: `1px solid ${colors.border}`,
          borderRadius: 20,
          boxShadow: '0 20px 54px rgba(0,0,0,0.48)',
          opacity: panelOpen ? 1 : 0,
          pointerEvents: panelOpen ? 'auto' : 'none',
          transition: 'opacity 180ms ease, transform 240ms cubic-bezier(0.22,1,0.36,1)',
          zIndex: 120,
          overflow: 'hidden',
        }}
      >
        {/* Panel header keeps the chevron reachable while expanded. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${colors.border}55` }}>
          <button
            type="button"
            onClick={leading.onPress}
            aria-label={leading.accessibilityLabel ?? leading.label}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: 8, border: `1px solid ${colors.border}`,
              background: 'transparent', cursor: 'pointer',
            }}
          >
            <FontAwesome name={leading.icon as any} size={10} color={colors.textDim} />
          </button>
          <span style={{ color: colors.textMuted, fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {activities.length === 1 ? '1 active' : `${activities.length} active`}
          </span>
        </div>
        {activities.map((a, i) => (
          <ActivityRow key={a.id} activity={a} colors={colors} last={i === activities.length - 1} />
        ))}
      </div>
    </div>
  );
}

function LeadGlyph({ activity, accent, colors }: { activity: IslandActivity; accent: string; colors: Colors }) {
  const hasProgress = typeof activity.progress === 'number';
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16 }}>
      {hasProgress && <Ring size={16} stroke={2} progress={activity.progress as number} color={accent} track={colors.border} />}
      {activity.pulse && !hasProgress && (
        <span style={{ position: 'absolute', width: 8, height: 8, borderRadius: 999, background: accent }} className="pulse-animation" />
      )}
      {(!activity.pulse || hasProgress) && (
        <FontAwesome name={activity.icon as any} size={9} color={accent} />
      )}
    </span>
  );
}

function ActivityRow({ activity, colors, last }: { activity: IslandActivity; colors: Colors; last: boolean }) {
  const accent = accentColor(colors, activity.accent);
  const hasProgress = typeof activity.progress === 'number';
  return (
    <div style={{ padding: '10px 12px', borderBottom: last ? 'none' : `1px solid ${colors.border}44` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: 10,
          background: `${accent}1A`, border: `1px solid ${accent}33`, flexShrink: 0,
        }}>
          <FontAwesome name={activity.icon as any} size={13} color={accent} />
        </span>
        <button
          type="button"
          onClick={activity.onPress}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', cursor: activity.onPress ? 'pointer' : 'default', padding: 0 }}
        >
          <div style={{ color: colors.textMain, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activity.title}
          </div>
          {activity.subtitle && (
            <div style={{ color: colors.textMuted, fontSize: 10.5, fontWeight: 600, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
              {activity.subtitle}
            </div>
          )}
        </button>
        {typeof activity.progress === 'number' && (
          <span style={{ color: accent, fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(activity.progress)}%
          </span>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          {(activity.actions ?? []).map(act => (
            <button
              key={act.key}
              type="button"
              title={act.label}
              onClick={act.onPress}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 8,
                background: `${toneColor(colors, act.tone)}1A`,
                border: `1px solid ${toneColor(colors, act.tone)}33`,
                cursor: 'pointer',
              }}
            >
              <FontAwesome name={act.icon as any} size={11} color={toneColor(colors, act.tone)} />
            </button>
          ))}
        </div>
      </div>

      {hasProgress && (
        <div style={{ height: 4, borderRadius: 999, background: `${colors.border}80`, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, activity.progress as number))}%`, background: accent, borderRadius: 999, transition: 'width 240ms ease' }} />
        </div>
      )}

      {(activity.decisions ?? []).map(d => (
        <div key={d.id} style={{ marginTop: 10, padding: 10, borderRadius: 12, background: `${colors.warning}12`, border: `1px solid ${colors.warning}33` }}>
          <div style={{ color: colors.textMain, fontSize: 11.5, fontWeight: 800 }}>{d.title}</div>
          <div style={{ color: colors.textMuted, fontSize: 10.5, marginTop: 2, marginBottom: 8 }}>{d.message}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {d.options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => d.resolve(opt.value)}
                style={{
                  padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 10.5, fontWeight: 800,
                  color: toneColor(colors, opt.tone),
                  background: `${toneColor(colors, opt.tone)}14`,
                  border: `1px solid ${toneColor(colors, opt.tone)}40`,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Inline SVG progress ring (web DOM). progress 0..100.
function Ring({ size, stroke, progress, color, track }: { size: number; stroke: number; progress: number; color: string; track: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, progress));
  return (
    <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 240ms ease' }}
      />
    </svg>
  );
}
