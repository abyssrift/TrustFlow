import Tooltip from '@/components/common/Tooltip';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import SlideDownPanel from './SlideDownPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Shared filter UI, standardized from the ad-hoc filter bars scattered across
// the app (issue #208 + the related "standardize filter modals" work).
//
// Two layers, per the agreed architecture:
//   - SlideDownPanel        — the animated expand/collapse primitive (no trigger)
//   - FilterPanel           — composes SlideDownPanel with a trigger + optional
//                             footer/apply row (for surface 2, Reports)
//   - FilterSection/Chip    — presentational styling primitives shared by BOTH
//                             the animated panels (1–3) and the always-inline
//                             filter rows (4–8), so a Reports panel and a
//                             Projects filter row speak the same visual language.
// ─────────────────────────────────────────────────────────────────────────────

interface FilterPanelProps {
  /**
   * The trigger. Either a render-prop `({ isOpen, toggle }) => ReactNode` for
   * callers that already have a custom button (desktop/mobile shells that want
   * to keep their own styling and badge), or — the common case — pass
   * `label`/`icon` and a default brand-styled trigger is rendered.
   */
  trigger?: (props: { isOpen: boolean; toggle: () => void }) => React.ReactNode;
  /** Short label for the default trigger (e.g. "Filters"). */
  label?: string;
  /** FontAwesome icon for the default trigger (e.g. "sliders" or "filter"). */
  icon?: string;
  /** Show an active-count badge on the default trigger when > 0. */
  activeCount?: number;
  /** Controlled-mode overrides (standard controlled/uncontrolled dual API).
   *  Tasks board uses controlled mode since it already shares one boolean
   *  across desktop + mobile-web shells; everything else can use internal
   *  state and stop threading a boolean through props. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Filter body content. */
  children: React.ReactNode;
  /** Rendered inside the panel, below `children` (Apply/Clear row — surface 2). */
  footer?: React.ReactNode;
  /** Lazy-mount content on first open, then keep it mounted. Default true. */
  lazyMount?: boolean;
  /** Mobile: cap the animated region and scroll internally. */
  maxHeight?: number;
  /** Open/close animation duration in ms. Default 220. */
  duration?: number;
  /** Passed to the panel container. */
  style?: StyleProp<ViewStyle>;
  /** When the panel is disabled, the trigger is inert (e.g. no items to filter). */
  disabled?: boolean;
  /** Tooltip label for the default trigger (defaults to `label`). */
  tooltip?: string;
}

/**
 * Composed filter pattern: a trigger button that slides a panel open beneath it
 * (issue #208 standardization). Wraps SlideDownPanel. Defaults to internal
 * open/close state; pass `isOpen`/`onOpenChange` to control it from outside.
 */
export default function FilterPanel({
  trigger,
  label = 'Filters',
  icon = 'filter',
  activeCount = 0,
  isOpen: controlledOpen,
  onOpenChange,
  children,
  footer,
  lazyMount = true,
  maxHeight,
  duration,
  style,
  disabled = false,
  tooltip,
}: FilterPanelProps) {
  const colors = useThemeColors();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const toggle = () => {
    if (disabled) return;
    if (isControlled) onOpenChange?.(!isOpen);
    else setInternalOpen((v) => !v);
  };

  const defaultTrigger = (
    <TouchableOpacity
      onPress={toggle}
      disabled={disabled}
      className={`h-10 px-4 flex-row items-center gap-2 rounded-xl border ${
        isOpen || activeCount > 0 ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <FontAwesome name={icon as any} size={12} color={isOpen || activeCount > 0 ? colors.primary : colors.textMuted} />
      <Text className={`font-black uppercase tracking-widest text-[10px] ${isOpen || activeCount > 0 ? 'text-brand-primary' : 'text-typography-muted'}`}>
        {label}
      </Text>
      {activeCount > 0 && (
        <View className="ml-0.5 min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand-primary items-center justify-center">
          <Text className="text-white text-[9px] font-black">{activeCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderedTrigger = trigger
    ? trigger({ isOpen, toggle })
    : tooltip
      ? <Tooltip label={tooltip}>{defaultTrigger}</Tooltip>
      : defaultTrigger;

  return (
    <View style={style}>
      {renderedTrigger}
      <SlideDownPanel isOpen={isOpen} lazyMount={lazyMount} maxHeight={maxHeight} duration={duration}>
        {children}
        {footer}
      </SlideDownPanel>
    </View>
  );
}

// ─── Presentational primitives (shared by animated panels 1–3 and inline rows 4–8) ──

interface FilterSectionProps {
  /** Section label, e.g. "Priority". */
  label: string;
  children: React.ReactNode;
  /** Compact spacing variant (inline/desktop rows). Default desktop spacing. */
  compact?: boolean;
}

/** A labelled group inside a filter surface — same look whether it sits in an
 *  animated panel or an always-inline bar. */
export function FilterSection({ label, children, compact }: FilterSectionProps) {
  return (
    <View className={compact ? 'mb-2' : 'mb-4'}>
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1.5">
        {label}
      </Text>
      {children}
    </View>
  );
}

interface FilterChipGroupProps {
  /** Render chips; each chip should be a TouchableOpacity styled via the
   *  shared `FilterChip` from EntityUI or `chipClass` conventions. */
  children: React.ReactNode;
  /** Rows vertically when false (inline sections), scrolls horizontally when
   *  true (overflow-friendly groups). Default vertical wrap. */
  horizontal?: boolean;
}

/** A row of filter chips with consistent spacing. */
export function FilterChipGroup({ children, horizontal = false }: FilterChipGroupProps) {
  if (horizontal) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {children}
      </ScrollView>
    );
  }
  return <View className="flex-row flex-wrap gap-2">{children}</View>;
}

// ─── Dropdown-style filter control (tasks board, #208) ──

interface FilterDropdownOption {
  value: string;
  label: string;
  /** Optional per-option text color class (e.g. priority tones). */
  textClass?: string;
}

interface FilterDropdownProps {
  /** Section / trigger label, e.g. "Priority". */
  label: string;
  /** Number of active selections (badge on the trigger). */
  count: number;
  /** Currently selected values. */
  selected: string[];
  /** Selectable options. */
  options: FilterDropdownOption[];
  /** Toggle an option on/off (multi-select) or select it (single-select). */
  onToggle: (value: string) => void;
  /** Single-select mode (e.g. Sort By) — picking an option closes the menu. */
  single?: boolean;
}

/**
 * A compact dropdown filter row — trigger with label + active-count badge +
 * chevron, toggling an inline option list. One such dropdown per filter
 * dimension replaces the old horizontal chip wall, keeping the slide-down panel
 * compact and scannable.
 */
export function FilterDropdown({ label, count, selected, options, onToggle, single }: FilterDropdownProps) {
  const colors = useThemeColors();
  const [open, setOpen] = React.useState(false);
  const active = count > 0;

  return (
    <View className="rounded-xl border" style={{ borderColor: active ? colors.primary : colors.border, backgroundColor: colors.card }}>
      <TouchableOpacity
        onPress={() => setOpen(v => !v)}
        className="flex-row items-center justify-between px-3.5 py-3 rounded-xl"
      >
        <View className="flex-row items-center gap-2">
          <Text className={`font-black uppercase tracking-widest text-[10px] ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{label}</Text>
          {active && (
            <View className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand-primary items-center justify-center">
              <Text className="text-white text-[9px] font-black">{count}</Text>
            </View>
          )}
        </View>
        <FontAwesome name={open ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
      </TouchableOpacity>

      {open && (
        <View className="px-2 pb-2 pt-1 border-t" style={{ borderColor: colors.border }}>
          <ScrollView
            style={{ maxHeight: 220 }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {options.map(opt => {
              const isActive = selected.includes(opt.value);
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => {
                    onToggle(opt.value);
                    if (single) setOpen(false);
                  }}
                  className="flex-row items-center px-3 py-2 rounded-lg hover:bg-surface-overlay"
                  style={{ backgroundColor: isActive ? colors.primary + '0D' : undefined }}
                >
                  <Text className={`flex-1 font-bold text-[11px] ${isActive ? 'text-brand-primary' : opt.textClass ?? 'text-typography-muted'}`}>
                    {opt.label}
                  </Text>
                  {isActive && <FontAwesome name="check" size={10} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}