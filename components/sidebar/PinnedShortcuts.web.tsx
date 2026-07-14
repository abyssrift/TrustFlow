import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
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

  return (
    <View className="flex-row items-center gap-2">
      {pinned.map((item, i) => (
        <Link key={item.id} href={item.href as any} asChild>
          <Pressable
            style={{ animationDelay: `${i * 45}ms` } as any}
            className="animate-island-pop h-9 flex-row items-center gap-1.5 rounded-xl border border-surface-border bg-surface-card px-2.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-primary/40 hover:bg-surface-overlay active:translate-y-0 active:scale-95"
          >
            <FontAwesome name={item.icon} size={12} color={colors.primary} />
            <Text className="text-xs font-bold text-typography-main whitespace-nowrap" numberOfLines={1}>{item.label}</Text>
          </Pressable>
        </Link>
      ))}

      <View ref={wrapperRef} style={{ position: 'relative', zIndex: showPicker ? 100 : undefined }}>
        <Pressable
          onPress={() => setClickedOpen((v) => !v)}
          accessibilityLabel="Pin a shortcut"
          className="h-9 w-9 items-center justify-center rounded-xl border border-dashed border-surface-border bg-surface-card transition-all duration-200 ease-out hover:rotate-90 hover:border-brand-primary/40 hover:bg-surface-overlay active:scale-95"
        >
          <FontAwesome name="plus" size={12} color={colors.textDim} />
        </Pressable>

        {/* Outer view starts flush under the trigger (top-9 = 36px) with
            transparent top padding, bridging the old 8px hover-gap so moving the
            cursor into the picker never fires the wrapper's mouseleave. */}
        <View
          pointerEvents={showPicker ? 'auto' : 'none'}
          style={{
            opacity: showPicker ? 1 : 0,
            transform: [
              { scale: showPicker ? 1 : 0.96 },
              { translateY: showPicker ? 0 : -6 },
            ],
            zIndex: 100,
          }}
          className="absolute left-0 top-9 w-72 pt-2 transition-all duration-300 ease-in-out"
        >
          <View className="rounded-2xl border border-surface-border bg-surface-card/95 p-3 premium-shadow glass-card">
            <Text className="mb-2 px-1 text-[10px] font-black uppercase tracking-widest text-typography-dim">
              Pinned shortcuts ({pinned.length}/{maxPinned})
            </Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {candidates.map((item) => {
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
          </View>
        </View>
      </View>
    </View>
  );
}
