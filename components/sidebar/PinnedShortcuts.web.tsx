import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Tooltip from '../common/Tooltip';
import { PIPELINE_ICONS, PinnedShortcut, Shortcut } from './constants';
import { usePinnedShortcuts } from './usePinnedShortcuts';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export default function PinnedShortcuts({
  visibleShortcuts,
  pipelines,
  onOpenChange,
}: {
  visibleShortcuts: Shortcut[];
  pipelines: { id: string; name: string }[];
  onOpenChange?: (open: boolean) => void;
}) {
  const colors = useThemeColors();
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

  const candidates: PinnedShortcut[] = useMemo(() => {
    const fromShortcuts = visibleShortcuts.map((s) => ({ id: s.id, label: s.label, icon: s.icon, href: s.href }));
    const fromPipelines = pipelines.map((p, i) => ({
      id: `pipeline:${p.id}`,
      label: p.name,
      icon: PIPELINE_ICONS[i % PIPELINE_ICONS.length],
      href: `/tasks?pipelineId=${p.id}`,
    }));
    return [...fromShortcuts, ...fromPipelines];
  }, [visibleShortcuts, pipelines]);

  // Custom links aren't in `candidates`, so surface any that are pinned at the top
  // of the list — otherwise they'd be unremovable.
  const listItems = useMemo(() => {
    const extra = pinned.filter((p) => !candidates.some((c) => c.id === p.id));
    return [...extra, ...candidates];
  }, [pinned, candidates]);

  return (
    <View className="flex-row items-center gap-2">
      {pinned.map((item, i) => {
        const external = /^https?:\/\//i.test(item.href);
        const pillClass = 'animate-island-pop h-9 flex-row items-center gap-1.5 rounded-xl border border-surface-border bg-surface-card px-2.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-primary/40 hover:bg-surface-overlay active:translate-y-0 active:scale-95';
        const inner = (
          <>
            <FontAwesome name={item.icon} size={12} color={colors.primary} />
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
              Pinned shortcuts ({pinned.length}/{maxPinned})
            </Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {listItems.map((item) => {
                const active = isPinned(item.id);
                const disabled = !active && pinned.length >= maxPinned;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => !disabled && togglePin(item)}
                    disabled={disabled}
                    className={`mb-1 flex-row items-center rounded-xl p-2.5 transition-all duration-150 ease-out active:scale-[0.98] ${active ? 'bg-brand-primary/10' : disabled ? 'opacity-40' : 'hover:translate-x-0.5 hover:bg-surface-overlay'}`}
                  >
                    <FontAwesome name={item.icon} size={14} color={active ? colors.primary : colors.textDim} className="w-6" />
                    <Text className={`ml-2 flex-1 text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-main'}`} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <FontAwesome name={active ? 'check-circle' : 'circle-o'} size={14} color={active ? colors.primary : colors.textDim} />
                  </Pressable>
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
