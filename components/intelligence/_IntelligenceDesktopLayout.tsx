import { useAuth } from '@/contexts/AuthContext';
import { FontAwesome } from '@expo/vector-icons';
import { Link, Slot, usePathname } from 'expo-router';
import React from 'react';
import { Text, TouchableOpacity, View, ScrollView, useWindowDimensions } from 'react-native';

const INTELLIGENCE_PERMISSIONS = ['analytics.view', 'analytics.compare', 'report.view', 'target.view', 'archive.view'];

const NAV = [
  { href: '/intelligence',          label: 'Overview',      icon: 'th-large'    as const, exact: true, anyPermissions: INTELLIGENCE_PERMISSIONS },
  { href: '/intelligence/graphs',   label: 'Performance',   icon: 'line-chart'  as const, permission: 'analytics.view' },
  { href: '/intelligence/targets',  label: 'Targets',       icon: 'bullseye'    as const, permission: 'target.view' },
  { href: '/intelligence/reports',  label: 'Reports',       icon: 'file-pdf-o'  as const, permission: 'report.view' },
  { href: '/intelligence/analytics', label: 'Analytics',   icon: 'bar-chart'   as const, permission: 'analytics.view' },
  { href: '/intelligence/ReportGenerator', label: 'Report Architect', icon: 'magic' as const, permission: 'report.view' },
  { href: '/intelligence/archives', label: 'Cold Storage',  icon: 'archive'     as const, permission: 'archive.view' },
];

export default function IntelligenceLayout() {
  const pathname = usePathname();
  const { hasPermission } = useAuth();
  const { width } = useWindowDimensions();
  const items = NAV.filter(i => {
    if ('anyPermissions' in i && i.anyPermissions) return i.anyPermissions.some(p => hasPermission(p));
    return !i.permission || hasPermission(i.permission);
  });

  // Sidebar narrows on smaller desktops so content area stays usable
  const sidebarWidth = width >= 1536 ? 320 : width >= 1280 ? 256 : 200;
  const isCompact = sidebarWidth <= 200;

  return (
    <View className="flex-1 flex-row">
      {/* Intelligence sub-sidebar */}
      <View style={{ width: sidebarWidth }} className="border-r border-surface-border bg-surface-card/30">
        <View className={`${isCompact ? 'p-4' : 'p-6'} border-b border-surface-border`}>
          {!isCompact && (
            <Text className="text-[10px] text-brand-primary font-black uppercase tracking-[0.2em] mb-2">
              Full Analytics
            </Text>
          )}
          <Text className={`text-typography-main font-black ${isCompact ? 'text-base' : 'text-2xl'}`}>
            {isCompact ? 'Hub' : 'Intelligence Hub'}
          </Text>
        </View>

        <ScrollView className="flex-1">
          <View className={isCompact ? 'p-2' : 'p-4'}>
            {items.map(item => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href as any} asChild>
                  <TouchableOpacity
                    className={`${isCompact ? 'p-3' : 'p-4'} rounded-2xl mb-2 border transition-all flex-row items-center ${
                      isActive
                        ? 'bg-brand-primary border-brand-primary premium-shadow'
                        : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
                    }`}
                  >
                    <View className={`${isCompact ? 'w-5' : 'w-8'} items-center ${isCompact ? '' : 'mr-3'}`}>
                      <FontAwesome
                        name={item.icon}
                        size={15}
                        className={isActive ? 'text-brand-on-primary' : 'text-typography-muted'}
                      />
                    </View>
                    {!isCompact && (
                      <Text
                        className={`text-sm font-bold flex-1 ${isActive ? 'text-brand-on-primary' : 'text-typography-main'}`}
                      >
                        {item.label}
                      </Text>
                    )}
                    {isActive && !isCompact && (
                      <FontAwesome name="chevron-right" size={10} className="text-brand-on-primary opacity-50" />
                    )}
                  </TouchableOpacity>
                </Link>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Page content — no overflow-hidden so inner ScrollViews own their bounds */}
      <View className="flex-1">
        <Slot />
      </View>
    </View>
  );
}
