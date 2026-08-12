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

import ClipboardControls from '@/components/common/ClipboardControls';
import Popup from '@/components/common/Popup';
import { FilterChip } from '@/components/entities/EntityUI';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  LAYOUT_PRESETS,
  buildPreset,
  decodeLayout,
  describeBuild,
  encodeLayout,
  isLayoutError,
  type LayoutBuild,
  type LayoutPreset,
} from '@/lib/dashboardLayoutCodes';
import {
  WIDGET_CATEGORY_ORDER,
  WIDGET_META,
  WIDGET_TYPES,
  addWidgetBlock,
  type WidgetInstance,
  type WidgetType,
} from '@/lib/dashboardWidgets';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

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
  onOpenPresets,
}: {
  visible: boolean;
  onClose: () => void;
  onEditLayout: () => void;
  onOpenPipelineConfig: () => void;
  onOpenPresets: () => void;
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
    // Three rows and no columns to give them — 420 is what ux-consistency.md
    // calls correct for a single decision, and says not to widen.
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420} dimBackdrop title="Dashboard">
      <View className="px-6 pt-4 pb-6">
        {row('th-large', 'Edit dashboard layout', 'Add, resize, reorder or remove widgets.', onEditLayout)}
        {row('magic', 'Presets and layout codes', 'Start from a ready-made layout, or copy this one to share it.', onOpenPresets)}
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

// ── Presets and layout codes ─────────────────────────────────────────────

/**
 * One popup for both ways of replacing a layout, because they are one
 * operation: a preset and a pasted code both become a validated instance list
 * via lib/dashboardLayoutCodes.ts and both go through `onApply`.
 *
 * It is reached from the sliders menu rather than from a fourth header button —
 * the adaptive header is already full at 390px (see DashboardMenuPopup).
 */
export function DashboardLayoutPopup({
  visible,
  onClose,
  instances,
  onApply,
  onUndo,
  canUndo,
}: {
  visible: boolean;
  onClose: () => void;
  /** The dashboard as it stands — what "Copy layout code" encodes. */
  instances: readonly WidgetInstance[];
  onApply: (next: WidgetInstance[]) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const c = useThemeColors();
  const { hasPermission } = useAuth();
  const { showToast, successToast } = useToast();
  const can = (permission: string | null) => permission === null || hasPermission(permission);

  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);

  // A code left in the field from last time would be previewed against a layout
  // it no longer describes.
  useEffect(() => { if (!visible) { setPasted(''); setCopied(false); } }, [visible]);

  const code = encodeLayout(instances);

  // Recomputed every render rather than memoized: it is a string parse over at
  // most 24 entries, and `can` is a new function identity on every render
  // anyway (AuthContext rebuilds hasPermission), so a memo would be a lie.
  const preview = pasted.trim() === '' ? null : decodeLayout(pasted, { can });

  /**
   * The one apply path the UI has. Replaces, closes, and hands back an Undo —
   * offered as a toast action because that is where the user is looking after
   * the popup closes, and GlobalToastOverlay already renders `actionLabel`.
   */
  const apply = (build: LayoutBuild, what: string) => {
    onApply(build.instances);
    onClose();
    showToast({
      type: 'success',
      title: what,
      message: describeBuild(build),
      // Long enough to read a two-clause sentence and still act on it.
      duration: 9000,
      actionLabel: 'Undo',
      onPress: onUndo,
    });
  };

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    successToast('Layout code copied. Paste it anywhere to rebuild this dashboard.', 'Copied');
  };

  const caption = (text: string) => (
    <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5" style={{ color: c.textMuted }}>
      {text}
    </Text>
  );

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="auto"
      // 560, not the 420 single-decision default: this is three stacked
      // decisions and the code itself needs a line it can breathe on. Below
      // Popup's 768px breakpoint it renders as a sheet and everything here is
      // already one column, so mobile web needs no second layout.
      maxWidth={560}
      dimBackdrop
      title="Presets and layout codes"
    >
      <View className="px-6 pt-4 pb-6">
        {/* ── Presets ── */}
        {caption('Start from a preset')}
        <Text className="text-xs leading-5 mb-3" style={{ color: c.textMuted }}>
          Each one replaces what you have now. Widgets you don't have access to are left out.
        </Text>
        {LAYOUT_PRESETS.map(preset => (
          <PresetRow key={preset.id} preset={preset} can={can} onPick={apply} />
        ))}

        {/* ── Copy ── */}
        <View className="mt-5">
          {caption('Share this layout')}
          <Text className="text-xs leading-5 mb-3" style={{ color: c.textMuted }}>
            A layout code rebuilds this arrangement on another device or for someone else. It carries the
            widgets and their settings — never your data, and never which pipelines you track.
          </Text>
          <View
            className="rounded-xl px-3 py-2.5 mb-2.5"
            style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
          >
            <Text
              className="text-[11px] leading-4"
              numberOfLines={2}
              selectable
              style={{ color: c.textMuted }}
            >
              {code}
            </Text>
          </View>
          <TouchableOpacity
            onPress={copy}
            accessibilityRole="button"
            accessibilityLabel="Copy layout code to the clipboard"
            className="flex-row items-center justify-center gap-2 rounded-xl px-4"
            style={{ minHeight: 44, backgroundColor: copied ? c.success + '1F' : c.primary + '14', borderWidth: 1, borderColor: (copied ? c.success : c.primary) + '2E' }}
          >
            <FontAwesome name={copied ? 'check' : 'copy'} size={13} color={copied ? c.success : c.primary} />
            <Text className="text-xs font-bold" style={{ color: copied ? c.success : c.primary }}>
              {copied ? 'Copied' : 'Copy layout code'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Paste ── */}
        <View className="mt-5">
          <View className="flex-row items-center justify-between mb-2.5">
            {caption('Paste a layout code')}
            {/* The existing copy/paste affordance — one tap instead of a long
                press, and it is the only paste path that works on both web and
                native (navigator.clipboard is web-only and needs HTTPS). */}
            <ClipboardControls value={pasted} onPaste={setPasted} showCopy={false} />
          </View>
          <TextInput
            value={pasted}
            onChangeText={setPasted}
            placeholder="TFD1-…"
            placeholderTextColor={c.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            accessibilityLabel="Layout code"
            className="rounded-xl px-3 py-2.5 text-[11px]"
            style={{ minHeight: 62, color: c.textMain, backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
          />

          {preview !== null && (
            isLayoutError(preview) ? (
              <View className="flex-row items-start gap-2 mt-2.5">
                <FontAwesome name="exclamation-circle" size={12} color={c.danger} style={{ marginTop: 1 }} />
                <Text className="flex-1 text-[11px] leading-4 font-semibold" style={{ color: c.danger }}>
                  {preview.error}
                </Text>
              </View>
            ) : (
              <>
                {/* What will happen, BEFORE anything is replaced. */}
                <View className="flex-row items-start gap-2 mt-2.5">
                  <FontAwesome name="info-circle" size={12} color={c.info} style={{ marginTop: 1 }} />
                  <Text className="flex-1 text-[11px] leading-4" style={{ color: c.textMuted }}>
                    {describeBuild(preview)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => apply(preview, 'Layout replaced')}
                  accessibilityRole="button"
                  accessibilityLabel={`Use this layout. ${describeBuild(preview)}`}
                  className="flex-row items-center justify-center gap-2 rounded-xl px-4 mt-2.5"
                  style={{ minHeight: 44, backgroundColor: c.primary, borderWidth: 1, borderColor: c.primary }}
                >
                  {/* 'white' on a filled primary button, the idiom every other
                      filled action in the app uses — `c.card` would be dark
                      navy on a dark theme. */}
                  <Text className="text-xs font-bold" style={{ color: 'white' }}>Use this layout</Text>
                </TouchableOpacity>
              </>
            )
          )}
        </View>

        {/* Undo also lives here, not only on the toast: a toast that has already
            faded is not an affordance, and this is the surface the user was on. */}
        {canUndo && (
          <TouchableOpacity
            onPress={() => { onUndo(); onClose(); }}
            accessibilityRole="button"
            accessibilityLabel="Undo the layout change and put back the previous dashboard"
            className="flex-row items-center justify-center gap-2 rounded-xl px-4 mt-5"
            style={{ minHeight: 44, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}
          >
            <FontAwesome name="undo" size={13} color={c.textMuted} />
            <Text className="text-xs font-bold" style={{ color: c.textMuted }}>Put back my previous layout</Text>
          </TouchableOpacity>
        )}
      </View>
    </Popup>
  );
}

/**
 * One preset, priced honestly: the count it shows is what THIS viewer would
 * get, because it is built through the same permission-filtered path the tap
 * applies. A preset that mostly does not apply to you says so before you pick it.
 */
function PresetRow({
  preset,
  can,
  onPick,
}: {
  preset: LayoutPreset;
  can: (permission: string | null) => boolean;
  onPick: (build: LayoutBuild, what: string) => void;
}) {
  const c = useThemeColors();
  const build = buildPreset(preset, can);
  const denied = build.skipped.length;

  return (
    <TouchableOpacity
      onPress={() => onPick(build, `Switched to ${preset.name}`)}
      disabled={build.instances.length === 0}
      accessibilityRole="button"
      accessibilityLabel={`${preset.name}. ${preset.blurb} ${describeBuild(build)}`}
      className="flex-row items-center gap-3 rounded-2xl p-3.5 mb-2.5"
      style={{ minHeight: 44, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}
    >
      <View className="flex-1">
        <Text className="text-sm font-bold" style={{ color: c.textMain }}>{preset.name}</Text>
        <Text className="text-[11px] leading-4 mt-0.5" style={{ color: c.textMuted }}>{preset.blurb}</Text>
        <Text className="text-[10px] font-semibold mt-1.5" style={{ color: denied > 0 ? c.warning : c.textDim }}>
          {build.instances.length} widget{build.instances.length === 1 ? '' : 's'}
          {denied > 0 ? ` — ${denied} left out, you don't have access` : ''}
        </Text>
      </View>
      <FontAwesome name="angle-right" size={16} color={c.textDim} />
    </TouchableOpacity>
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
