import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Tooltip from '@/components/common/Tooltip';
import BillingMeter from './BillingMeter.web';
import { PIPELINE_ICONS, SIDEBAR_GROUPS, Shortcut } from './constants';
import { matchesHref } from './helpers';
import SidebarItem from './SidebarItem';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

// Renders the flat permission-filtered shortcut list through the SIDEBAR_GROUPS
// hierarchy (#211): titled groups separated by hairlines, and the Intelligence
// parent with its Targets/Archives children nested under an expandable row.
// Children dissolve into plain rows when none are visible to the user, and the
// parent collapses to a single row in icon-rail (collapsed) mode.
function NavGroups({
  visibleShortcuts,
  pathname,
  isExpanded,
  inboxUnread,
}: {
  visibleShortcuts: Shortcut[];
  pathname: string;
  isExpanded: boolean;
  inboxUnread: number;
}) {
  const colors = useThemeColors();
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  const byId = useMemo(() => new Map(visibleShortcuts.map((s) => [s.id, s])), [visibleShortcuts]);

  const groups = useMemo(
    () =>
      SIDEBAR_GROUPS.map((group) => ({
        ...group,
        items: group.items
          .map((item) => {
            const shortcut = byId.get(item.id);
            if (!shortcut) return null;
            const children = (item.children ?? [])
              .map((cid) => byId.get(cid))
              .filter((s): s is Shortcut => !!s);
            return { shortcut, children };
          })
          .filter((x): x is { shortcut: Shortcut; children: Shortcut[] } => !!x),
      })).filter((group) => group.items.length > 0),
    [byId]
  );

  const toggleParent = (id: string) =>
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {groups.map((group, gi) => (
        <View key={group.id}>
          {gi > 0 && (
            <View className={`my-3 ${isExpanded ? 'mx-1' : 'mx-3'} h-px bg-surface-border`} />
          )}
          <View className={gi > 0 ? 'mt-1' : ''}>
            {isExpanded && group.title && (
              <Text className="mb-3 ml-2 mt-2 text-[10px] font-black uppercase tracking-widest text-typography-muted whitespace-nowrap">
                {group.title}
              </Text>
            )}
            {group.items.map(({ shortcut: s, children }) => {
              const isParent = children.length > 0 && isExpanded;
              const badge = s.id === 'filehub' ? inboxUnread : undefined;

              if (!isParent && children.length > 0 && !isExpanded) {
                // Icon rail: children have no room, so the parent is a plain
                // icon row — keep it subtle and navigable.
                return (
                  <SidebarItem
                    key={s.id}
                    icon={s.icon}
                    label={s.label}
                    href={s.href}
                    isActive={children.some((c) => matchesHref(pathname, c.href)) || matchesHref(pathname, s.href)}
                    collapsed={true}
                    badge={badge}
                  />
                );
              }

              if (isParent) {
                const open = !collapsedParents.has(s.id);
                const parentActive = matchesHref(pathname, s.href) || children.some((c) => matchesHref(pathname, c.href));
                return (
                  <View key={s.id}>
                    <Tooltip label={s.label} side="right" disabled={isExpanded}>
                      <View className="relative">
                        <Link href={s.href as any} asChild>
                          <Pressable
                            className={`group relative mb-2 min-h-11 flex-row items-center overflow-hidden rounded-xl border p-3 pr-10 ${parentActive ? 'border-brand-primary/30 bg-brand-primary/10' : 'border-transparent hover:bg-surface-card'}`}
                            accessibilityLabel={s.label}
                          >
                            <View className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${parentActive ? 'bg-brand-primary' : 'bg-transparent group-hover:bg-surface-border'}`} />
                            <View className="w-8 items-center">
                              <FontAwesome name={s.icon} size={18} color={parentActive ? colors.primary : colors.textDim} />
                            </View>
                            <Text className={`ml-2 font-bold ${parentActive ? 'text-brand-primary' : 'text-typography-muted'} whitespace-nowrap`} numberOfLines={1}>
                              {s.label}
                            </Text>
                          </Pressable>
                        </Link>
                        {/* Chevron sits on top of the row's right edge — it's a
                            sibling pressable (not nested in the Link) so toggling
                            the parent never navigates. */}
                        <Pressable
                          onPress={() => toggleParent(s.id)}
                          accessibilityLabel={open ? `Collapse ${s.label}` : `Expand ${s.label}`}
                          className="absolute bottom-0 right-1 top-0 z-10 w-9 items-center justify-center rounded-r-xl hover:bg-surface-overlay"
                        >
                          <FontAwesome name={open ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textDim} />
                        </Pressable>
                      </View>
                    </Tooltip>

                    {open && (
                      <View className="mb-2 ml-5 border-l border-surface-border pl-3">
                        {children.map((c) => (
                          <SidebarItem
                            key={c.id}
                            icon={c.icon}
                            label={c.label}
                            href={c.href}
                            isActive={matchesHref(pathname, c.href)}
                            collapsed={false}
                            badge={c.id === 'filehub' ? inboxUnread : undefined}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                );
              }

              return (
                <SidebarItem
                  key={s.id}
                  icon={s.icon}
                  label={s.label}
                  href={s.href}
                  isActive={matchesHref(pathname, s.href)}
                  collapsed={!isExpanded}
                  badge={badge}
                />
              );
            })}
          </View>
        </View>
      ))}
    </>
  );
}

export default function NavRail({
  sidebarRef,
  isCollapsed,
  isExpanded,
  toggleCollapse,
  visibleShortcuts,
  pipelines,
  isPlatformAdmin,
  pathname,
  params,
  inboxUnread,
}: {
  sidebarRef: React.RefObject<any>;
  isCollapsed: boolean;
  isExpanded: boolean;
  toggleCollapse: () => void;
  visibleShortcuts: Shortcut[];
  pipelines: { id: string; name: string }[];
  isPlatformAdmin: boolean;
  pathname: string;
  params: Record<string, any>;
  inboxUnread: number;
}) {
  const colors = useThemeColors();

  return (
    <View
      ref={sidebarRef}
      className={`${isExpanded ? 'w-64' : 'w-20'} relative self-stretch z-30 transition-[width] duration-300 ease-in-out`}
    >
      <View className="relative flex-1">
        <View
          className={`h-full border-r border-surface-border bg-surface-background w-full overflow-hidden z-20 ${isCollapsed && isExpanded ? 'premium-shadow' : ''}`}
        >
          <View className="flex-1 p-4">
            <View className="mb-6 mt-2 flex-row items-center justify-between px-1">
              {isExpanded && (
                <View className="flex-row items-center">
                  <Image
                    source={require('../../assets/images/logo-mark.png')}
                    style={{ width: 36, height: 36, marginRight: 10 }}
                    resizeMode="contain"
                  />
                  <View>
                    <Text className="text-typography-main text-2xl font-black tracking-tighter whitespace-nowrap">TrustFlow</Text>
                    <Text className="text-brand-primary text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">Workspace</Text>
                  </View>
                </View>
              )}
              <Tooltip label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right" className={isExpanded ? 'w-11' : 'w-full'}>
                <Pressable
                  onPress={toggleCollapse}
                  className={`h-11 w-full items-center justify-center rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay`}
                >
                  <FontAwesome
                    name={isCollapsed ? 'indent' : 'outdent'}
                    size={16}
                    color={colors.primary}
                  />
                </Pressable>
              </Tooltip>
            </View>

            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              <View className="pb-6">
                <NavGroups
                  visibleShortcuts={visibleShortcuts}
                  pathname={pathname}
                  isExpanded={isExpanded}
                  inboxUnread={inboxUnread}
                />

                {isPlatformAdmin && (
                  <View className="mt-4 mb-2">
                    {isExpanded && (
                      <Text className="mb-3 ml-2 text-[10px] font-black uppercase tracking-widest text-brand-primary/50 whitespace-nowrap">
                        System
                      </Text>
                    )}
                    <Tooltip label="Control plane" side="right" disabled={isExpanded}>
                      <Link href="/platform-admin" asChild>
                        <Pressable
                          className={`group relative mb-2 min-h-11 flex-row items-center overflow-hidden rounded-xl border p-3 ${
                            pathname.startsWith('/platform-admin')
                              ? 'border-brand-primary/30 bg-brand-primary-dim'
                              : 'border-brand-primary/10 bg-brand-primary/5 hover:bg-brand-primary/10'
                          }`}
                          accessibilityLabel="Control Plane"
                        >
                          <View className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${pathname.startsWith('/platform-admin') ? 'bg-brand-primary' : 'bg-brand-primary/20 group-hover:bg-brand-primary/40'}`} />
                          <View className={`${isExpanded ? 'w-8' : 'w-full'} items-center`}>
                            <FontAwesome
                              name="shield"
                              size={18}
                              color={pathname.startsWith('/platform-admin') ? colors.primary : (colors.primary + '26')}
                            />
                          </View>
                          {isExpanded && (
                            <Text
                              className={`ml-2 font-bold whitespace-nowrap ${pathname.startsWith('/platform-admin') ? 'text-brand-primary' : 'text-brand-primary/70'}`}
                              numberOfLines={1}
                            >
                              Control Plane
                            </Text>
                          )}
                          {pathname.startsWith('/platform-admin') && !isExpanded && <View className="ml-auto h-2 w-2 rounded-full bg-brand-primary" />}
                        </Pressable>
                      </Link>
                    </Tooltip>

                    <Tooltip label="Dev tools" side="right" disabled={isExpanded}>
                      <Link href="/admin/dev-tools" asChild>
                        <Pressable
                          className={`group relative mb-2 min-h-11 flex-row items-center overflow-hidden rounded-xl border p-3 ${
                            pathname === '/admin/dev-tools'
                              ? 'border-brand-primary/30 bg-brand-primary-dim'
                              : 'border-brand-primary/10 bg-brand-primary/5 hover:bg-brand-primary/10'
                          }`}
                          accessibilityLabel="Dev Tools"
                        >
                          <View className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${pathname === '/admin/dev-tools' ? 'bg-brand-primary' : 'bg-brand-primary/20 group-hover:bg-brand-primary/40'}`} />
                          <View className={`${isExpanded ? 'w-8' : 'w-full'} items-center`}>
                            <FontAwesome
                              name="wrench"
                              size={18}
                              color={pathname === '/admin/dev-tools' ? colors.primary : (colors.primary + '26')}
                            />
                          </View>
                          {isExpanded && (
                            <Text
                              className={`ml-2 font-bold whitespace-nowrap ${pathname === '/admin/dev-tools' ? 'text-brand-primary' : 'text-brand-primary/70'}`}
                              numberOfLines={1}
                            >
                              Dev Tools
                            </Text>
                          )}
                          {pathname === '/admin/dev-tools' && !isExpanded && <View className="ml-auto h-2 w-2 rounded-full bg-brand-primary" />}
                        </Pressable>
                      </Link>
                    </Tooltip>
                  </View>
                )}

                {pipelines.length > 0 && (
                  <View className="mt-2">
                    {isExpanded && (
                      <Text className="mb-3 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted whitespace-nowrap">
                        Pipelines
                      </Text>
                    )}
                    {pipelines.map((p, index) => (
                      <SidebarItem
                        key={p.id}
                        icon={PIPELINE_ICONS[index % PIPELINE_ICONS.length]}
                        label={p.name}
                        href={`/tasks?pipelineId=${p.id}`}
                        isActive={pathname === '/tasks' && String(params.pipelineId || '') === p.id}
                        collapsed={!isExpanded}
                      />
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>

            <BillingMeter isExpanded={isExpanded} />
          </View>
        </View>
      </View>
    </View>
  );
}
