import { useThemeColors } from '@/hooks/useThemeColors';
import { formatCompact } from '@/lib/time';
import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

// Validated categorical palette (dataviz skill reference, fixed slot order).
// Light/dark columns are the same hues stepped for the surface, not a reflip.
//
// Re-validated 2026-08-03 (#198) against this app's dark chart surface with
// the dataviz validator: lightness band, chroma floor, adjacent-pair CVD
// separation (worst ΔE 8.4 protan / 8.7 tritan), normal-vision floor (19.3)
// and >= 3:1 contrast all PASS on the dark column. The adjacent-pair CVD
// margin sits in the band that is only legal WITH a secondary encoding, which
// is why the legend beside the ring always carries the category NAME and is
// not an optional extra — colour is never the sole carrier of identity here.
const CAT_LIGHT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const CAT_DARK = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

function isDarkHex(hex?: string) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

function fmtH(sec: number) {
  return formatCompact(sec);
}

type Slice = { label: string; value: number; color: string };

/**
 * What a slice measures.
 *   'time'  — tracked seconds per category. "Where did the time go?"
 *   'count' — number of tasks per category. "What is this engagement made of?"
 *
 * Added for the project Assignments screen (#198), which needs the count
 * question. It is a MODE on this component rather than a second donut
 * elsewhere: a second chart answering "which categories" slightly differently
 * is precisely the drift `.agents/rules/global-utilities-index.md`'s first
 * rule exists to prevent, and it would have arrived with its own palette, its
 * own "Other" threshold and its own idea of what "Uncategorized" means.
 */
export type CategoryPieMode = 'time' | 'count';

// Donut: this board's work by task category. Aggregated from tasks already
// loaded (total_seconds from view_task_time_metrics) — zero queries.
// Top 7 categories keep their slot; the rest fold into "Other" (never a 9th hue).
//
// NO PLATFORM SUFFIX, deliberately. This was TimeByCategoryPie.web.tsx until
// #198, but nothing in it is web-only — it draws with react-native-svg, not
// recharts — so the suffix was pinning a portable component to one platform,
// and would have forced the Assignments tab to invent a native fallback for a
// chart that already runs fine on native. Renamed rather than given a `.tsx`
// sibling: a sibling would have been the same code twice, which is the thing
// this component is now the argument against.
export default function TimeByCategoryPie({
  tasks,
  mode = 'time',
  title,
  selected = null,
  onSelect,
  size = 128,
}: {
  tasks: { category?: string | null; total_seconds?: number }[];
  /** Defaults to 'time' so the original kanban call site is unchanged. */
  mode?: CategoryPieMode;
  /** Defaults per mode. */
  title?: string;
  /** Highlight one category and dim the rest. Pass with `onSelect` to filter. */
  selected?: string | null;
  /** When given, the legend becomes a filter control. */
  onSelect?: (category: string | null) => void;
  size?: number;
}) {
  const colors = useThemeColors();
  const dark = isDarkHex(colors.card);
  const palette = dark ? CAT_DARK : CAT_LIGHT;

  const { slices, total } = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const t of tasks) {
      // The ONLY difference between the two modes: what one task contributes.
      // Everything downstream — ordering, the top-7 cut, "Other", the colour
      // slots, the "Uncategorized" fallback — is shared, so the two questions
      // can never be answered with different groupings of the same tasks.
      const v = mode === 'count' ? 1 : (t.total_seconds || 0);
      if (v <= 0) continue;
      const cat = (t.category || 'Uncategorized').trim() || 'Uncategorized';
      byCat.set(cat, (byCat.get(cat) || 0) + v);
    }
    const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7);
    const out: Slice[] = top.map(([label, value], i) => ({ label, value, color: palette[i] }));
    if (rest.length) out.push({ label: 'Other', value: rest.reduce((s, [, v]) => s + v, 0), color: colors.muted });
    return { slices: out, total: out.reduce((s, x) => s + x.value, 0) };
  }, [tasks, palette, colors.muted, mode]);

  if (total === 0) {
    return (
      <View className="mb-3 items-center justify-center rounded-xl border border-surface-border bg-surface-card px-3 py-6">
        <Text className="text-typography-muted text-xs font-bold">
          {mode === 'count' ? 'No tasks yet' : 'No time tracked yet'}
        </Text>
      </View>
    );
  }

  const stroke = Math.round(size * 0.14), r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  const GAP = 2; // surface gap between fills (mark spec)

  let acc = 0;
  const arcs = slices.map((s, i) => {
    const dash = Math.max(0, (s.value / total) * C - GAP);
    const el = (
      <Circle
        key={i}
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={s.color}
        strokeOpacity={selected && selected !== s.label ? 0.28 : 1}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${C - dash}`}
        strokeDashoffset={-acc}
      />
    );
    acc += (s.value / total) * C;
    return el;
  });

  const heading = title ?? (mode === 'count' ? 'Work by category' : 'Where time went');

  return (
    <View className="mb-3 rounded-xl border border-surface-border bg-surface-card p-3">
      <Text className="mb-3 text-typography-muted text-[10px] font-black uppercase tracking-widest">{heading}</Text>
      <View className="flex-row items-center gap-3 flex-wrap">
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size}>
            <G rotation={-90} origin={`${cx}, ${cy}`}>{arcs}</G>
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size }} className="items-center justify-center">
            <Text className="text-typography-main text-lg font-black">
              {mode === 'count' ? total : fmtH(total)}
            </Text>
            <Text className="text-typography-muted text-[9px] font-bold uppercase tracking-widest">
              {mode === 'count' ? 'tasks' : 'total'}
            </Text>
          </View>
        </View>

        {/* The legend carries the category NAME next to its colour — required,
            see the palette note above. When `onSelect` is given it is also the
            filter control, and on touch it is the ONLY way to pick a slice: an
            18px-wide wedge is not a touch target. */}
        <View className="flex-1 min-w-0" style={{ minWidth: 130 }}>
          {slices.map((s, i) => {
            const active = selected === s.label;
            const row = (
              <View className="flex-row items-center gap-2">
                <View
                  style={{
                    width: 9, height: 9, borderRadius: 3,
                    backgroundColor: s.color,
                    opacity: selected && !active ? 0.35 : 1,
                  }}
                />
                <Text
                  className={`flex-1 text-[11px] font-bold ${active ? 'text-brand-primary' : 'text-typography-main'}`}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
                <Text className="text-typography-muted text-[10px] font-black">
                  {mode === 'count' ? s.value : `${Math.round((s.value / total) * 100)}%`}
                </Text>
              </View>
            );
            if (!onSelect) return <View key={i} className="mb-1">{row}</View>;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => onSelect(active ? null : s.label)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${s.label}. Filter the list`}
                className="mb-0.5 justify-center rounded-lg px-1.5"
                style={{ minHeight: 34, backgroundColor: active ? colors.primary + '1A' : 'transparent' }}
              >
                {row}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}
