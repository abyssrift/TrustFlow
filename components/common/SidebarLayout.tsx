import React from 'react';
import { ScrollView, View } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

type SidebarLayoutProps = {
  width?: number;
  children: React.ReactNode;
  /** Extra styles applied to the outer container View. */
  style?: any;
  /** Optional sticky header rendered above the scrollable body, separated by a border. */
  header?: React.ReactNode;
};

export default function SidebarLayout({ width = 288, style, header, children }: SidebarLayoutProps) {
  const c = useThemeColors();
  return (
    <View style={[{ width, backgroundColor: c.background + '4D', flex: 1 }, style]}>
      {header && (
        <View style={{ borderBottomWidth: 1, borderBottomColor: c.border + '4D' }}>
          {header}
        </View>
      )}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32 }}>
        {children}
      </ScrollView>
    </View>
  );
}
