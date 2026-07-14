import { useThemeColors } from '@/hooks/useThemeColors';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

// Validated categorical palette (dataviz skill reference, fixed slot order).
// Light/dark columns are the same hues stepped for the surface, not a reflip.
const CAT_LIGHT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const CAT_DARK = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

function isDarkHex(hex?: string) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

function fmtH(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 10) return `${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type Slice = { label: string; value: number; color: string };

// Donut: where this board's tracked time went, by task category. Aggregated from
// tasks already loaded (total_seconds from view_task_time_metrics) — zero queries.
// Top 7 categories keep their slot; the rest fold into "Other" (never a 9th hue).
export default function TimeByCategoryPie({
  tasks,
}: {
  tasks: { category?: string | null; total_seconds?: number }[];
}) {
  const colors = useThemeColors();
  const dark = isDarkHex(colors.card);
  const palette = dark ? CAT_DARK : CAT_LIGHT;

  const { slices, total } = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const t of tasks) {
      const secs = t.total_seconds || 0;
      if (secs <= 0) continue;
      const cat = (t.category || 'Uncategorized').trim() || 'Uncategorized';
      byCat.set(cat, (byCat.get(cat) || 0) + secs);
    }
    const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7);
    const out: Slice[] = top.map(([label, value], i) => ({ label, value, color: palette[i] }));
    if (rest.length) out.push({ label: 'Other', value: rest.reduce((s, [, v]) => s + v, 0), color: colors.muted });
    return { slices: out, total: out.reduce((s, x) => s + x.value, 0) };
  }, [tasks, palette, colors.muted]);

  if (total === 0) {
    return (
      <View className="mb-3 items-center justify-center rounded-xl border border-surface-border bg-surface-card px-3 py-6">
        <Text className="text-typography-muted text-xs font-bold">No time tracked yet</Text>
      </View>
    );
  }

  const size = 128, stroke = 18, r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
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
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${C - dash}`}
        strokeDashoffset={-acc}
      />
    );
    acc += (s.value / total) * C;
    return el;
  });

  return (
    <View className="mb-3 rounded-xl border border-surface-border bg-surface-card p-3">
      <Text className="mb-3 text-typography-muted text-[10px] font-black uppercase tracking-widest">Where time went</Text>
      <View className="flex-row items-center gap-3">
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size}>
            <G rotation={-90} origin={`${cx}, ${cy}`}>{arcs}</G>
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size }} className="items-center justify-center">
            <Text className="text-typography-main text-lg font-black">{fmtH(total)}</Text>
            <Text className="text-typography-muted text-[9px] font-bold uppercase tracking-widest">total</Text>
          </View>
        </View>

        <View className="flex-1 min-w-0">
          {slices.map((s, i) => (
            <View key={i} className="mb-1 flex-row items-center gap-2">
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: s.color }} />
              <Text className="flex-1 text-typography-main text-[11px] font-bold" numberOfLines={1}>{s.label}</Text>
              <Text className="text-typography-muted text-[10px] font-black">{Math.round((s.value / total) * 100)}%</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
