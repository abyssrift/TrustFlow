import { useEffect } from 'react';
import { Platform, Vibration } from 'react-native';

const DEFAULT_PULSE_MS = 2500;
const DEFAULT_VIBRATION_MS = 15;

export function useUnreadNotificationAttention(
  unreadCount: number,
  enabled = true,
  pulseMs = DEFAULT_PULSE_MS,
  vibrationMs = DEFAULT_VIBRATION_MS
) {
  useEffect(() => {
    if (!enabled || unreadCount <= 0) return;

    const pulse = () => {
      if (Platform.OS === 'web') {
        const isVisible = globalThis.document?.visibilityState === 'visible';
        if (!isVisible) return;

        globalThis.navigator?.vibrate?.(vibrationMs);
        return;
      }

      Vibration.vibrate(vibrationMs);
    };

    const timer = setInterval(pulse, pulseMs);
    return () => clearInterval(timer);
  }, [enabled, unreadCount, pulseMs, vibrationMs]);
}