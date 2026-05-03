import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, Tabs } from 'expo-router';
import { Pressable, View, Text, useWindowDimensions, Platform } from 'react-native';
import { cssInterop } from 'react-native-css-interop';

import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useNotifications } from '@/contexts/NotificationsContext';

// Interop for Icons to support Tailwind colors
cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  className?: string;
  color?: string;
}) {
  return <FontAwesome size={22} style={{ marginBottom: -3 }} {...props} />;
}

function NotificationBell() {
  const { unreadCount } = useNotifications();
  return (
    <Link href="/modal" asChild>
      <Pressable>
        {({ pressed }) => (
          <View className="bg-brand-primary/10 p-2 rounded-full mr-2" style={{ opacity: pressed ? 0.5 : 1 }}>
            <FontAwesome name="bell" size={18} className="text-brand-primary" />
            {unreadCount > 0 && (
              <View
                className="absolute -top-1 -right-1 bg-state-danger rounded-full items-center justify-center"
                style={{ minWidth: 16, height: 16, paddingHorizontal: 3 }}
              >
                <Text className="text-white text-[9px] font-black leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </View>
        )}
      </Pressable>
    </Link>
  );
}

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const isLargeScreen = width > 768;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: 'rgb(var(--brand-primary))',
        tabBarInactiveTintColor: 'rgb(var(--text-muted))',
        tabBarStyle: {
          backgroundColor: 'rgb(var(--surface-background))',
          borderTopColor: 'transparent',
          paddingBottom: Platform.OS === 'ios' ? 24 : 12,
          paddingTop: 12,
          height: Platform.OS === 'ios' ? 88 : 70,
          display: isLargeScreen ? 'none' : 'flex', // Hide bottom tabs on large screens
        },
        headerStyle: {
          backgroundColor: 'rgb(var(--surface-background))',
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 0,
        },
        headerTitleStyle: {
          color: 'rgb(var(--text-main))',
          fontWeight: '800',
          fontSize: 20,
        },
        headerShown: Platform.OS !== 'web',
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <TabBarIcon name="th-large" color={color} />,
          headerRight: () => (
            <View className="flex-row items-center mr-4">
              <NotificationBell />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color }) => <TabBarIcon name="check-square-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color }) => <TabBarIcon name="folder-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="intelligence"
        options={{
          title: 'Insights',
          tabBarIcon: ({ color }) => <TabBarIcon name="line-chart" color={color} />,
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: 'Team',
          tabBarIcon: ({ color }) => <TabBarIcon name="users" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabBarIcon name="user-circle" color={color} />,
        }}
      />
    </Tabs>
  );
}
