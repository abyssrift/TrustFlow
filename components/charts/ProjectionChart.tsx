import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line as SvgLine, Polyline } from 'react-native-svg';

import { SectionCard } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  canProject,
  confidenceCaption,
  noProjectionReason,
  type ProjectionSeries,
} from './projection';

// Issue #198 / plan §16.1 — THE projection chart. NATIVE variant.
//
// ProjectionChart.web.tsx is the web sibling (recharts, hover tooltips).
// recharts cannot render under React Native, so this file draws the same
// contract with react-native-svg — the same split, and the same reason for it,
// as PortfolioFlowTab.tsx / PortfolioFlowTab.web.tsx.
//
// Same one rule as the web variant: NO pace maths in this file, ever. It draws
// what the caller hands it. Everything about the contract, the confidence
// threshold and the wording lives in ./projection.ts so the two platforms
// cannot drift into showing different dates or different excuses.
//
// Measuring gotcha, learned the hard way in #175: never put `onLayout` on the
// same node as a touch responder — react-native-web's ResizeObserver-backed
// onLayout silently never fires when they share a node, and the chart renders
// at width 0 with real data in it. The measured View here does nothing else.

const PAD = { top: 8, right: 10, bottom: 18, left: 26 };

const fmtShort = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function ProjectionChart({
  series,
  title,
  subtitle,
  height = 220,
  className,
}: {
  series: ProjectionSeries;
  title: string;
  subtitle?: string;
  height?: number;
  /** Passed to SectionCard — `flex-1` when this sits in a row of cards. */
  className?: string;
}) {
  const c = useThemeColors();
  const [width, setWidth] = useState(0);
  const projecting = canProject(series);

  const n = series.points.length;
  const maxY = Math.max(series.target, 1);
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = Math.max(height - PAD.top - PAD.bottom, 1);

  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (Math.min(v, maxY) / maxY) * plotH;

  const actualPts = series.points
    .map((p, i) => (p.actual == null ? null : `${x(i)},${y(p.actual)}`))
    .filter(Boolean)
    .join(' ');

  // Same suppression rule as the web variant: when we've decided not to show a
  // forecast, it isn't drawn at all rather than drawn invisibly.
  const projectedPts = projecting
    ? series.points
        .map((p, i) => (p.projected == null ? null : `${x(i)},${y(p.projected)}`))
        .filter(Boolean)
        .join(' ')
    : '';

  const hasAnyActual = series.points.some(p => p.actual != null);
  const lastActualIdx = series.points.reduce((acc, p, i) => (p.actual != null ? i : acc), -1);

  return (
    // Chrome and header are SectionCard's, not this file's — kept identical to
    // the .web sibling so the two platforms cannot drift apart.
    <SectionCard
      title={title}
      hint={subtitle}
      icon="line-chart"
      className={className}
      right={
        projecting && !!series.projectedEnd ? (
          <View className="items-end">
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em]">
              Projected finish
            </Text>
            <Text
              className="text-sm font-bold mt-0.5"
              style={{ color: series.confidence === 'low' ? c.warning : c.textMain }}
            >
              {fmtShort(series.projectedEnd)}
            </Text>
          </View>
        ) : undefined
      }
    >

      <View className="flex-row items-center flex-wrap gap-4 mt-2 mb-3">
        <View className="flex-row items-center gap-1.5">
          <View style={{ width: 14, height: 2, backgroundColor: c.primary }} />
          <Text className="text-typography-muted text-[10px] font-semibold">Completed</Text>
        </View>
        {projecting && (
          <View className="flex-row items-center gap-1.5">
            <View className="flex-row items-center" style={{ gap: 2 }}>
              {[0, 1, 2].map(i => (
                <View key={i} style={{ width: 4, height: 2, backgroundColor: c.primary, opacity: 0.75 }} />
              ))}
            </View>
            <Text className="text-typography-muted text-[10px] font-semibold">At current pace</Text>
          </View>
        )}
      </View>

      {/* Measured node does nothing but measure — see header note. */}
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {hasAnyActual && width > 0 ? (
          <Svg width={width} height={height}>
            {/* Target rule */}
            <SvgLine
              x1={PAD.left}
              y1={y(series.target)}
              x2={PAD.left + plotW}
              y2={y(series.target)}
              stroke={c.textDim}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {/* Baseline */}
            <SvgLine
              x1={PAD.left}
              y1={PAD.top + plotH}
              x2={PAD.left + plotW}
              y2={PAD.top + plotH}
              stroke={c.border}
              strokeWidth={1}
            />
            {!!projectedPts && (
              <Polyline
                points={projectedPts}
                fill="none"
                stroke={c.primary}
                strokeOpacity={0.75}
                strokeWidth={2}
                strokeDasharray="5 4"
              />
            )}
            {!!actualPts && (
              <Polyline points={actualPts} fill="none" stroke={c.primary} strokeWidth={2} />
            )}
            {lastActualIdx >= 0 && (
              <Circle
                cx={x(lastActualIdx)}
                cy={y(series.points[lastActualIdx].actual ?? 0)}
                r={4}
                fill={c.primary}
              />
            )}
          </Svg>
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-typography-dim text-xs text-center" style={{ maxWidth: 320 }}>
              Nothing completed yet, so there is no progress to plot.
            </Text>
          </View>
        )}
      </View>

      <Text className="text-typography-dim text-[10px] leading-4 mt-3">
        {projecting ? confidenceCaption(series) : noProjectionReason(series)}
      </Text>
    </SectionCard>
  );
}
