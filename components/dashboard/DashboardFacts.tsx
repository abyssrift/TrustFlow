// The dashboard's whole numeric summary, in one wrapping row (#191, Phase 10).
//
// It replaces a three-stat "pulse" band plus four 240px KPI cards — roughly
// 600px of vertical chrome that, on a young workspace, carried five zeros and
// two real numbers. A zero is not information; it is the absence of it. So the
// rule here is the user's own: a fact with nothing to say is not rendered dim,
// not rendered as "0", not rendered at all. Callers pass `null` for a fact they
// have suppressed, and this drops it.
//
// Consequence worth stating plainly: this row is a different length on
// different days, and on a brand-new workspace it can be empty — in which case
// the whole line disappears and the header is just the greeting. That is the
// design, not a missing loading state.
//
// PATH A (unified responsive): a wrapping row of facts at every width. On a
// 390px viewport it wraps to two or three lines; nothing is hidden, because
// each fact is already the shortest form of itself.
//
// FORM CHANGE (#213 follow-up): each fact is now a StatTile — a dim uppercase
// label over a large tabular value — instead of a 16px number, a 12px word and
// a `·` separator on one running line. The CONTRACT is unchanged: same
// `Fact[]`, same "a fact with nothing to say is not rendered at all" rule,
// same null return when every value is suppressed.
//
// EXPANDED FORM (stretch-aware): WidgetGrid's `alignItems: 'stretch'` can hand
// this card far more height than one row of tiles needs — typically because it
// shares a row with `blocked-exceptions`, whose own content height is
// deliberately NOT capped to its tier (see MAX_SHOWN's comment in
// BlockedExceptionsPanel.tsx). Two earlier attempts still left dead space: a
// centered thin row, then a `flex-wrap` grid of cards sized to their own
// content (which centers as a block and leaves an orphaned full-width card on
// an odd last row). The fix is an explicit N-per-row grid built from real rows
// (not `flex-wrap`'s single flow), where EVERY row gets `flex: 1` and EVERY
// cell in it gets `flex: 1` too — that is what makes the grid claim the WHOLE
// box, top to bottom, edge to edge, the way a CSS `grid-template-rows: 1fr 1fr`
// would (this app's RN-web build cannot use `grid-cols-*` directly, per
// ui-consistency.md, so the rows are built by hand instead of left to
// flex-wrap, which cannot stretch a wrapped line to fill leftover cross-axis
// space reliably on this project's Yoga — see WidgetGrid.tsx's own note on
// multi-line stretch being unverified there). Colour comes from
// `lib/categoricalPalette`, the app's one validated categorical set (also used
// by TimeByCategoryPie's donut) — and per that palette's own rule, colour is
// never the only carrier of identity: every card still leads with its icon and
// its label text.

import { ProgressMeter } from '@/components/entities/EntityUI';
import StatTile from '@/components/dashboard/StatTile';
import { useThemeColors } from '@/hooks/useThemeColors';
import { categoricalPalette } from '@/lib/categoricalPalette';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

export type Fact = {
  /** Suppressed when null — see the file header. */
  value: string | null;
  label: string;
  onPress?: () => void;
  /** Runtime colour for the value, e.g. danger for a failing count. */
  tone?: string;
  /** Renders a live dot before the value. */
  live?: boolean;
  /** A completion bar under the value — only for a fact that IS a percentage. */
  meter?: { percent: number; tone?: string };
  /** FontAwesome glyph for the expanded card form. Compact form ignores it. */
  icon?: string;
};

/** Slack (granted height minus content height) worth switching layouts for. */
const EXPAND_SLACK = 72;
/** Fixed 2-up, matching the reference this form is built from. Add a width
 *  break here if a widget ever needs 3+ across — not needed by any size today. */
const EXPANDED_COLS = 2;

/** Always fills its row cell (`flex: 1`) — only ever used inside the expanded grid. */
function FactCard({ fact, color }: { fact: Fact; color: string }) {
  const c = useThemeColors();
  const valueColor = fact.tone ?? c.textMain;

  const content = (
    <View
      className="rounded-2xl p-4 items-center justify-center"
      style={{ backgroundColor: color + '17', flex: 1 }}
    >
      <View className="rounded-xl items-center justify-center" style={{ width: 36, height: 36, backgroundColor: color + '2A' }}>
        <FontAwesome name={(fact.icon ?? 'circle') as never} size={16} color={color} />
      </View>
      <View className="flex-row items-center gap-1.5 mt-3">
        {fact.live && (
          <View className="rounded-full" style={{ width: 6, height: 6, backgroundColor: c.success }} />
        )}
        <Text
          className="text-3xl font-black tracking-tight"
          numberOfLines={1}
          style={{ color: valueColor, fontVariant: ['tabular-nums'] }}
        >
          {fact.value}
        </Text>
      </View>
      <Text className="text-[11px] font-bold uppercase tracking-wide mt-1" numberOfLines={1} style={{ color }}>
        {fact.label}
      </Text>
      {!!fact.meter && (
        <View style={{ marginTop: 10, width: '70%' }}>
          <ProgressMeter percent={fact.meter.percent} tone={fact.meter.tone ?? color} showCaption={false} height={4} />
        </View>
      )}
    </View>
  );

  if (!fact.onPress) return content;

  return (
    <TouchableOpacity
      onPress={fact.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${fact.value} ${fact.label}`}
      className="hover:scale-[1.03] active:scale-[0.98] transition-transform"
      style={{ flex: 1 }}
    >
      {content}
    </TouchableOpacity>
  );
}

export default function DashboardFacts({ facts }: { facts: Fact[] }) {
  const c = useThemeColors();
  const shown = facts.filter((f) => f.value != null);
  const [boxH, setBoxH] = useState(0);
  const [rowH, setRowH] = useState(0);
  if (shown.length === 0) return null;

  const expanded = boxH > 0 && rowH > 0 && boxH - rowH > EXPAND_SLACK;
  const palette = categoricalPalette(c.card);

  // Real rows, not `flex-wrap` — see the EXPANDED FORM note above for why.
  const rows: Fact[][] = [];
  for (let i = 0; i < shown.length; i += EXPANDED_COLS) rows.push(shown.slice(i, i + EXPANDED_COLS));

  return (
    // flexGrow + centered justify: WidgetShell's body is `flexGrow: 1`, so the
    // outer box's measured height is however tall the grid stretched this cell
    // — compared below against the tile row's own height to decide which form
    // to render. Centering only matters for the compact form below; the
    // expanded grid's own `flex: 1` claims all of this space regardless.
    <View
      style={{ flexGrow: 1, justifyContent: 'center' }}
      onLayout={e => {
        const h = Math.round(e.nativeEvent.layout.height);
        setBoxH(prev => (Math.abs(prev - h) > 1 ? h : prev));
      }}
    >
      {expanded ? (
        <View style={{ flex: 1, gap: 12 }}>
          {rows.map((row, ri) => (
            <View key={ri} className="flex-row" style={{ flex: 1, gap: 12 }}>
              {row.map((f, ci) => {
                const i = ri * EXPANDED_COLS + ci;
                return <FactCard key={f.label} fact={f} color={f.tone ?? palette[i % palette.length]} />;
              })}
            </View>
          ))}
        </View>
      ) : (
        // Same flexWrap + flexBasis idiom as WidgetGrid itself, for the same
        // reason: column count is arithmetic the layout engine does off the
        // container's real width, so the row is 4 tiles wide in a 480px `m`
        // cell and one line of 8 at full width with no breakpoint table
        // anywhere. `flexShrink: 0` and `maxWidth: '100%'` are load-bearing
        // here exactly as they are there.
        <View
          className="flex-row flex-wrap"
          style={{ gap: 12 }}
          onLayout={e => {
            const h = Math.round(e.nativeEvent.layout.height);
            setRowH(prev => (Math.abs(prev - h) > 1 ? h : prev));
          }}
        >
          {shown.map((f) => (
            <View key={f.label} style={{ flexGrow: 1, flexShrink: 0, flexBasis: 96, maxWidth: '100%' }}>
              <StatTile
                label={f.label}
                value={f.value!}
                tone={f.tone}
                live={f.live}
                onPress={f.onPress}
                meter={f.meter}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
