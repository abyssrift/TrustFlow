// The dashboard's whole numeric summary, in one line (#191, Phase 10).
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

import { useThemeColors } from '@/hooks/useThemeColors';
import React from 'react';
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
};

export default function DashboardFacts({ facts }: { facts: Fact[] }) {
  const shown = facts.filter((f) => f.value != null);
  if (shown.length === 0) return null;

  return (
    <View className="flex-row items-center flex-wrap gap-x-1 gap-y-1">
      {shown.map((f, i) => (
        <View key={f.label} className="flex-row items-center">
          {i > 0 && <Text className="text-typography-dim text-xs mr-1">·</Text>}
          <FactItem fact={f} />
        </View>
      ))}
    </View>
  );
}

function FactItem({ fact }: { fact: Fact }) {
  const c = useThemeColors();

  const body = (
    <View className="flex-row items-baseline gap-1.5 px-1.5">
      {fact.live && (
        <View
          className="rounded-full self-center"
          style={{ width: 6, height: 6, backgroundColor: c.success }}
        />
      )}
      <Text className="text-base font-bold" style={{ color: fact.tone ?? c.textMain }}>
        {fact.value}
      </Text>
      <Text className="text-typography-muted text-xs">{fact.label}</Text>
    </View>
  );

  if (!fact.onPress) {
    // Non-interactive facts still sit on the same 44px baseline as the tappable
    // ones, or the row's items land on different centre lines.
    return <View style={{ minHeight: 44, justifyContent: 'center' }}>{body}</View>;
  }

  return (
    <TouchableOpacity
      onPress={fact.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${fact.value} ${fact.label}`}
      className="rounded-xl hover:bg-surface-overlay/60 transition-colors justify-center"
      style={{ minHeight: 44 }}
    >
      {body}
    </TouchableOpacity>
  );
}
