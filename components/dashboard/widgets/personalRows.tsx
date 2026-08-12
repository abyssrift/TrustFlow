// The handful of lines every widget body draws the same way: the footer link,
// the empty sentence, the loading placeholder, and the task row the personal
// widgets (`my-work`, `my-deadlines`) share. Not a framework and not a base
// widget — `ListRow` already owns padding, divider, hover and disabled
// treatment; this file only spells out what goes INSIDE one.
//
// It is the LEAF of the widget tree on purpose. registry.tsx imports these; this
// file imports nothing from registry.tsx, so there is no cycle even though every
// widget body sits between the two. `SeeAllRow` and `QuietLine` used to be
// declared twice — once here, once module-private in registry.tsx — and the
// registry's copies (which carry the `mt-auto` footer pin) are the ones kept.

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { ListRow } from '@/components/common/ListRow';
import { SkeletonList } from '@/components/Skeleton';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { WIDGET_META, type WidgetCategory, type WidgetSize, type WidgetType } from '@/lib/dashboardWidgets';

// ── The card's one accent ────────────────────────────────────────────────

/**
 * A widget's decorative tint, by CATEGORY — so fourteen cards stop reading as
 * one undifferentiated wall without any of them shouting.
 *
 * FOUR RULES, in the order they mattered:
 *
 * 1. Existing tokens only. `primary` / `secondary` / `info` / `muted` from
 *    useThemeColors; nothing invented, nothing from the raw Tailwind palette.
 * 2. A decorative tint may NEVER be mistakable for a state. That is checked at
 *    runtime, not assumed: this app ships six themes and two of them reuse a
 *    state hex for a brand slot (`amber`'s secondary and `indigo`'s accent are
 *    both `#fbbf24`, which is also `warning`). `accent` is excluded outright for
 *    that reason, and anything that still lands on success/warning/danger in the
 *    ACTIVE theme falls back to the brand.
 * 3. It carries no information a screen reader needs, so it is one hairline on
 *    the body's leading edge and nothing else — not a fill, not a border, not a
 *    second copy on every row. One carrier per card (see WidgetList).
 * 4. `category` already exists in WIDGET_META. No metadata change was needed and
 *    none should be added for this.
 *
 * KNOWN CEILING, honestly: the token set is too small to separate four
 * categories in every theme. `dark` makes primary/secondary/muted three greys,
 * so three of the four categories are indistinguishable there. That is a
 * palette limit, not a bug to code around — the rail degrades to "a quiet
 * hairline" rather than to a wrong colour, which is the correct failure.
 */
const CATEGORY_TONE: Record<WidgetCategory, 'primary' | 'secondary' | 'info' | 'muted'> = {
  overview: 'primary',
  projects: 'secondary',
  analytics: 'info',
  activity: 'muted',
};

export function widgetTint(type: WidgetType, c: ReturnType<typeof useThemeColors>): string {
  const hue = c[CATEGORY_TONE[WIDGET_META[type].category]];
  return hue === c.success || hue === c.warning || hue === c.danger ? c.primary : hue;
}

/**
 * The wrapper every edge-to-edge (`flush`) list body uses.
 *
 * It replaces the bare `<View style={{ flexGrow: 1 }}>` those bodies already
 * had — same growing parent, for the same reason (`SeeAllRow`'s `mt-auto`
 * footer pin measures against THIS view, so without a grower the free space in
 * a tier-floored card sits below the link instead of above it) — plus the one
 * accent hairline. Nothing else. Not a base widget: it renders its children
 * verbatim and knows nothing about rows, data or empty states.
 *
 * The rail is `position: absolute` so it never takes part in the row layout and
 * cannot change a card's height, and `pointerEvents="none"` so it never eats a
 * tap meant for the row under it. ListRow's own `px-5` keeps content clear of
 * it at 2px, at every width, on both platforms.
 */
export function WidgetList({ type, children }: { type: WidgetType; children: React.ReactNode }) {
  const c = useThemeColors();
  return (
    <View style={{ flexGrow: 1 }}>
      <View
        pointerEvents="none"
        // Decorative: it repeats what the card's title and icon already say.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          backgroundColor: widgetTint(type, c) + '59',
        }}
      />
      {children}
    </View>
  );
}

/**
 * Cap-and-link, the house overflow affordance. Widgets never scroll, so this is
 * how a 200-row list ends. Sits flush against the bottom of a `flush` body.
 *
 * `mt-auto` is the footer pin: an auto top margin eats the free space a short
 * list leaves in a tier-floored card, so the link sits on the card's bottom
 * edge instead of floating under three rows. Auto margins are one of the few
 * layout features Yoga and CSS agree on exactly. It needs a parent that grows —
 * WidgetShell's body does, and so must the widget body in between (see
 * RecentActivityWidget). With no free space it collapses to 0 and the row sits
 * directly under the content, which is the old behaviour.
 */
export function SeeAllRow({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="mt-auto flex-row items-center justify-center gap-1.5 border-t border-surface-border/50 hover:bg-surface-overlay/40 transition-colors"
      style={{ minHeight: 44 }}
    >
      <Text className="text-brand-primary text-xs font-bold">{label}</Text>
      <FontAwesome name="arrow-right" size={9} color={c.primary} />
    </TouchableOpacity>
  );
}

/** One quiet line, not a dashed box — the wording rule the two screens already follow. */
export function QuietLine({ text }: { text: string }) {
  return <Text className="text-typography-dim text-xs px-4 pb-4">{text}</Text>;
}

/** Placeholder shapes while a self-fetching widget's first read is in flight. */
export function WidgetLoadingRows({ rows = 2 }: { rows?: number }) {
  return (
    <View className="px-4 pb-4">
      <SkeletonList count={rows} itemHeight={22} gap={10} />
    </View>
  );
}

/**
 * "Is this landing soon?" — the one derivation, so `my-work` and `my-deadlines`
 * cannot disagree about which of their rows is nearly due.
 *
 * Two days, matching `formatRelativeDue`'s own first bucket (`today` / `1d`):
 * anything it words in a single digit of days is what this returns true for.
 * Midnight-anchored on both sides, same as that function, so a task due tonight
 * and a task due at 9am tomorrow are both "soon" rather than one being 0.6 days.
 */
export function dueSoon(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  return days >= 0 && days <= 1;
}

/**
 * The due state as a THREE-STEP RAMP OF FORM, not three shades of one word:
 *
 *   late   — filled pill, bordered, bold, with a glyph
 *   soon   — outlined pill, no fill, no glyph
 *   later  — plain dim text, no container at all
 *
 * So the severity is legible from the amount of ink on the row before any hue
 * is resolved, which is the point: colour alone would be the only signal for
 * anyone who cannot separate danger from warning, and the glyph on the late
 * step means the worst one is never carried by hue at all. It used to be a
 * binary — a pill or nothing — which left "due tomorrow" and "due in five
 * weeks" rendered identically.
 *
 * `label` comes from `formatRelativeDue` (hooks/useUpcomingTasks.ts:45) so a
 * widget and the topbar deadline strip can never word the same date differently.
 */
export function DuePill({ label, overdue, soon }: { label: string; overdue: boolean; soon?: boolean }) {
  const c = useThemeColors();
  if (overdue) {
    return (
      <View className="flex-row items-center gap-1 rounded-lg border border-state-danger/40 bg-state-danger/10 px-1.5 py-0.5">
        <FontAwesome name="exclamation" size={8} color={c.danger} />
        <Text className="text-state-danger text-[10px] font-bold">{label}</Text>
      </View>
    );
  }
  if (soon) {
    return (
      <View className="rounded-lg border border-state-warning/50 px-1.5 py-0.5">
        <Text className="text-state-warning text-[10px] font-semibold">{label}</Text>
      </View>
    );
  }
  return <Text className="text-typography-dim text-[10px]">{label}</Text>;
}

/**
 * One task, as both personal list widgets draw it: the stage's own colour, the
 * title, one line of context, and the due state on the right.
 *
 * At `s` (a 230px cell) the secondary line goes rather than being squeezed —
 * the title and how late it is are what the row is for.
 */
export function PersonalTaskRow({
  title,
  stageColor,
  secondary,
  due,
  size,
  isLast,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  /** From `pipeline_stages.color` — a runtime value, hence the inline style. */
  stageColor: string;
  secondary?: string;
  due?: { label: string; overdue: boolean; soon?: boolean };
  size: WidgetSize;
  isLast: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <ListRow
      isLast={isLast}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      className="gap-3"
      // A one-line row (size 's' drops the secondary line) is ~40px on its own
      // padding; the tap-target floor is 44 (ui-style-guide.md:38).
      style={{ minHeight: 44 }}
    >
      {/* The stage's colour as a short vertical rail rather than a dot: same
          one fact, but a column of rails reads as "which board is this on"
          down the whole list, where a column of 8px dots read as bullets. */}
      <View style={{ width: 3, height: 22, borderRadius: 2, backgroundColor: stageColor }} />
      <View className="flex-1 min-w-0">
        <Text className="text-typography-main text-xs font-semibold" numberOfLines={1}>{title}</Text>
        {size !== 's' && !!secondary && (
          <Text className="text-typography-dim text-[10px]" numberOfLines={1}>{secondary}</Text>
        )}
      </View>
      {due && <DuePill label={due.label} overdue={due.overdue} soon={due.soon} />}
    </ListRow>
  );
}
