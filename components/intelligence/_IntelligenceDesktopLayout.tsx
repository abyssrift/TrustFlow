import { useAuth } from '@/contexts/AuthContext';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { useThemeColors } from '@/hooks/useThemeColors';
import { AnalyticsLimits, getAnalyticsLimits } from '@/lib/planLimits';
import { FontAwesome } from '@expo/vector-icons';
import { Link, Slot, usePathname } from 'expo-router';
import React from 'react';
import { Text, TouchableOpacity, View, ScrollView, useWindowDimensions } from 'react-native';

const INTELLIGENCE_PERMISSIONS = ['analytics.view', 'analytics.compare', 'report.view', 'target.view', 'archive.view'];

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  exact?: boolean;
  permission?: string;
  anyPermissions?: string[];
  planFeature?: keyof AnalyticsLimits;
};

const NAV: NavItem[] = [
  { href: '/intelligence',                   label: 'Overview',         icon: 'th-large',   exact: true, anyPermissions: INTELLIGENCE_PERMISSIONS },
  { href: '/intelligence/graphs',            label: 'Performance',      icon: 'line-chart',  permission: 'analytics.view' },
  { href: '/intelligence/targets',           label: 'Targets',          icon: 'bullseye',    permission: 'target.view' },
  { href: '/intelligence/reports',           label: 'Reports',          icon: 'file-pdf-o',  permission: 'report.view',    planFeature: 'reports' },
  { href: '/intelligence/analytics',         label: 'Analytics',        icon: 'bar-chart',   permission: 'analytics.view' },
  { href: '/intelligence/ReportGenerator',   label: 'Report Architect', icon: 'magic',       permission: 'report.view',    planFeature: 'reports' },
  { href: '/intelligence/archives',          label: 'Cold Storage',     icon: 'archive',     permission: 'archive.view' },
];

function planBadgeLabel(planCode: string): string {
  return planCode.charAt(0).toUpperCase() + planCode.slice(1);
}

export default function IntelligenceLayout() {
  const pathname    = usePathname();
  const { hasPermission } = useAuth();
  const { planCode }      = useBillingPlan();
  const colors            = useThemeColors();
  const { width }         = useWindowDimensions();
  const limits            = getAnalyticsLimits(planCode);

  const permFiltered = NAV.filter(i => {
    if (i.anyPermissions) return i.anyPermissions.some(p => hasPermission(p));
    return !i.permission || hasPermission(i.permission);
  });

  // Sidebar narrows on smaller desktops so content area stays usable
  const sidebarWidth = width >= 1536 ? 320 : width >= 1280 ? 256 : 200;
  const isCompact    = sidebarWidth <= 200;

  return (
    <View className="flex-1 flex-row">
      {/* Intelligence sub-sidebar */}
      <View style={{ width: sidebarWidth }} className="border-r border-surface-border bg-surface-card/30">
        <View className={`${isCompact ? 'p-4' : 'p-6'} border-b border-surface-border`}>
          {!isCompact && (
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-[10px] text-brand-primary font-black uppercase tracking-[0.2em]">
                Full Analytics
              </Text>
              <View className="px-2 py-0.5 bg-surface-background border border-surface-border rounded-lg">
                <Text className="text-[9px] font-black text-typography-muted uppercase tracking-widest">
                  {planBadgeLabel(planCode)}
                </Text>
              </View>
            </View>
          )}
          <Text className={`text-typography-main font-black ${isCompact ? 'text-base' : 'text-2xl'}`}>
            {isCompact ? 'Hub' : 'Intelligence Hub'}
          </Text>
        </View>

        <ScrollView className="flex-1">
          <View className={isCompact ? 'p-2' : 'p-4'}>
            {permFiltered.map(item => {
              const isActive  = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const isLocked  = !!item.planFeature && !limits[item.planFeature];

              const inner = (
                <View
                  className={`${isCompact ? 'p-3' : 'p-4'} rounded-2xl mb-2 border transition-all flex-row items-center ${
                    isActive && !isLocked
                      ? 'bg-brand-primary border-brand-primary premium-shadow'
                      : isLocked
                      ? 'bg-surface-background border-surface-border/50 opacity-60'
                      : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
                  }`}
                >
                  <View className={`${isCompact ? 'w-5' : 'w-8'} items-center ${isCompact ? '' : 'mr-3'}`}>
                    <FontAwesome
                      name={isLocked ? 'lock' : item.icon}
                      size={15}
                      color={
                        isLocked
                          ? colors.textMuted
                          : isActive
                          ? 'white'
                          : colors.textDim
                      }
                    />
                  </View>
                  {!isCompact && (
                    <Text
                      className={`text-sm font-bold flex-1 ${
                        isLocked
                          ? 'text-typography-muted'
                          : isActive
                          ? 'text-brand-on-primary'
                          : 'text-typography-main'
                      }`}
                    >
                      {item.label}
                    </Text>
                  )}
                  {!isCompact && isLocked && (
                    <View className="px-1.5 py-0.5 bg-surface-card border border-surface-border rounded-md">
                      <Text className="text-[8px] font-black text-typography-muted uppercase tracking-widest">Pro+</Text>
                    </View>
                  )}
                  {isActive && !isCompact && !isLocked && (
                    <FontAwesome name="chevron-right" size={10} color="white" style={{ opacity: 0.5 }} />
                  )}
                </View>
              );

              if (isLocked) {
                return <View key={item.href}>{inner}</View>;
              }

              return (
                <Link key={item.href} href={item.href as any} asChild>
                  <TouchableOpacity>{inner}</TouchableOpacity>
                </Link>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Page content */}
      <View className="flex-1">
        <Slot />
      </View>
    </View>
  );
}
