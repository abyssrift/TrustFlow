import { addAlpha } from '@/lib/layout';
import { useTourTarget } from '@/lib/tour/TourContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

type Shortcut = { id: string; icon: any; label: string; href: string };
type Colors = { primary: string; card: string; border: string; textMain: string };

export default function WebMobileNavItem({
  shortcut,
  isActive,
  badge,
  colors,
  onPress,
}: {
  shortcut: Shortcut;
  isActive: boolean;
  badge: number;
  colors: Colors;
  onPress: () => void;
}) {
  const tourRef = useTourTarget(`nav-${shortcut.id}`);
  return (
    <Link href={shortcut.href as any} asChild onPress={onPress}>
      <Pressable
        ref={tourRef}
        className="flex-row items-center p-4 rounded-xl mb-2 border"
        style={{ backgroundColor: isActive ? addAlpha(colors.primary, 0.1) : colors.card, borderColor: isActive ? addAlpha(colors.primary, 0.3) : colors.border }}
      >
        <FontAwesome name={shortcut.icon} size={18} color={isActive ? colors.primary : colors.textMain} className="w-8" />
        <Text className="font-bold ml-2 flex-1" style={{ color: isActive ? colors.primary : colors.textMain }}>{shortcut.label}</Text>
        {badge > 0 && (
          <View className="min-w-5 h-5 rounded-full bg-red-500 items-center justify-center px-1">
            <Text className="text-[10px] font-black text-white leading-none">{badge > 99 ? '99+' : badge}</Text>
          </View>
        )}
      </Pressable>
    </Link>
  );
}
