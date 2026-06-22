import { useRouter } from 'expo-router';
import React from 'react';
import { Text, TextProps } from 'react-native';

/**
 * Renders a user's name as a tappable link that opens their profile in the
 * Corporate (People) screen. Use this anywhere a user's name is shown so the
 * whole app routes consistently to one canonical profile view.
 *
 * Falls back to plain, non-interactive text when no userId is available.
 */
export default function UserLink({
  userId,
  name,
  children,
  fallback = 'Unknown',
  disabled = false,
  ...textProps
}: {
  userId?: string | null;
  name?: string | null;
  children?: React.ReactNode;
  fallback?: string;
  disabled?: boolean;
} & TextProps) {
  const router = useRouter();
  const label = children ?? name ?? fallback;

  if (!userId || disabled) {
    return <Text {...textProps}>{label}</Text>;
  }

  return (
    <Text
      {...textProps}
      onPress={(e) => {
        // Stop parent rows/cards from also handling the press.
        (e as any)?.stopPropagation?.();
        router.push(`/people?section=members&user=${userId}`);
      }}
      style={[textProps.style, { cursor: 'pointer' } as any]}
    >
      {label}
    </Text>
  );
}
