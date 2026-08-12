// The two dashboard-widget popups (#213, Wave 2c): the Add-widget picker and
// the per-instance config sheet.
//
// Both import metadata from lib/dashboardWidgets.ts ONLY — never from
// components/dashboard/widgets/registry.tsx. The picker lists what a widget IS,
// not what it renders; importing the registry would pull every widget component
// (and recharts, and the analytics context) into the bundle just to draw a list
// of fourteen cards.
//
// Colours are inline from useThemeColors rather than token classNames: this
// content renders inside an RN `Modal`, the one sanctioned exception to
// ui-consistency.md §8 "no inline styles" (same rule Tooltip.tsx and Popup.tsx
// itself already follow). Spacing/layout stay in className.

import Popup from '@/components/common/Popup';
import { FilterChip } from '@/components/entities/EntityUI';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  WIDGET_CATEGORY_ORDER,
  WIDGET_META,
  WIDGET_TYPES,
  addWidgetBlock,
  type WidgetInstance,
  type WidgetType,
} from '@/lib/dashboardWidgets';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

/** Picker entry basis. Same flexWrap idiom as WidgetGrid — grid-cols-* does not
 *  render in this RN-web build (ux-consistency.md, "Dropdowns sit side by side").
 *  `maxWidth: '100%'` is what stops a 210px card overflowing a 335px sheet. */
const ENTRY_FLEX = { flexGrow: 1, flexShrink: 0, flexBasis: 210, maxWidth: '100%' as const };

// ── The sliders menu ─────────────────────────────────────────────────────

/**
 * What the header's existing `sliders` button now opens, on both screens.
 *
 * It is one popup rather than a second header button because the adaptive
 * header already carries three 44px targets at 390px and a fourth does not
 * fit. One extra tap buys edit mode without spending any header width, and the
 * pipeline settings that button used to open directly are simply the second row.
 */
export function DashboardMenuPopup({
  visible,
  onClose,
  onEditLayout,
  onOpenPipelineConfig,
}: {
  visible: boolean;
  onClose: () => void;
  onEditLayout: () => void;
  onOpenPipelineConfig: () => void;
}) {
  const c = useThemeColors();

  const row = (icon: string, title: string, blurb: string, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${blurb}`}
      className="flex-row items-center gap-3 rounded-2xl p-3.5 mb-2.5"
      style={{ minHeight: 44, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}
    >
      <View
        className="items-center justify-center"
        style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.primary + '14' }}
      >
        <FontAwesome name={icon as never} size={14} color={c.primary} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-bold" style={{ color: c.textMain }}>{title}</Text>
        <Text className="text-[11px] leading-4 mt-0.5" style={{ color: c.textMuted }}>{blurb}</Text>
      </View>
      <FontAwesome name="angle-right" size={16} color={c.textDim} />
    </TouchableOpacity>
  );

  return (
    // Two rows and no columns to give them — 420 is what ux-consistency.md
    // calls correct for a single decision, and says not to widen.
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420} dimBackdrop title="Dashboard">
      <View className="px-6 pt-4 pb-6">
        {row('th-large', 'Edit dashboard layout', 'Add, resize, reorder or remove widgets.', onEditLayout)}
        {row('sliders', 'Pipeline configuration', 'Choose which pipelines this dashboard tracks.', onOpenPipelineConfig)}
      </View>
    </Popup>
  );
}

// ── Add-widget picker ────────────────────────────────────────────────────

export function AddWidgetPopup({
  visible,
  onClose,
  instances,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  /** The dashboard's current instances — drives both singleton blocking and the
   *  "N on your dashboard" counts. */
  instances: readonly WidgetInstance[];
  onAdd: (type: WidgetType) => void;
}) {
  const c = useThemeColors();
  const { hasPermission } = useAuth();
  const can = (permission: string | null) => permission === null || hasPermission(permission);

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="auto"
      // 720, not the 420 default: this is a browsable eight-item list, and
      // ux-consistency.md's "Desktop density" section calls <=420 a one-column
      // dialog. At 720 the entries pack three per row on desktop; below the
      // 768px breakpoint Popup renders a sheet and they clamp to one column.
      maxWidth={720}
      // No maxHeight on purpose. Popup only wraps its body in a ScrollView when
      // the caller has NOT set a height (`callerSetsHeight` in Popup.tsx), so an
      // explicit "85%" here capped the card and took the scroll away with it —
      // four categories of entries clipped with no way to reach the last one on
      // a short window. The default (92% centered, DraggableSheet's own 85% as a
      // sheet) scrolls.
      dimBackdrop
      title="Add a widget"
    >
      <View className="px-6 pt-4 pb-6">
        <Text className="text-xs leading-5 mb-5" style={{ color: c.textMuted }}>
          Pick what your dashboard shows. Your layout is saved on this device only — nobody else sees it.
        </Text>

        {WIDGET_CATEGORY_ORDER.map(category => {
          const types = WIDGET_TYPES.filter(t => WIDGET_META[t].category === category);
          return (
            <View key={category} className="mb-5">
              {/* Same caption shape as FilterSection (FilterPanel.tsx:141). */}
              <Text
                className="text-[10px] font-black uppercase tracking-widest mb-2.5"
                style={{ color: c.textMuted }}
              >
                {category}
              </Text>
              <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                {types.map(type => (
                  <WidgetPickerEntry
                    key={type}
                    type={type}
                    instances={instances}
                    can={can}
                    onAdd={onAdd}
                  />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </Popup>
  );
}

/**
 * One widget type as a card: what it is, what it gives you, and — when it is
 * unavailable — which of the two reasons applies.
 *
 * `addWidgetBlock` is the single source of that answer; recomputing the
 * permission/singleton test here would let the picker and `addWidget` disagree
 * about what is addable.
 */
function WidgetPickerEntry({
  type,
  instances,
  can,
  onAdd,
}: {
  type: WidgetType;
  instances: readonly WidgetInstance[];
  can: (permission: string | null) => boolean;
  onAdd: (type: WidgetType) => void;
}) {
  const c = useThemeColors();
  const meta = WIDGET_META[type];
  const blocked = addWidgetBlock(type, instances, can);
  const onDashboard = instances.filter(i => i.type === type).length;

  // The two disabled reasons read differently on purpose. "Locked" and "you
  // already have it" call for opposite responses from the user, and a single
  // grey card that says neither is the failure mode this replaces.
  const status =
    blocked === 'permission'
      ? {
          icon: 'lock',
          color: c.textDim,
          // EntityEmptyState's 'denied' voice (EntityUI.tsx:616), one line: name
          // the key so an admin can act on it, and say who to ask.
          text: `Needs the ${meta.requiredPermission} permission — ask an admin.`,
        }
      : blocked === 'singleton'
        ? { icon: 'check', color: c.success, text: 'Already on your dashboard. One is the limit.' }
        : onDashboard > 0
          ? { icon: 'plus', color: c.primary, text: `Add another — ${onDashboard} already on your dashboard` }
          : { icon: 'plus', color: c.primary, text: 'Add to dashboard' };

  const disabled = blocked !== null;
  // Locked entries stay visible and readable: the reason line keeps full
  // contrast, only the identity above it dims. ux-consistency.md:104-106 rules
  // out a tooltip as the only carrier — mobile has no hover.
  const identityOpacity = blocked === 'permission' ? 0.5 : 1;

  return (
    <TouchableOpacity
      onPress={() => onAdd(type)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={disabled ? `${meta.title}. ${status.text}` : `Add ${meta.title}. ${meta.blurb}`}
      className="rounded-2xl p-3.5 active:scale-[0.98] transition-transform"
      style={[
        ENTRY_FLEX,
        {
          minHeight: 44,
          borderWidth: 1,
          borderColor: c.border,
          // Recessed, not greyed: an unavailable entry sits on the page
          // background so it reads as "not a card you can pick" without
          // bleaching the reason text underneath it.
          backgroundColor: disabled ? c.background : c.card,
        },
      ]}
    >
      <View className="flex-row items-center gap-2.5" style={{ opacity: identityOpacity }}>
        <View
          className="items-center justify-center"
          style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            backgroundColor: (disabled ? c.textMuted : c.primary) + '14',
            borderWidth: 1,
            borderColor: (disabled ? c.textMuted : c.primary) + '2E',
          }}
        >
          <FontAwesome name={meta.icon as never} size={14} color={disabled ? c.textMuted : c.primary} />
        </View>
        <Text className="flex-1 text-sm font-bold" numberOfLines={1} style={{ color: c.textMain }}>
          {meta.title}
        </Text>
      </View>

      <Text
        className="text-[11px] leading-4 mt-2.5"
        style={{ color: c.textMuted, opacity: identityOpacity }}
      >
        {meta.blurb}
      </Text>

      <View className="flex-row items-start gap-1.5 mt-2.5">
        <FontAwesome name={status.icon as never} size={10} color={status.color} style={{ marginTop: 2 }} />
        <Text className="flex-1 text-[10px] font-semibold leading-4" style={{ color: status.color }}>
          {status.text}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Per-instance config sheet ────────────────────────────────────────────

/**
 * Renders one widget instance's `configFields`. Every field is a bounded
 * `select` — there is exactly one field kind, so this maps options to chips and
 * stops. No form engine, no field-type registry, no validation layer.
 *
 * Auto-apply, no Save/Cancel, no draft copy — the same contract the filter
 * panels agreed on (ux-consistency.md:131-135). It writes straight through
 * `onChange`, so there is no mirrored state to resync.
 */
export function WidgetConfigPopup({
  visible,
  onClose,
  instance,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  /** Null while no widget is being configured. */
  instance: WidgetInstance | null;
  onChange: (key: string, value: string) => void;
}) {
  const c = useThemeColors();
  const meta = instance ? WIDGET_META[instance.type] : null;
  // WidgetShell only offers the gear when configFields is non-empty, so an
  // empty sheet is unreachable rather than something to design an empty state for.
  if (!instance || !meta || meta.configFields.length === 0) return null;

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="auto"
      // One or two selects is a single decision — ux-consistency.md:225 lists
      // 400-512 as correct for that and says not to widen it.
      maxWidth={420}
      dimBackdrop
      title={meta.title}
    >
      <View className="px-6 pt-4 pb-6">
        <Text className="text-xs leading-5 mb-5" style={{ color: c.textMuted }}>
          Changes apply as you pick them. Close when you're done.
        </Text>

        {meta.configFields.map(field => {
          const current = instance.config[field.key] ?? field.default;
          return (
            <View key={field.key} className="mb-5">
              <Text
                className="text-[10px] font-black uppercase tracking-widest mb-2.5"
                style={{ color: c.textMuted }}
              >
                {field.label}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {field.options.map(option => (
                  <FilterChip
                    key={option.value}
                    label={option.label}
                    active={option.value === current}
                    onPress={() => onChange(field.key, option.value)}
                    // 44px tap target. SegmentedControl's 'md' is 38px, below the
                    // ui-style-guide.md:38 floor, and these chips are what
                    // ux-consistency.md:143 asks for at 2-6 options anyway.
                    touchTarget
                  />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </Popup>
  );
}

// ponytail: no tooltip repeating the disabled reason — the inline line already
// carries it on both platforms, and a tooltip that says the same string is a
// second node to keep in sync. Add one only if the reason ever gets truncated.
// ponytail: the picker stays open after an add, so several widgets can be added
// in one pass; the entry's own status line is the feedback ("Already on your
// dashboard" / the bumped count). Close-on-add if that ever reads as no-op.
// ponytail: no picker empty state — `recent-activity` requires no permission and
// is not a singleton, so at least one entry is always addable. If a future type
// set can be fully blocked, add one here.
