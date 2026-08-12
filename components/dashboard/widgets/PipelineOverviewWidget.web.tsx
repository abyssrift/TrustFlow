// Web half of the pipeline-overview chart split (#213, Wave 2b). See the native
// sibling (PipelineOverviewWidget.tsx) for why the split exists at all.
//
// Web gets a second decision the native side does not have: recharts wants room
// for two axes, their tick labels and a legend, and has none of it in a narrow
// widget cell — so below ~640px of MEASURED width this renders the svg chart
// instead, the same component native uses, which sizes itself from its own
// onLayout. (Its old `p-10 rounded-[32px]` card is gone: the widget shell draws
// the card now, which is what gives the chart the height tier it was missing.)

import PipelineOverviewChart from '@/components/intelligence/PipelineOverviewChart';
import PipelineOverviewChartNative from '@/components/intelligence/PipelineOverviewChartNative';
import React, { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

type Props = React.ComponentProps<typeof PipelineOverviewChartNative>;

/** Below this measured width recharts' own padding leaves no plot area. */
const RECHARTS_MIN_WIDTH = 640;

export default function PipelineOverviewWidget(props: Props) {
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
  };

  // The measuring View carries onLayout and NOTHING else: react-native-web's
  // ResizeObserver-backed onLayout never fires when the same node also has a
  // responder prop, which is how the WipByStage chart once rendered nothing at
  // all despite having data (global-utilities-index.md:130).
  // `flexGrow` so the shell's height tier reaches the chart through this
  // wrapper — without it the chart measures its own content and the widget goes
  // back to being the short card in its row.
  return (
    <View onLayout={onLayout} style={{ flexGrow: 1 }}>
      {/* Until the first layout lands, assume narrow. One frame of the svg
          chart is invisible; one frame of a 640px-wide recharts card inside a
          335px column is a horizontal scrollbar. */}
      {width >= RECHARTS_MIN_WIDTH
        ? <PipelineOverviewChart {...props} />
        : <PipelineOverviewChartNative {...props} />}
    </View>
  );
}
