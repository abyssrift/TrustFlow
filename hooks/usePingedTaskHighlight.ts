import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { supabase } from '@/lib/supabase';

export const usePingedTaskHighlight = (taskId: string) => {
  const [wasPinged, setWasPinged] = useState(false);
  const highlightAnim = useRef(new Animated.Value(0)).current;
  const channelRef = useRef<any>(null);

  useEffect(() => {
    const subscribeToTaskPings = () => {
      const channel = supabase.channel(`task:${taskId}`);

      channel
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_log',
          filter: `task_id=eq.${taskId}`,
        }, (payload) => {
          if (payload.new.event_type === 'task_pinged') {
            setWasPinged(true);

            // Trigger highlight animation
            Animated.sequence([
              Animated.timing(highlightAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: false,
              }),
              Animated.delay(1500),
              Animated.timing(highlightAnim, {
                toValue: 0,
                duration: 500,
                useNativeDriver: false,
              }),
            ]).start(() => setWasPinged(false));
          }
        })
        .subscribe();

      channelRef.current = channel;
    };

    subscribeToTaskPings();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [taskId, highlightAnim]);

  const highlightStyle = {
    backgroundColor: highlightAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['transparent', 'rgba(59, 130, 246, 0.1)'], // blue highlight
    }),
  };

  return { wasPinged, highlightStyle, highlightAnim };
};
