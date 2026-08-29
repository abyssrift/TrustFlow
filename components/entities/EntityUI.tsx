import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import Tooltip from '@/components/common/Tooltip';
import { EmptyState } from '@/components/common/EmptyState';
import { useThemeColors } from '@/hooks/useThemeColors';
import { EMPTY_STATE_DEFAULTS } from '@/lib/emptyState';
import {
  ENTITY_META,
  ageColor,
  dueColor,
  fmtDue,
  initials,
  projectHealth,
  toneColor,
  type EntityKind,
  type PresentationColors,
} from '@/lib/projectPresentation';

export type { EntityKind } from '@/lib/projectPresentation';
export { ENTITY_META, ageColor, dueColor, fmtDate, fmtDue, initials, projectHealth } from '@/lib/projectPresentation';
export type ThemeColors = ReturnType<typeof useThemeColors>;

/**
 * Phase 8 (#187, plan §14 + §17) — THE shared vocabulary for every projects
 * surface. Phase 10 (§16) puts projects on the dashboard, Intelligence
 * Overview, the calendar, the Timeline and the deadline strip; §16.1 says the
 * failure mode is each surface inventing its own card. This file is what
 * those surfaces import instead.
 *
 * The problem it solves is §17's, not "make it prettier": the average user
 * cannot tell a portfolio from a project from a pipeline from a task. So
 * identity here is carried by three devices that each mean something, and
 * that are consistent everywhere:
 *
 *   shape  — circle = a who; square = one body of work; stacked square = a
 *            group of them; a flow mark = a route work travels; a dashed
 *            square = a pattern, not a real instance; a tick = one unit.
 *   fill   — tinted = a real instance you can open. Outlined = a container or
 *            a route. Dashed = a blueprint.
 *   hue    — fixed per entity (lib/projectPresentation.ts), except a project,
 *            which wears its own colour when it has one.
 *
 * TYPOGRAPHY RULE, and it is the main reason these screens felt loud: the app
 * had reached `font-black uppercase tracking-widest` on every label, value and
 * button, so nothing could be more important than anything else. Here,
 * uppercase letter-spaced type is reserved for ONE job — naming which entity
 * you are looking at (`EntityTag`) and column headers. Data reads as data.
 *
 * INLINE STYLES: colours here are per-entity and per-value (a project's own
 * colour, a stage's colour, a health tone), which static Tailwind classes
 * cannot express, and several of these render inside RN `Modal`s on web where
 * token classes go black. Same sanctioned exception documented in
 * `Tooltip.tsx` and `ProjectHeader.tsx`. Layout and surfaces still use tokens.
 */

// ── Identity ───────────────────────────────────────────────────────────────

export function entityColor(kind: EntityKind, c: ThemeColors, override?: string | null): string {
  if (override) return override;
  return c[ENTITY_META[kind].tone as keyof PresentationColors] as string;
}

/** The identity mark. Never render an entity's name without one of these next to it. */
export function EntityGlyph({
  kind,
  size = 32,
  color,
  name,
  style,
}: {
  kind: EntityKind;
  size?: number;
  /** A project's own colour. Omit to use the entity's fixed hue. */
  color?: string | null;
  /** Used for the monogram on monogram entities (client). */
  name?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useThemeColors();
  const meta = ENTITY_META[kind];
  const hue = entityColor(kind, c, color);
  const outlined = meta.shape === 'flow';
  const dashed = meta.shape === 'blueprint';
  const radius =
    meta.shape === 'circle' ? size / 2 : meta.shape === 'tick' ? size * 0.34 : size * 0.3;

  const face = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: outlined ? 'transparent' : hue + (dashed ? '10' : '1F'),
        borderWidth: 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: hue + (outlined || dashed ? '99' : '3D'),
      }}
    >
      {meta.icon ? (
        <FontAwesome name={meta.icon as any} size={Math.round(size * 0.42)} color={hue} />
      ) : (
        <Text style={{ color: hue, fontSize: Math.round(size * 0.36), fontWeight: '800' }}>{initials(name ?? null)}</Text>
      )}
    </View>
  );

  if (meta.shape !== 'stack') return <View style={style}>{face}</View>;

  // A portfolio is literally "more than one project" — so its mark is the
  // project square with another one behind it. Offset, not decorative.
  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          position: 'absolute',
          right: -3,
          bottom: -3,
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: hue + '14',
          borderWidth: 1,
          borderColor: hue + '2E',
        }}
      />
      {face}
    </View>
  );
}

/**
 * The eyebrow that names the entity. §17's naming fix: every projects surface
 * says out loud which of the four things you are looking at.
 */
export function EntityTag({
  kind,
  color,
  style,
}: {
  kind: EntityKind;
  color?: string | null;
  style?: StyleProp<TextStyle>;
}) {
  const c = useThemeColors();
  return (
    <Text
      style={[{ color: entityColor(kind, c, color), fontSize: 9, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' }, style]}
    >
      {ENTITY_META[kind].label}
    </Text>
  );
}

/** Glyph + eyebrow + name. The one heading treatment for an entity anywhere. */
export function EntityHeading({
  kind,
  title,
  subtitle,
  color,
  size = 'md',
  right,
}: {
  kind: EntityKind;
  title: string;
  subtitle?: React.ReactNode;
  color?: string | null;
  size?: 'sm' | 'md' | 'lg';
  right?: React.ReactNode;
}) {
  const glyphSize = size === 'lg' ? 48 : size === 'sm' ? 28 : 38;
  const titleClass =
    size === 'lg' ? 'text-2xl md:text-3xl' : size === 'sm' ? 'text-sm' : 'text-lg md:text-xl';
  return (
    <View className="flex-row items-center gap-3 flex-1">
      <EntityGlyph kind={kind} size={glyphSize} color={color} name={title} />
      <View className="flex-1 min-w-0">
        <EntityTag kind={kind} color={color} />
        <Text numberOfLines={1} className={`text-typography-main font-black tracking-tight ${titleClass}`}>
          {title}
        </Text>
        {typeof subtitle === 'string'
          ? !!subtitle && <Text numberOfLines={1} className="text-typography-muted text-xs mt-0.5">{subtitle}</Text>
          : subtitle}
      </View>
      {right}
    </View>
  );
}

/** Client identity — a circle, because a client is a who, not a what. */
export function ClientMark({
  name,
  portfolioName,
  size = 22,
}: {
  name?: string | null;
  portfolioName?: string | null;
  size?: number;
}) {
  if (!name && !portfolioName) {
    return <Text className="text-typography-dim text-[11px]">No client yet</Text>;
  }
  // Both names on one narrow line used to truncate to "Northg… · Statutory …",
  // i.e. neither was readable — seen on a 320px board card and in the list's
  // Project column. The client is the one a human needs first, so the
  // portfolio shrinks three times as fast, and the tooltip carries both in
  // full so the truncation is always recoverable.
  const full = [name, portfolioName].filter(Boolean).join(' · ');
  return (
    <Tooltip label={full}>
      <View className="flex-row items-center gap-1.5 flex-shrink min-w-0">
        {!!name && (
          <>
            <EntityGlyph kind="client" size={size} name={name} />
            <Text numberOfLines={1} style={{ flexShrink: 1 }} className="text-typography-muted text-[11px] font-semibold">{name}</Text>
          </>
        )}
        {!!portfolioName && (
          <>
            {!!name && <Text className="text-typography-dim text-[11px]">·</Text>}
            <EntityGlyph kind="portfolio" size={Math.round(size * 0.72)} />
            <Text numberOfLines={1} style={{ flexShrink: 3 }} className="text-typography-muted text-[11px] font-semibold">{portfolioName}</Text>
          </>
        )}
      </View>
    </Tooltip>
  );
}

// ── State ──────────────────────────────────────────────────────────────────

/** Stage as a chip. The one definition — table, board, header and picker share it. */
export function StageChip({
  name,
  color,
  size = 'md',
  onPress,
  disabled,
  disabledReason,
  trailingIcon,
}: {
  name?: string | null;
  color?: string | null;
  size?: 'sm' | 'md';
  onPress?: () => void;
  disabled?: boolean;
  /** §14.2 — a disabled control must be able to say why. */
  disabledReason?: string;
  trailingIcon?: string;
}) {
  const c = useThemeColors();
  const dot = size === 'sm' ? 6 : 8;
  const body = (
    <View
      className={`flex-row items-center gap-1.5 self-start rounded-full border ${size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1'}`}
      style={{
        borderColor: name ? (color ?? c.primary) + '4D' : c.border,
        backgroundColor: name ? (color ?? c.primary) + '14' : 'transparent',
        opacity: disabled && onPress ? 0.55 : 1,
        minHeight: onPress ? 32 : undefined,
      }}
    >
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: name ? (color ?? c.primary) : c.textDim }} />
      <Text numberOfLines={1} className={`font-bold ${size === 'sm' ? 'text-[10px]' : 'text-[11px]'}`} style={{ color: name ? c.textMain : c.textDim }}>
        {name || 'No stage'}
      </Text>
      {!!trailingIcon && <FontAwesome name={trailingIcon as any} size={9} color={c.textMuted} />}
    </View>
  );

  if (!onPress) return body;
  const control = (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={name ? `Stage: ${name}. Move to another stage` : 'Put this project on a stage'}
    >
      {body}
    </TouchableOpacity>
  );
  const hint = disabled ? disabledReason : name ? 'Move to another stage' : 'Put this project on a stage';
  return hint ? <Tooltip label={hint}>{control}</Tooltip> : control;
}

/**
 * "Should I look at this?" in one badge, everywhere. Precedence and wording
 * live in lib/projectPresentation.ts and are asserted by its check file.
 */
export function HealthBadge({
  blocked,
  blockedReason,
  flags,
  daysRemaining,
  showHealthy = true,
  size = 'md',
}: {
  blocked?: boolean | null;
  blockedReason?: string | null;
  flags?: readonly string[] | null;
  daysRemaining?: number | null;
  /** Off in dense lists where only exceptions deserve ink. */
  showHealthy?: boolean;
  size?: 'sm' | 'md';
}) {
  const c = useThemeColors();
  const h = projectHealth({ blocked, blockedReason, flags, daysRemaining });
  if (h.key === 'on-track' && !showHealthy) return null;
  const tint = toneColor(h.tone, c);
  return (
    <Tooltip label={h.detail}>
      <View
        className={`flex-row items-center gap-1.5 self-start rounded-full ${size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1'}`}
        style={{ backgroundColor: tint + '1A' }}
      >
        <FontAwesome name={h.icon as any} size={size === 'sm' ? 8 : 9} color={tint} />
        <Text className={`font-black uppercase tracking-wider ${size === 'sm' ? 'text-[9px]' : 'text-[10px]'}`} style={{ color: tint }}>
          {h.label}
        </Text>
      </View>
    </Tooltip>
  );
}

/** Completion — tasks done, weighted percent, one bar. */
export function ProgressMeter({
  done,
  total,
  percent,
  tone,
  showCaption = true,
  height = 6,
}: {
  done?: number;
  total?: number;
  percent: number;
  /** Overrides the bar colour, e.g. danger while blocked. */
  tone?: string;
  showCaption?: boolean;
  height?: number;
}) {
  const c = useThemeColors();
  const pct = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  return (
    <View>
      {showCaption && (
        <View className="flex-row justify-between items-baseline mb-1">
          <Text className="text-typography-muted text-[11px] font-medium">
            {total != null ? `${done ?? 0} of ${total} task${total === 1 ? '' : 's'} done` : 'Completion'}
          </Text>
          <Text className="text-typography-main text-[11px] font-bold">{Math.round(pct)}%</Text>
        </View>
      )}
      <View className="w-full rounded-full overflow-hidden" style={{ height, backgroundColor: c.border + '80' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 999, backgroundColor: tone ?? c.primary }} />
      </View>
    </View>
  );
}

/** A label and the one number that matters for it (§14.1). */
export function MetaStat({
  label,
  value,
  color,
  hint,
  align = 'left',
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
  align?: 'left' | 'right';
}) {
  const body = (
    <View className={align === 'right' ? 'items-end' : ''}>
      <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em]">{label}</Text>
      <Text
        numberOfLines={1}
        className={`text-sm font-bold mt-0.5 ${color ? '' : 'text-typography-main'}`}
        style={color ? { color } : undefined}
      >
        {value}
      </Text>
    </View>
  );
  return hint ? <Tooltip label={hint}>{body}</Tooltip> : body;
}

// ── The project card ───────────────────────────────────────────────────────

/**
 * Structural subset satisfied by rpc_projects_table rows and by the board's
 * narrower row shape alike — so one card serves the table, the board and
 * (Phase 10) every other surface, without any of them widening its query.
 */
export type ProjectCardRow = {
  id: string;
  name: string;
  color?: string | null;
  client_name?: string | null;
  portfolio_name?: string | null;
  stage_name?: string | null;
  stage_color?: string | null;
  days_in_current_stage?: number | null;
  due_date?: string | null;
  days_remaining?: number | null;
  tasks_total?: number;
  tasks_done?: number;
  weighted_progress?: number;
  owner_id?: string | null;
  owner_name?: string | null;
  blocked?: boolean;
  blocked_reason?: string | null;
};

export function ProjectCard({
  row,
  onPress,
  actions,
  innerRef,
  dimmed,
  highlighted,
  showOwner = false,
  footer,
}: {
  row: ProjectCardRow;
  onPress: () => void;
  /** Row-level menu / move button, top-right. §17: reachable where the user is looking. */
  actions?: React.ReactNode;
  /** For useDragSource — the board attaches its drag ref to the card itself. */
  innerRef?: React.Ref<any>;
  dimmed?: boolean;
  highlighted?: boolean;
  showOwner?: boolean;
  footer?: React.ReactNode;
}) {
  const c = useThemeColors();
  const blocked = !!row.blocked;
  return (
    <TouchableOpacity
      ref={innerRef}
      onPress={onPress}
      disabled={dimmed}
      // NO accessibilityRole="button" here, deliberately. react-native-web
      // emits a real <button> element for that role, and this card contains
      // its own buttons (move / actions) — nesting them makes React log
      // "<button> cannot contain a nested <button>", which Expo's LogBox
      // then shows the user as a red error toast on top of the board. Caught
      // by driving the board in a browser, not by tsc. RNW still gives the
      // card role="button" + keyboard focus without the invalid element.
      accessibilityLabel={`Open ${row.name}`}
      className="bg-surface-card rounded-2xl p-3.5 border hover:border-brand-primary/40 transition-colors"
      style={{
        borderColor: highlighted ? c.primary : c.border,
        borderWidth: highlighted ? 1.5 : 1,
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <View className="flex-row items-start gap-2.5">
        <EntityGlyph kind="project" size={30} color={row.color} />
        <View className="flex-1 min-w-0">
          <Text numberOfLines={2} className="text-typography-main font-bold text-sm leading-5">{row.name}</Text>
          <View className="mt-1">
            <ClientMark name={row.client_name} portfolioName={row.portfolio_name} size={16} />
          </View>
        </View>
        {actions}
      </View>

      <View className="flex-row items-center flex-wrap gap-1.5 mt-3">
        <StageChip name={row.stage_name} color={row.stage_color} size="sm" />
        <HealthBadge
          blocked={row.blocked}
          blockedReason={row.blocked_reason}
          daysRemaining={row.days_remaining}
          showHealthy={false}
          size="sm"
        />
        <Text className="text-[11px] font-semibold" style={{ color: ageColor(row.days_in_current_stage ?? null, c) }}>
          {row.days_in_current_stage == null ? 'Not staged yet' : `${row.days_in_current_stage}d here`}
        </Text>
      </View>

      <View className="mt-3">
        <ProgressMeter
          done={row.tasks_done}
          total={row.tasks_total}
          percent={row.weighted_progress ?? 0}
          tone={blocked ? c.danger : undefined}
        />
      </View>

      <View className="flex-row items-center justify-between mt-2.5">
        <Text className="text-[11px] font-semibold" style={{ color: dueColor(row.days_remaining ?? null, c) }}>
          {fmtDue(row.days_remaining ?? null, row.due_date ?? null)}
        </Text>
        {showOwner && (
          row.owner_name ? (
            <View className="flex-row items-center gap-1.5 flex-shrink min-w-0">
              <EntityGlyph kind="client" size={18} name={row.owner_name} />
              <Text numberOfLines={1} className="text-typography-muted text-[11px] font-semibold flex-shrink">{row.owner_name}</Text>
            </View>
          ) : (
            <Text className="text-typography-dim text-[11px]">Nobody assigned</Text>
          )
        )}
      </View>
      {footer}
    </TouchableOpacity>
  );
}

// ── Containers, empties, controls ──────────────────────────────────────────

/** One section surface. Optional entity tag so a panel says what it is about. */
export function SectionCard({
  title,
  hint,
  kind,
  icon,
  right,
  accent,
  children,
  className,
}: {
  title: string;
  hint?: string;
  kind?: EntityKind;
  icon?: string;
  right?: React.ReactNode;
  accent?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const c = useThemeColors();
  return (
    <View
      className={`bg-surface-card border rounded-2xl p-4 md:p-5 ${className ?? ''}`}
      style={{ borderColor: accent ? accent + '55' : c.border }}
    >
      <View className="flex-row items-start justify-between gap-3 mb-4">
        <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
          {kind ? (
            <EntityGlyph kind={kind} size={26} />
          ) : icon ? (
            <FontAwesome name={icon as any} size={13} color={accent || c.primary} />
          ) : null}
          <View className="flex-1 min-w-0">
            {!!kind && <EntityTag kind={kind} />}
            <Text className="text-typography-main text-sm font-bold">{title}</Text>
            {!!hint && <Text className="text-typography-muted text-[11px] mt-0.5">{hint}</Text>}
          </View>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/**
 * §17: "an empty state on every projects surface that explains the entity
 * rather than saying 'No projects'." The blurb is the entity's own sentence
 * from lib/projectPresentation.ts, so the explanation cannot drift per screen.
 *
 * Issue #245 — the one shared empty/unavailable-state primitive for the whole
 * app, not just the projects domain. `kind` is now optional so a screen with
 * no natural EntityKind (notifications, admin lists, a report) can still use
 * this instead of hand-rolling its own icon+title+body block. `variant`
 * covers the other three surfaces the issue calls out — "no permission" and
 * "feature unavailable" both render the same lock badge the app already used
 * ad hoc (see `_analytics_desktop.tsx`'s `PlanGate` / "Access Restricted"),
 * so this doesn't invent a new icon language, it just gives the existing one
 * one home. "Loading-empty" is deliberately NOT a variant here — that's
 * `SkeletonBlock`/`SkeletonList` (components/Skeleton.tsx), a different
 * pattern (a placeholder shape, not a message), already used everywhere this
 * component is.
 */
export function EntityEmptyState({
  kind,
  variant = 'empty',
  title,
  body,
  icon,
  actionLabel,
  onAction,
  actionIcon = 'plus',
  secondaryLabel,
  onSecondary,
  compact,
}: {
  /** Omit for a surface with no natural entity (e.g. notifications, a report). */
  kind?: EntityKind;
  /** 'empty' = no data yet (default). 'denied' = lacks permission. 'unavailable' = feature/plan gated. */
  variant?: 'empty' | 'denied' | 'unavailable';
  /** Defaults to "No <plural> here yet" ('empty') or a variant default. Pass one when the situation is narrower. */
  title?: string;
  /** Defaults to the entity's own explanation ('empty') or a variant default. Pass one to say what would fix THIS screen. */
  body?: string;
  /** FontAwesome name overriding the glyph. Only used for 'denied'/'unavailable' or when kind is omitted — 'empty' with a kind always uses that entity's own glyph. */
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  compact?: boolean;
}) {
  const meta = kind ? ENTITY_META[kind] : null;
  const VARIANT_COPY = {
    empty: { icon: meta?.icon || 'inbox', title: meta ? `No ${meta.plural.toLowerCase()} here yet` : 'Nothing here yet', body: meta?.blurb ?? '' },
    denied: EMPTY_STATE_DEFAULTS.denied,
    unavailable: EMPTY_STATE_DEFAULTS.unavailable,
  } as const;
  const d = VARIANT_COPY[variant];
  const glyphSize = compact ? 40 : 54;
  const useEntityGlyph = variant === 'empty' && !!kind;

  return (
    <EmptyState
      icon={(icon ?? d.icon) as any}
      visual={useEntityGlyph ? <EntityGlyph kind={kind!} size={glyphSize} /> : undefined}
      title={title ?? d.title}
      body={body ?? d.body}
      actionLabel={actionLabel}
      onAction={onAction}
      actionIcon={actionIcon as any}
      secondaryLabel={secondaryLabel}
      onSecondary={onSecondary}
      compact={compact}
    />
  );
}

/**
 * One control instead of N bordered buttons. The projects screens had three
 * separately-outlined toggles side by side, each competing with the page's
 * primary action — this reads as a single object with one selected state.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string; icon?: string; disabled?: boolean; disabledReason?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  const c = useThemeColors();
  return (
    <View className="flex-row items-center bg-surface-card border border-surface-border rounded-xl p-1 self-start">
      {options.map(opt => {
        const active = opt.value === value;
        const btn = (
          <TouchableOpacity
            key={opt.value}
            onPress={() => !opt.disabled && onChange(opt.value)}
            disabled={opt.disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !!opt.disabled }}
            className={`flex-row items-center justify-center gap-2 rounded-lg ${size === 'sm' ? 'px-3' : 'px-4'}`}
            style={{
              minHeight: size === 'sm' ? 32 : 38,
              backgroundColor: active ? c.primary + '1F' : 'transparent',
              opacity: opt.disabled ? 0.45 : 1,
            }}
          >
            {!!opt.icon && <FontAwesome name={opt.icon as any} size={11} color={active ? c.primary : c.textMuted} />}
            <Text className={`text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{opt.label}</Text>
          </TouchableOpacity>
        );
        // §14.2 — a disabled control must always be able to say why.
        return opt.disabled && opt.disabledReason ? (
          <Tooltip key={opt.value} label={opt.disabledReason}>{btn}</Tooltip>
        ) : btn;
      })}
    </View>
  );
}

/** A filter chip. Same shape everywhere, so a filter never looks like an action. */
export function FilterChip({
  label,
  active,
  onPress,
  dotColor,
  icon,
  count,
  touchTarget,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  dotColor?: string | null;
  icon?: string;
  count?: number;
  /** Mobile needs 44px; desktop filter rows stay compact. */
  touchTarget?: boolean;
}) {
  const c = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      className={`flex-row items-center gap-1.5 rounded-full border px-3 ${touchTarget ? 'justify-center' : 'py-1.5'}`}
      style={{
        minHeight: touchTarget ? 44 : undefined,
        borderColor: active ? c.primary : c.border,
        backgroundColor: active ? c.primary + '1A' : 'transparent',
      }}
    >
      {!!dotColor && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor }} />}
      {!!icon && <FontAwesome name={icon as any} size={10} color={active ? c.primary : c.textMuted} />}
      <Text numberOfLines={1} className={`text-[11px] font-semibold ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{label}</Text>
      {count != null && (
        <Text className={`text-[10px] font-bold ${active ? 'text-brand-primary' : 'text-typography-dim'}`}>{count}</Text>
      )}
    </TouchableOpacity>
  );
}
