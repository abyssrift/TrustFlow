// The dashboard's widget grid (#213, Wave 2a): a flex-wrap row of cells whose
// widths come from `sizeToFlex` in lib/dashboardWidgets.ts.
//
// There is no breakpoint table in this file and none may be added. Column
// count is arithmetic the layout engine does for us: with `flexBasis` px,
// `flexShrink: 0` and `WIDGET_GAP` between cells, a row fits
// `floor((containerWidth + gap) / (basis + gap))` widgets — 5 small / 2 medium
// at 1216px, 3 small at 960px, 1 of anything at 335px. Those exact numbers are
// asserted in lib/dashboardWidgets.check.ts so a basis change fails the check
// instead of silently reflowing the dashboard.
//
// `grid-cols-*` is banned here twice over: CSS grid does not render in this
// app's react-native-web build (ui-consistency.md:131-134,
// ux-consistency.md:148-150) and it does not exist on native at all.
//
// Path A (unified responsive) per ui-style-guide.md: the same tree renders on
// native and on web at every width, because a wrapping row of cards is a good
// paradigm on both — there is no desktop interaction here that translates
// badly to touch. The one genuinely platform-exclusive piece of the feature
// (recharts vs. react-native-svg) is pushed down into the pipeline-overview
// adapter's own .tsx/.web.tsx pair, so the grid never has to know.

import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import WidgetShell from '@/components/dashboard/widgets/WidgetShell';
import { widgetTint } from '@/components/dashboard/widgets/personalRows';
import { WidgetEmptyProvider, getWidget } from '@/components/dashboard/widgets/registry';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { DashboardLayout } from '@/hooks/useDashboardLayout';
import { WIDGET_GAP, sizeToFlex, widgetMinHeight, type WidgetInstance } from '@/lib/dashboardWidgets';

/**
 * How a widget whose body draws nothing takes up no space at all. `display:
 * 'none'` is dropped from flex layout by both Yoga and react-native-web, so
 * the cell contributes no width, no row and — the part a 0px-tall cell got
 * wrong — no 16px gap either. The subtree stays MOUNTED behind it, because
 * pending-time-approvals' realtime channel has to keep listening for the row
 * that makes it non-empty again.
 */
const HIDDEN_CELL: ViewStyle = { display: 'none' };

export type WidgetGridProps = {
  /** Already permission-filtered by useDashboardLayout — render order is storage order. */
  instances: WidgetInstance[];
  editing: boolean;
  /** The mutators the edit controls call. */
  layout: DashboardLayout;
  onConfigure: (instance: WidgetInstance) => void;
};

function WidgetCell({
  instance,
  index,
  total,
  editing,
  layout,
  onConfigure,
  measured,
}: {
  instance: WidgetInstance;
  index: number;
  total: number;
  editing: boolean;
  layout: DashboardLayout;
  onConfigure: (instance: WidgetInstance) => void;
  measured: boolean;
}) {
  const def = getWidget(instance.type);

  // animation-consistency.md case 2 — manual reanimated (useSharedValue +
  // useAnimatedStyle + withTiming), NOT the declarative entering/exiting
  // props, which silently no-op on this app's web build, and not
  // LayoutAnimation, which no-ops on web too. Reference implementation:
  // MultiViewList.tsx:202-213.
  //
  // Add is the only animated interaction. Remove, reorder and resize are
  // deliberately instant: each of them needs a WAAPI FLIP (case 4, ~60 lines
  // per surface) to look right cross-platform, and the move/remove buttons are
  // explicit one-at-a-time actions where the user already knows what changed.
  //
  // ponytail: this fades on MOUNT, so the whole grid also cross-fades in on
  // first paint rather than only newly-added cells. That reads as a load-in
  // (the screen shows a spinner until `hydrated` anyway), not a glitch. If it
  // ever needs to be add-only, keep a Set of seen instance ids in a ref on
  // WidgetGrid and pass `animateIn` down.
  const c = useThemeColors();
  const reduceMotion = useReducedMotion();
  // THE SEED MUST STAY 1, exactly as MultiViewList.tsx:200 seeds it. Reanimated
  // worklet styles are confirmed on this project to sometimes start and never
  // paint on the web build, and with a 0 seed that failure mode is every widget
  // invisible forever, with no error anywhere. Seeding 1 costs one frame of
  // no-fade in the worst case and cannot make the dashboard disappear. Do not
  // "optimize" this back to 0 (or to `reduceMotion ? 1 : 0`).
  const fade = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    fade.value = 0;
    fade.value = withTiming(1, { duration: 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  // React gives a parent no signal that its child rendered null, so the bodies
  // that can draw nothing report it (registry.tsx's WidgetEmptyProvider). Two
  // things hang off the answer, and both were real bugs:
  //   editing     — an empty `bare` widget kept an absolutely-positioned 44px
  //                 control strip on a 0px cell, so the strip painted over the
  //                 NEXT widget's header and Remove hit the wrong widget. An
  //                 empty body therefore drops `bare` and becomes a real titled
  //                 card with one line in it: still identifiable, still
  //                 removable, and self-contained.
  //   not editing — a 0px cell still held its flexBasis and its gap. Hidden, it
  //                 holds nothing.
  const [bodyEmpty, setBodyEmpty] = useState(false);

  // Before the first layout lands the container width is unknown, so every
  // cell is full width for one frame. Same idea as AdaptiveFileGrid.tsx:38-45.
  // A frame of stacked widgets is invisible; a frame of mis-sized ones is not.
  const style: ViewStyle = bodyEmpty && !editing
    ? HIDDEN_CELL
    : sizeToFlex(measured ? instance.size : 'l');

  // `def.subtitle` is per-type and value-shaped ("Monthly", "Top 10"), so two
  // instances of one type are told apart by what they show rather than by a
  // form label. Types with nothing that varies between instances declare none.
  return (
    <Animated.View style={[style, fadeStyle]}>
      <WidgetEmptyProvider report={setBodyEmpty}>
        <WidgetShell
          title={def.title}
          subtitle={def.subtitle?.(instance)}
          icon={def.icon}
          tint={widgetTint(instance.type, c)}
          bare={def.bare && !bodyEmpty}
          // `flush` drops the body's padding so edge-to-edge rows can reach the
          // card's sides. An empty body has no rows — only the one-line message
          // below — so it drops flush too, or that line sits jammed against the
          // border. Same shape as the `bare` guard above, same reason.
          flush={def.flush && !bodyEmpty}
          // No floor on an empty body: the cell is either hidden entirely or
          // showing one line in edit mode, and 360px of card around that line
          // is the opposite of the problem tiers exist to solve.
          minHeight={bodyEmpty ? undefined : widgetMinHeight(instance.type, instance.size)}
          editing={editing}
          size={instance.size}
          onConfigure={def.configFields.length > 0 ? () => onConfigure(instance) : undefined}
          onCycleSize={() => layout.cycleSize(instance.id)}
          onMoveEarlier={index > 0 ? () => layout.move(instance.id, -1) : undefined}
          onMoveLater={index < total - 1 ? () => layout.move(instance.id, 1) : undefined}
          onRemove={() => layout.removeWidget(instance.id)}
        >
          {/* The body is rendered even while empty — it is what keeps reporting,
              and unmounting it would silence a self-fetching widget's
              subscription. It just draws nothing, so the line below is the whole
              cell. One quiet sentence, not a dashed box, matching every other
              empty state on these two screens. */}
          <def.component instance={instance} size={instance.size} />
          {bodyEmpty && (
            <Text className="text-typography-dim text-xs">Nothing to show right now.</Text>
          )}
        </WidgetShell>
      </WidgetEmptyProvider>
    </Animated.View>
  );
}

export default function WidgetGrid({ instances, editing, layout, onConfigure }: WidgetGridProps) {
  // The CONTAINER's width, not the window's: a grid docked beside a sidebar or
  // inside a narrower column has to reflow off its own slot (the reason spelt
  // out at MultiViewList.tsx:190-192).
  const [gridWidth, setGridWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - gridWidth) > 1) setGridWidth(w);
  };

  return (
    // This View carries `onLayout` and NOTHING else. On web, react-native-web's
    // ResizeObserver-backed onLayout never fires when the same node also has a
    // touch/responder prop (onStartShouldSetResponder, Pressable, a drag
    // handler) — the confirmed bug that made WipByStageChart measure 0 forever.
    // Keep the measuring View bare and the wrapping row inside it.
    <View onLayout={onLayout}>
      {/* `alignItems: 'stretch'` — cards sharing a line end at the same y.
          This reverses the old `flex-start` (and _index_desktop.tsx:440-444's
          "as tall as what it has to say"): that rule produced three heights in
          one row, which is what users actually complained about. What makes it
          safe now is that it is paired with the height TIERS — a stretched card
          is being grown to a quantized 180/360/540 line height, not to whatever
          arbitrary height its loudest neighbour happened to have.

          alignItems is per-LINE in both engines, so this never stretches a card
          to the height of a different row. On react-native-web it is real CSS
          flexbox and behaves exactly as specified. On Yoga it is the same
          computation, but multi-line stretch is the corner of Yoga this project
          cannot verify from source — so it is deliberately NOT what the
          alignment depends on: `widgetMinHeight` already floors every card to
          the same grid. If Yoga ever declines to stretch, the failure mode is
          cards at their own content height above that floor — today's
          behaviour, quantized — not a broken layout. */}
      <View className="flex-row flex-wrap" style={{ gap: WIDGET_GAP, alignItems: 'stretch' }}>
        {instances.map((instance, index) => (
          // Keyed on instance.id, never index or type: an index key remounts
          // every widget on reorder and re-fires every self-fetching widget's
          // query and realtime subscription.
          <WidgetCell
            key={instance.id}
            instance={instance}
            index={index}
            total={instances.length}
            editing={editing}
            layout={layout}
            onConfigure={onConfigure}
            measured={gridWidth > 0}
          />
        ))}
      </View>
    </View>
  );
}
