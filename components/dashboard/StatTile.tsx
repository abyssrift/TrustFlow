// One stat, drawn the same way everywhere on the dashboard (#213 follow-up).
//
// WHY THIS EXISTS: the widget grid shipped with its numbers rendered as running
// text — a 16px value beside a 12px label, no size difference between the thing
// you are meant to read and the thing that names it. At full-strip width that
// read as a summary line; inside a 230-480px widget cell it read as a paragraph.
// Three surfaces needed the same fix (every fact in `At a glance`, the headline
// percentage in `Pipeline completion`), so the tile is one component rather than
// three copies of the same four lines.
//
// THE HIERARCHY, in the order the eye should land:
//   1. value  — large, black weight, tight tracking, tabular figures so two
//               tiles side by side line their digits up instead of shimmering.
//   2. label  — small, dim, uppercase, letter-spaced. It names the value and
//               then gets out of the way; it must never compete with it.
//   3. detail — one optional quiet line: a ratio, a comparison, a trend. This
//               is the ONLY slot that takes a semantic colour (success /
//               warning / danger from useThemeColors). Semantic colour is not
//               the brand accent and must never be used as one.
// Nothing else. A tile has no border, no fill and no icon of its own — the card
// around it (WidgetShell) already carries the surface, the radius and the one
// tinted icon anchor that identifies the widget in peripheral vision.
//
// Colours are token classes except the two runtime ones (a value's semantic
// tone, the live dot), which come from useThemeColors — the sanctioned
// exception in ui-consistency.md §8, same as everywhere else on this screen.

import { ProgressMeter } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

export type StatTileProps = {
  /** Names the value. Rendered uppercase — pass it in sentence case. */
  label: string;
  value: string;
  /** Semantic colour for the value (c.success / c.warning / c.danger). Never c.primary. */
  tone?: string;
  /** One quiet line under the value: a ratio, a comparison, a trend. */
  detail?: string;
  /** Semantic colour for `detail`. Defaults to muted. */
  detailTone?: string;
  /** A presence dot before the value, for a fact that is live rather than counted. */
  live?: boolean;
  onPress?: () => void;
  /** The one number a card leads with. At most one per widget. */
  hero?: boolean;
  /**
   * The bar under a value that IS a percentage, so the share is a length and
   * not only a numeral. Only for a value out of 100 — a count has no
   * denominator to draw, and a meter under one would be inventing a scale.
   *
   * It renders `EntityUI`'s `ProgressMeter`, the app's one completion bar, so a
   * dashboard tile and a project card measure the same thing the same way; this
   * prop exists precisely so a widget stops hand-rolling its own track+fill
   * pair, which `pipeline-completion` did.
   */
  meter?: { percent: number; tone?: string };
};

export default function StatTile({ label, value, tone, detail, detailTone, live, onPress, hero, meter }: StatTileProps) {
  const c = useThemeColors();

  const body = (
    <View className="justify-center" style={{ minHeight: 44 }}>
      <Text
        className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.12em]"
        numberOfLines={1}
      >
        {label}
      </Text>
      <View className="flex-row items-center gap-1.5">
        {live && (
          <View className="rounded-full" style={{ width: 6, height: 6, backgroundColor: c.success }} />
        )}
        <Text
          className={`${hero ? 'text-4xl' : 'text-2xl'} font-black tracking-tight flex-shrink`}
          numberOfLines={1}
          // tabular figures: two tiles in a wrapping row put their values in a
          // visual column, and proportional digits make that column wobble.
          style={{ color: tone ?? c.textMain, fontVariant: ['tabular-nums'] }}
        >
          {value}
        </Text>
      </View>
      {!!detail && (
        <Text className="text-[10px] font-semibold mt-0.5" numberOfLines={1} style={{ color: detailTone ?? c.textMuted }}>
          {detail}
        </Text>
      )}
      {!!meter && (
        // A definite width: these tiles sit in a content-sized flex-wrap row,
        // where ProgressMeter's `w-full` would otherwise resolve against the
        // widest sibling line and give a bar that changes length with the label.
        // `maxWidth: '100%'` keeps it inside a 230px cell all the same.
        <View style={{ minWidth: 108, maxWidth: '100%', marginTop: hero ? 8 : 5 }}>
          <ProgressMeter percent={meter.percent} tone={meter.tone} showCaption={false} height={hero ? 6 : 4} />
        </View>
      )}
    </View>
  );

  // A non-tappable tile still sits on the same 44px baseline as a tappable one,
  // or a mixed row lands on two different centre lines.
  if (!onPress) return body;

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}${detail ? `, ${detail}` : ''}`}
      className="rounded-xl hover:bg-surface-overlay/60 transition-colors"
      style={{ minHeight: 44 }}
    >
      {body}
    </TouchableOpacity>
  );
}
