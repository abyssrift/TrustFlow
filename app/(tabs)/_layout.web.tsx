import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, Slot, usePathname } from 'expo-router';
import { View, Text, Pressable, Platform } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const SidebarItem = ({ icon, label, href, isActive, theme }: { icon: any, label: string, href: string, isActive: boolean, theme: any }) => (
  <Link href={href as any} asChild>
    <Pressable className={`flex-row items-center p-3 rounded-xl mb-2 hover:bg-surface-card ${isActive ? 'bg-brand-primary/10' : ''}`}>
      {({ pressed }) => (
         <>
          <View className={`w-8 items-center ${pressed ? 'opacity-70' : ''}`}>
             <FontAwesome name={icon} size={20} color={isActive ? theme.tint : theme.tabIconDefault} />
          </View>
          <Text className={`font-bold ml-2 ${isActive ? 'text-brand-primary' : 'text-typography-muted'}`}>{label}</Text>
         </>
      )}
    </Pressable>
  </Link>
);

export default function WebTabLayout() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'dark'];
  const pathname = usePathname();
  const { session } = useAuth(); 

  // Mapping the routes from _layout.tsx
  // / = Dashboard (th-large)
  // /tasks = Tasks (check-square-o)
  // /projects = Projects (folder-o)
  // /intelligence = Insights (line-chart)
  // /people = Team (users)

  return (
    <View className="flex-1 flex-row bg-surface-background w-full h-full">
       {/* Sidebar Fixed */}
       <View className="w-64 bg-surface-background border-r border-surface-border p-4 h-full flex-col">
         <View className="mb-8 px-2 mt-4">
           <Text className="text-typography-main font-black text-2xl tracking-tighter">TrustEdge</Text>
           <Text className="text-brand-primary font-bold text-[10px] uppercase tracking-widest">Workspace</Text>
         </View>

         <View className="flex-1">
            <SidebarItem icon="th-large" label="Dashboard" href="/" isActive={pathname === '/'} theme={theme} />
            <SidebarItem icon="check-square-o" label="Tasks" href="/tasks" isActive={pathname.startsWith('/tasks')} theme={theme} />
            <SidebarItem icon="folder-o" label="Projects" href="/projects" isActive={pathname.startsWith('/projects')} theme={theme} />
            <SidebarItem icon="line-chart" label="Insights" href="/intelligence" isActive={pathname.startsWith('/intelligence')} theme={theme} />
            <SidebarItem icon="users" label="Team" href="/people" isActive={pathname.startsWith('/people')} theme={theme} />
         </View>

         {/* Bottom User Actions */}
         <View className="mt-auto border-t border-surface-border pt-4">
            <Link href="/modal" asChild>
              <Pressable className="flex-row items-center p-3 rounded-xl hover:bg-surface-card mb-2">
                <View className="w-8 items-center">
                   <FontAwesome name="bell" size={18} color={theme.text} />
                </View>
                <Text className="text-typography-main font-bold ml-2">Notifications</Text>
              </Pressable>
            </Link>
            <Pressable className="flex-row items-center p-3 rounded-xl hover:bg-surface-card">
              <View className="w-8 items-center">
                 <FontAwesome name="user-circle" size={18} color={theme.text} />
              </View>
              <Text className="text-typography-main font-bold ml-2 line-clamp-1">{session?.user?.email || 'Profile'}</Text>
            </Pressable>
         </View>
       </View>

       {/* Main Content Native Web Scrolling Block */}
       <View className="flex-1 bg-surface-background" style={Platform.OS === 'web' ? { overflowY: 'auto' } : {}}>
         <Slot />
       </View>
    </View>
  );
}
