import { EntityGlyph } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Tooltip from '../common/Tooltip';
import { MAX_PORTFOLIO_CANDIDATES, PIPELINE_ICONS, PinnedShortcut, Shortcut } from './constants';
import { usePinnedShortcuts } from './usePinnedShortcuts';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

const portfolioPinId = (id: string) => `portfolio:${id}`;

export default function PinnedShortcuts({
  visibleShortcuts,
  pipelines,
  portfolios,
  portfoliosLoading,
  onOpenChange,
}: {
  visibleShortcuts: Shortcut[];
  pipelines: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
  portfoliosLoading: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const { pinned, isPinned, togglePin, maxPinned } = usePinnedShortcuts();
  const [isHovered, setIsHovered] = useState(false);
  const [clickedOpen, setClickedOpen] = useState(false);
  const showPicker = isHovered || clickedOpen;
  const wrapperRef = useRef<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const canAdd = !!linkLabel.trim() && !!linkUrl.trim();

  const addCustomLink = () => {
    if (!canAdd || pinned.length >= maxPinned) return;
    let href = linkUrl.trim();
    // Bare paths get a leading slash; external URLs and rooted paths pass through.
    if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) href = '/' + href;
    togglePin({ id: `custom:${Date.now()}`, label: linkLabel.trim(), icon: 'link', href });
    setLinkLabel('');
    setLinkUrl('');
    setShowAdd(false);
  };

  // Hover opens the picker (same mouseenter/mouseleave escape hatch Sidebar.web.tsx
  // uses for its own hover-expand), covering both the trigger and the popover
  // itself so moving the cursor between them doesn't flicker-close it.
  useEffect(() => {
    const el = wrapperRef.current;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    const onEnter = () => setIsHovered(true);
    // Only drop the hover-open here. A click-latched picker (clickedOpen) must
    // survive the cursor leaving — it closes via the outside-click handler below.
    const onLeave = () => setIsHovered(false);
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => {
      domNode.removeEventListener('mouseenter', onEnter);
      domNode.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  // Click still works as a fallback (e.g. touch input, where hover never fires).
  useEffect(() => {
    if (!clickedOpen) return;
    const handleClick = (e: MouseEvent) => {
      const el = wrapperRef.current;
      const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
      if (domNode && !domNode.contains(e.target as Node)) {
        setClickedOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [clickedOpen]);

  // Keep the parent's interaction-lock in sync so the retractable bar won't
  // collapse while the picker is open.
  useEffect(() => {
    onOpenChange?.(showPicker);
  }, [showPicker, onOpenChange]);

  // usePortfolios() already orders by recency and filters through
  // fn_project_accessible — only the most recent MAX_PORTFOLIO_CANDIDATES
  // become pin candidates (see constants.ts for why). Anything older is still
  // reachable via the "Browse all portfolios" row below.
  const portfolioCandidates: PinnedShortcut[] = useMemo(
    () =>
      portfolios.slice(0, MAX_PORTFOLIO_CANDIDATES).map((p) => ({
        id: portfolioPinId(p.id),
        label: p.name,
        icon: 'th-large',
        href: `/portfolios/${p.id}`,
        kind: 'portfolio' as const,
      })),
    [portfolios]
  );

  const shortcutCandidates: PinnedShortcut[] = useMemo(
    () => visibleShortcuts.map((s) => ({ id: s.id, label: s.label, icon: s.icon, href: s.href })),
    [visibleShortcuts]
  );

  const pipelineCandidates: PinnedShortcut[] = useMemo(
    () =>
      pipelines.map((p, i) => ({
        id: `pipeline:${p.id}`,
        label: p.name,
        icon: PIPELINE_ICONS[i % PIPELINE_ICONS.length],
        href: `/tasks?pipelineId=${p.id}`,
      })),
    [pipelines]
  );

  const allCandidates = useMemo(
    () => [...shortcutCandidates, ...portfolioCandidates, ...pipelineCandidates],
    [shortcutCandidates, portfolioCandidates, pipelineCandidates]
  );

  // A pin whose target no longer exists in candidates — either a custom link
  // (never a candidate) or a portfolio pinned before it aged out of the top
  // MAX_PORTFOLIO_CANDIDATES. Surfaced at the top of the picker so it stays
  // unpinnable even though it's off the main lists.
  //
  // ponytail: usePortfolios() caps at 100 rows: a portfolio pinned earlier
  // that both aged past that window AND isn't in the top
  // MAX_PORTFOLIO_CANDIDATES reads the same as a genuinely revoked one below.
  // Raise the RPC's p_limit if that collision shows up in practice.
  const extraPinned = useMemo(
    () =>
      pinned.filter((p) => {
        if (allCandidates.some((c) => c.id === p.id)) return false; // already shown in its normal section
        if (p.kind !== 'portfolio') return true; // custom link
        // A portfolio pin that aged out of the top MAX_PORTFOLIO_CANDIDATES
        // still belongs here so it stays unpinnable — but check it directly
        // against the live rollup rather than trusting the cached label, so a
        // pin that's actually gone stale (access revoked / deleted) never
        // renders its name here even for one frame while the auto-unpin
        // effect below catches up.
        if (portfoliosLoading) return false;
        return portfolios.some((pf) => portfolioPinId(pf.id) === p.id);
      }),
    [pinned, allCandidates, portfoliosLoading, portfolios]
  );

  // A pinned portfolio the caller can no longer open (access revoked, or the
  // batch was deleted) must not render its cached name anywhere — the same
  // rpc_portfolios_table rollup the picker's candidates come from is the only
  // source of truth for "can this account still see it", so once it has
  // loaded, any pinned portfolio absent from it is stale. Auto-unpin rather
  // than just hiding: a stale pin would otherwise sit on one of the 4 slots
  // forever with nothing to show for it.
  useEffect(() => {
    if (portfoliosLoading) return;
    const stale = pinned.filter((p) => p.kind === 'portfolio' && !portfolios.some((pf) => portfolioPinId(pf.id) === p.id));
    stale.forEach((p) => togglePin(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfoliosLoading, portfolios, pinned]);

  const visiblePinned = portfoliosLoading ? pinned : pinned.filter((p) => p.kind !== 'portfolio' || portfolios.some((pf) => portfolioPinId(pf.id) === p.id));

  const sections: { key: string; label: string; items: PinnedShortcut[] }[] = [
    { key: 'nav', label: 'Navigation', items: shortcutCandidates },
    { key: 'portfolios', label: 'Portfolios', items: portfolioCandidates },
    { key: 'pipelines', label: 'Pipelines', items: pipelineCandidates },
  ];

  const renderGlyph = (item: PinnedShortcut, active: boolean, size: number) =>
    item.kind === 'portfolio' ? (
      <EntityGlyph kind="portfolio" size={size + 4} />
    ) : (
      <FontAwesome name={item.icon} size={size} color={active ? colors.primary : colors.textDim} />
    );

  return (
    <View className="flex-row items-center gap-2">
      {visiblePinned.map((item, i) => {
        const external = /^https?:\/\//i.test(item.href);
        const pillClass = 'animate-island-pop h-9 flex-row items-center gap-1.5 rounded-xl border border-surface-border bg-surface-card px-2.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-primary/40 hover:bg-surface-overlay active:translate-y-0 active:scale-95';
        const inner = (
          <>
            {item.kind === 'portfolio' ? (
              <EntityGlyph kind="portfolio" size={16} />
            ) : (
              <FontAwesome name={item.icon} size={12} color={colors.primary} />
            )}
            <Text className="text-xs font-bold text-typography-main whitespace-nowrap" numberOfLines={1}>{item.label}</Text>
          </>
        );
        const delay = { animationDelay: `${i * 45}ms` } as any;
        return external ? (
          <Pressable key={item.id} onPress={() => window.open(item.href, '_blank', 'noopener,noreferrer')} style={delay} className={pillClass}>
            {inner}
          </Pressable>
        ) : (
          <Link key={item.id} href={item.href as any} asChild>
            <Pressable style={delay} className={pillClass}>{inner}</Pressable>
          </Link>
        );
      })}

      <View ref={wrapperRef} style={{ position: 'relative', zIndex: showPicker ? 100 : undefined }}>
        <Tooltip label="Pin shortcut" side="left">
          <Pressable
            onPress={() => setClickedOpen((v) => !v)}
            accessibilityLabel="Pin a shortcut"
            className="h-9 w-9 items-center justify-center rounded-xl border border-dashed border-surface-border bg-surface-card transition-all duration-200 ease-out hover:rotate-90 hover:border-brand-primary/40 hover:bg-surface-overlay active:scale-95"
          >
            <FontAwesome name="plus" size={12} color={colors.textDim} />
          </Pressable>
        </Tooltip>

        {/* Outer view starts flush under the trigger (top-9 = 36px) with
            transparent top padding, bridging the old 8px hover-gap so moving the
            cursor into the picker never fires the wrapper's mouseleave. */}
        <View
          pointerEvents={showPicker ? 'auto' : 'none'}
          style={{
            // `pointerEvents="none"` is NOT enough: RNW compiles a *disabled*
            // Pressable to `pointer-events: box-none`, which re-enables
            // `pointer-events: auto` on its own children. At 4/4 pinned every
            // row + "Add custom link" is disabled, so the closed 288x400 panel
            // stayed hit-testable and hovering the page under it (the date
            // filters) fired the wrapper's mouseenter and popped it open.
            // visibility:hidden takes the whole subtree out of hit testing.
            // ponytail: kept in the tree (not unmounted) only for the open transition.
            visibility: showPicker ? 'visible' : 'hidden',
            opacity: showPicker ? 1 : 0,
            transform: [
              { scale: showPicker ? 1 : 0.96 },
              { translateY: showPicker ? 0 : -6 },
            ],
            zIndex: 100,
          } as any}
          // `transition` (not `transition-all`) so visibility flips instantly
          // instead of transitioning — no 300ms ghost panel on the way out.
          className="absolute left-0 top-9 w-72 pt-2 transition duration-300 ease-in-out"
        >
          <View className="rounded-2xl border border-surface-border bg-surface-card/95 p-3 premium-shadow glass-card">
            <Text className="mb-2 px-1 text-[10px] font-black uppercase tracking-widest text-typography-dim">
              Pinned shortcuts ({visiblePinned.length}/{maxPinned})
            </Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {extraPinned.map((item) => {
                const active = isPinned(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => togglePin(item)}
                    className="mb-1 flex-row items-center rounded-xl bg-brand-primary/10 p-2.5 transition-all duration-150 ease-out active:scale-[0.98]"
                  >
                    {renderGlyph(item, active, 14)}
                    <Text className="ml-2 flex-1 text-xs font-bold text-brand-primary" numberOfLines={1}>
                      {item.label}
                    </Text>
                    <FontAwesome name="check-circle" size={14} color={colors.primary} />
                  </Pressable>
                );
              })}

              {sections.map((section) => {
                if (section.items.length === 0) return null;
                return (
                  <View key={section.key} className="mb-1">
                    <Text className="mb-1 mt-2 px-1 text-[9px] font-black uppercase tracking-widest text-typography-dim">
                      {section.label}
                    </Text>
                    {section.items.map((item) => {
                      const active = isPinned(item.id);
                      const disabled = !active && pinned.length >= maxPinned;
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => !disabled && togglePin(item)}
                          disabled={disabled}
                          className={`mb-1 flex-row items-center rounded-xl p-2.5 transition-all duration-150 ease-out active:scale-[0.98] ${active ? 'bg-brand-primary/10' : disabled ? 'opacity-40' : 'hover:translate-x-0.5 hover:bg-surface-overlay'}`}
                        >
                          {renderGlyph(item, active, 14)}
                          <Text className={`ml-2 flex-1 text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-main'}`} numberOfLines={1}>
                            {item.label}
                          </Text>
                          <FontAwesome name={active ? 'check-circle' : 'circle-o'} size={14} color={active ? colors.primary : colors.textDim} />
                        </Pressable>
                      );
                    })}
                    {section.key === 'portfolios' && (
                      <Pressable
                        onPress={() => { setClickedOpen(false); router.push('/portfolios' as any); }}
                        className="mb-1 flex-row items-center gap-2 rounded-xl p-2.5 transition-all duration-150 ease-out hover:bg-surface-overlay active:scale-[0.98]"
                      >
                        <View className="w-[18px] items-center">
                          <FontAwesome name="arrow-right" size={11} color={colors.textDim} />
                        </View>
                        <Text className="text-xs font-bold text-typography-muted">Browse all portfolios</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Custom link — pin any internal path (e.g. a share link) or URL. */}
            <View className="mt-2 border-t border-surface-border pt-2">
              {!showAdd ? (
                <Pressable
                  onPress={() => { setShowAdd(true); setClickedOpen(true); }}
                  disabled={pinned.length >= maxPinned}
                  className={`flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-surface-border p-2.5 transition-all duration-150 ${pinned.length >= maxPinned ? 'opacity-40' : 'hover:bg-surface-overlay'}`}
                >
                  <FontAwesome name="link" size={12} color={colors.textDim} />
                  <Text className="text-xs font-bold text-typography-muted">Add custom link</Text>
                </Pressable>
              ) : (
                <View className="gap-2">
                  <TextInput
                    value={linkLabel}
                    onChangeText={setLinkLabel}
                    placeholder="Label"
                    placeholderTextColor={colors.textDim}
                    className="rounded-lg border border-surface-border bg-surface-background px-2.5 py-2 text-xs text-typography-main"
                  />
                  <TextInput
                    value={linkUrl}
                    onChangeText={setLinkUrl}
                    onSubmitEditing={addCustomLink}
                    placeholder="/share/… or https://…"
                    placeholderTextColor={colors.textDim}
                    className="rounded-lg border border-surface-border bg-surface-background px-2.5 py-2 text-xs text-typography-main"
                  />
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => { setShowAdd(false); setLinkLabel(''); setLinkUrl(''); }}
                      className="flex-1 items-center rounded-lg border border-surface-border py-2 hover:bg-surface-overlay"
                    >
                      <Text className="text-xs font-bold text-typography-muted">Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={addCustomLink}
                      disabled={!canAdd}
                      className={`flex-1 items-center rounded-lg bg-brand-primary py-2 ${canAdd ? 'active:scale-95' : 'opacity-40'}`}
                    >
                      <Text className="text-xs font-black text-white">Add</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
