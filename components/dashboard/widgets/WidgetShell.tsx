// The card chrome every dashboard widget wears (#213, Wave 2a).
//
// Two visual states, one component:
//   editing = false -> a plain card. Nothing to see, nothing to press.
//   editing = true  -> the same card with a control strip and a brand-tinted
//                      border. The affordances appear because the user asked
//                      for them; they are not permanently-on decoration.
//
// The header shape deliberately mirrors EntityUI's `SectionCard` (:519-560) so
// a widget reads like every other titled surface in the app. `SectionCard`
// itself is NOT reused: it hardcodes `p-4 md:p-5` with no way to drop body
// padding for an edge-to-edge list (`flush`) or to skip its own card entirely
// for a child that already draws one (`bare`), and its `right` slot has no
// notion of edit mode.
//
// Colours: every surface/typography value is a token class; the two runtime
// values (FontAwesome's `color` prop, the edit-state border) come from
// `useThemeColors`, which is the sanctioned exception in ui-consistency.md §8
// and the pattern already used at _index_desktop.tsx:401. Sizes in px are
// definite tap-target dimensions, also sanctioned — 44x44 minimum per
// ui-style-guide.md:38.

import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import Tooltip from '@/components/common/Tooltip';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { WidgetSize } from '@/lib/dashboardWidgets';

const SIZE_LABEL: Record<WidgetSize, string> = { s: 'Small', m: 'Medium', l: 'Large' };
const SIZE_GLYPH: Record<WidgetSize, string> = { s: 'S', m: 'M', l: 'L' };

/** Reserved header height, edit mode or not, so controls appearing never reflows the card. */
const CONTROL_SIZE = 44;

export type WidgetShellProps = {
  title: string;
  /** Derived from the instance's config by WidgetGrid, so two instances of one type read differently. */
  subtitle?: string;
  /** FontAwesome name. */
  icon: string;
  /**
   * Medallion hue, from `widgetTint` (category-derived, guarded against the
   * state palette). Omitted => brand primary, so a caller that doesn't care
   * gets the old uniform chrome.
   */
  tint?: string;
  /** Child already draws its own `bg-surface-card` card — render an overlay control strip only. */
  bare?: boolean;
  /** Drop body padding for edge-to-edge rows. */
  flush?: boolean;
  editing: boolean;
  /** Undefined => this type declares no configFields => no gear button. */
  onConfigure?: () => void;
  size: WidgetSize;
  /**
   * Quantized height floor from `widgetMinHeight` — never a fixed height, so a
   * card that wraps at 335px still grows past it instead of clipping. 0 (the
   * `bare` case, which is now only pending-time-approvals) leaves the card at
   * its content height.
   */
  minHeight?: number;
  onCycleSize: () => void;
  /** Undefined at index 0. */
  onMoveEarlier?: () => void;
  /** Undefined at the last index. */
  onMoveLater?: () => void;
  onRemove: () => void;
  children: React.ReactNode;
};

/** One 44x44 edit affordance. `glyph` is the S/M/L badge the size control adds next to its icon. */
function ControlButton({
  icon,
  label,
  onPress,
  color,
  glyph,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  color: string;
  glyph?: string;
}) {
  return (
    <Tooltip label={label}>
      <TouchableOpacity
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        className="flex-row items-center justify-center gap-1 rounded-xl hover:bg-surface-overlay active:opacity-60 transition-colors"
        style={{ minWidth: CONTROL_SIZE, height: CONTROL_SIZE, paddingHorizontal: 6 }}
      >
        <FontAwesome name={icon as never} size={13} color={color} />
        {!!glyph && (
          <Text className="text-typography-muted text-[10px] font-black tracking-wide">{glyph}</Text>
        )}
      </TouchableOpacity>
    </Tooltip>
  );
}

export default function WidgetShell({
  title,
  subtitle,
  icon,
  tint,
  bare,
  flush,
  editing,
  onConfigure,
  size,
  minHeight,
  onCycleSize,
  onMoveEarlier,
  onMoveLater,
  onRemove,
  children,
}: WidgetShellProps) {
  const c = useThemeColors();

  // Five controls x 44px = 220px. An 's' cell is 230px of flexBasis, so inline
  // controls would leave nothing for the title. Below that width they wrap to
  // their own row under the title instead.
  const stackControls = size === 's';

  const controls = editing ? (
    <View className={`flex-row items-center ${stackControls ? 'flex-wrap' : ''}`}>
      {!!onConfigure && (
        <ControlButton icon="cog" label={`Configure ${title}`} onPress={onConfigure} color={c.textMuted} />
      )}
      <ControlButton
        icon="expand"
        label={`Size: ${SIZE_LABEL[size]} — tap to cycle`}
        onPress={onCycleSize}
        color={c.textMuted}
        glyph={SIZE_GLYPH[size]}
      />
      {!!onMoveEarlier && (
        <ControlButton icon="arrow-up" label={`Move ${title} earlier`} onPress={onMoveEarlier} color={c.textMuted} />
      )}
      {!!onMoveLater && (
        <ControlButton icon="arrow-down" label={`Move ${title} later`} onPress={onMoveLater} color={c.textMuted} />
      )}
      {/* ponytail: no confirm on remove. Removing a widget is a local layout
          preference that the Add picker restores in two taps — a modal for it
          is unearned friction (spec §6.4). Add useAlert().showConfirm here if
          layouts ever become shared or server-persisted. */}
      <ControlButton icon="times" label={`Remove ${title}`} onPress={onRemove} color={c.danger} />
    </View>
  ) : null;

  // `bare`: the child (PendingTimeApprovalsWidget — and ONLY it now; the
  // overview chart left, because bare also meant no height tier and it was the
  // one card in its row rendering short) already draws its own card AND heading.
  // Wrapping it would give a double card and a double title, so the shell
  // contributes nothing but the control strip, floated over the child's own
  // corner. `box-none` on the wrappers keeps the child fully interactive
  // outside the strip's own bounds, in and out of edit mode.
  // In edit mode the wrapper reserves the strip's own height, so the floating
  // controls can never paint outside the cell they belong to whatever the child
  // draws. The grid already stops passing `bare` for a body that renders
  // nothing at all (WidgetGrid.tsx) — this is the second lock on the same door,
  // for a child that renders something shorter than 44px.
  if (bare) {
    return (
      <View
        className="relative"
        pointerEvents="box-none"
        style={editing ? { minHeight: CONTROL_SIZE + 12 } : undefined}
      >
        {children}
        {editing && (
          <View className="absolute" pointerEvents="box-none" style={{ top: 6, right: 6, zIndex: 2 }}>
            <View
              className="flex-row flex-wrap justify-end bg-surface-card border rounded-xl"
              style={{ borderColor: c.primary + '55' }}
            >
              {controls}
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View
      className="bg-surface-card border rounded-2xl overflow-hidden"
      style={{
        borderColor: editing ? c.primary + '55' : c.border,
        // The height floor, plus the fill for when the grid's row stretch has
        // already made the CELL taller than this card's own content. Both are
        // needed: the floor quantizes cards that are alone on a line, the fill
        // is what makes two cards sharing a line end at the same y.
        minHeight,
        flexGrow: 1,
      }}
    >
      <View className="px-4 pt-4 pb-3">
        <View className="flex-row items-center gap-2.5" style={{ minHeight: CONTROL_SIZE }}>
          {/* The anchor. A 13px glyph floating beside the title gave a card no
              fixed focal point — in peripheral vision every widget was the same
              rectangle of small text. The tinted container is the medallion
              PendingTimeApprovalsWidget already uses (`w-11 h-11 rounded-2xl
              bg-state-warning/20`), at header scale.

              The hue is per-category (`widgetTint`) rather than one fixed
              brand tint, because fourteen identical medallions read as one
              undifferentiated wall. `+ '1A'` is the same 10% fill the
              `-dim` tokens carry — hex-alpha rather than a token class
              because the hue is dynamic (same idiom as personalRows.tsx:92).
              widgetTint already refuses any hue equal to success/warning/
              danger in the active theme, so category colour can never be
              misread as state. */}
          <View
            className="rounded-xl items-center justify-center"
            style={{ width: 30, height: 30, backgroundColor: (tint ?? c.primary) + '1A' }}
          >
            <FontAwesome name={icon as never} size={14} color={tint ?? c.primary} />
          </View>
          <View className="flex-1 min-w-0">
            <Text className="text-typography-main text-sm font-bold" numberOfLines={1}>
              {title}
            </Text>
            {!!subtitle && (
              <Text className="text-typography-muted text-[11px] mt-0.5" numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
          {!stackControls && controls}
        </View>
        {stackControls && !!controls && <View className="mt-1">{controls}</View>}
      </View>

      {/* `flexGrow: 1` and NOT `flex-1`: flex-1 sets flexBasis 0, and Yoga does
          not implement CSS's `min-height: auto` on flex items, so on native a
          body taller than the leftover space would be squashed rather than
          overflowing. Growing from an `auto` basis takes the free space when
          there is some and the content height when there isn't. This is what
          gives a pinned footer (`mt-auto` in registry.tsx's SeeAllRow) room to
          push against. */}
      <View style={{ flexGrow: 1 }} className={flush ? '' : 'px-4 pb-4'}>{children}</View>
    </View>
  );
}
