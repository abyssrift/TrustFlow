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
// a `·` separator on one running line. The one-line form was written for the
// full-width strip that used to sit under the greeting; inside a widget cell it
// read as a sentence, not as numbers. The CONTRACT is unchanged: same `Fact[]`,
// same "a fact with nothing to say is not rendered at all" rule, same null
// return when every value is suppressed.

import StatTile from '@/components/dashboard/StatTile';
import React from 'react';
import { View } from 'react-native';

export type Fact = {
  /** Suppressed when null — see the file header. */
  value: string | null;
  label: string;
  onPress?: () => void;
  /** Runtime colour for the value, e.g. danger for a failing count. */
  tone?: string;
  /** Renders a live dot before the value. */
  live?: boolean;
};

export default function DashboardFacts({ facts }: { facts: Fact[] }) {
  const shown = facts.filter((f) => f.value != null);
  if (shown.length === 0) return null;

  return (
    // Same flexWrap + flexBasis idiom as WidgetGrid itself, for the same reason:
    // column count is arithmetic the layout engine does off the container's real
    // width, so the row is 4 tiles wide in a 480px `m` cell and one line of 8 at
    // full width with no breakpoint table anywhere. `flexShrink: 0` and
    // `maxWidth: '100%'` are load-bearing here exactly as they are there.
    <View className="flex-row flex-wrap" style={{ gap: 12 }}>
      {shown.map((f) => (
        <View key={f.label} style={{ flexGrow: 1, flexShrink: 0, flexBasis: 96, maxWidth: '100%' }}>
          <StatTile
            label={f.label}
            value={f.value!}
            tone={f.tone}
            live={f.live}
            onPress={f.onPress}
          />
        </View>
      ))}
    </View>
  );
}
