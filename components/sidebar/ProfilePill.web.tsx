import { Image } from 'expo-image';
import { Link } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { initials } from './helpers';

export default function ProfilePill({
  profileAvatarUrl,
  profileLabel,
}: {
  profileAvatarUrl: string | null;
  profileLabel: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const wrapperRef = useRef<any>(null);

  // Name is hidden until hover, same mouseenter/mouseleave escape hatch
  // Sidebar.web.tsx uses for its own hover-expand.
  useEffect(() => {
    const el = wrapperRef.current;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    const onEnter = () => setIsHovered(true);
    const onLeave = () => setIsHovered(false);
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => {
      domNode.removeEventListener('mouseenter', onEnter);
      domNode.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <View ref={wrapperRef}>
      <Link href="/profile" asChild>
        <Pressable
          className="h-9 flex-row items-center rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay transition-all duration-300 ease-in-out"
          style={{ paddingLeft: 6, paddingRight: isHovered ? 12 : 6 }}
        >
          <View
            style={{ width: 26, height: 26 }}
            className="items-center justify-center overflow-hidden rounded-lg border border-brand-primary/20 bg-brand-primary/5"
          >
            {profileAvatarUrl ? (
              <Image
                source={{ uri: profileAvatarUrl }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                cachePolicy="memory"
              />
            ) : (
              <Text className="text-[10px] font-black text-brand-primary">{initials(profileLabel)}</Text>
            )}
          </View>
          <View
            style={{
              maxWidth: isHovered ? 160 : 0,
              opacity: isHovered ? 1 : 0,
              marginLeft: isHovered ? 8 : 0,
              overflow: 'hidden',
            }}
            className="transition-all duration-300 ease-in-out"
          >
            <Text className="text-xs font-bold text-typography-main whitespace-nowrap" numberOfLines={1}>{profileLabel}</Text>
          </View>
        </Pressable>
      </Link>
    </View>
  );
}
