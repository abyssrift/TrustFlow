import { useAuth } from '@/contexts/AuthContext';
import { FontAwesome } from '@expo/vector-icons';
import { Link, Slot, usePathname } from 'expo-router';
import React from 'react';
import { Text, TouchableOpacity, View, ScrollView } from 'react-native';

const NAV = [
  { href: '/intelligence',          label: 'Overview',      icon: 'th-large'    as const, exact: true },
  { href: '/intelligence/graphs',   label: 'Performance',   icon: 'line-chart'  as const },
  { href: '/intelligence/targets',  label: 'Targets',       icon: 'bullseye'    as const },
  { href: '/intelligence/reports',  label: 'Reports',       icon: 'file-pdf-o'  as const },
  { href: '/intelligence/analytics', label: 'Analytics',   icon: 'bar-chart'   as const, permission: 'analytics.view' },
  { href: '/intelligence/ReportGenerator', label: 'Report Architect', icon: 'magic' as const, permission: 'report.view' },
  { href: '/intelligence/archives', label: 'Cold Storage',  icon: 'archive'     as const, permission: 'archive.view' },
];

export default function IntelligenceLayout() {
  const pathname = usePathname();
  const { hasPermission } = useAuth();
  const items = NAV.filter(i => !i.permission || hasPermission(i.permission));

  return (
    <View className="flex-1 flex-row">
      {/* Intelligence sub-sidebar */}
      <View className="w-80 border-r border-surface-border bg-surface-card/30">
        <View className="p-8 border-b border-surface-border">
          <Text className="text-[10px] text-brand-primary font-black uppercase tracking-[0.2em] mb-2">
            Full Analytics
          </Text>
          <Text className="text-typography-main text-2xl font-black">
            Intelligence Hub
          </Text>
        </View>

        <ScrollView className="flex-1">
          <View className="p-4">
            {items.map(item => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href as any} asChild>
                  <TouchableOpacity
                    className={`p-5 rounded-2xl mb-3 border transition-all flex-row items-center ${
                      isActive 
                        ? 'bg-brand-primary border-brand-primary premium-shadow' 
                        : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
                    }`}
                  >
                    <View className="w-8 items-center mr-3">
                      <FontAwesome
                        name={item.icon}
                        size={16}
                        color={isActive ? 'white' : 'var(--color-text-muted)'}
                      />
                    </View>
                    <Text
                      className={`text-sm font-bold flex-1 ${isActive ? 'text-white' : 'text-typography-main'}`}
                    >
                      {item.label}
                    </Text>
                    {isActive && (
                      <FontAwesome name="chevron-right" size={10} color="white" style={{ opacity: 0.5 }} />
                    )}
                  </TouchableOpacity>
                </Link>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Page content */}
      <View className="flex-1 overflow-hidden">
        <Slot />
      </View>
    </View>
  );
}
