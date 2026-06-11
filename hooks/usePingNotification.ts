import { Audio } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

export const usePingNotification = (taskId: string) => {
  const { successToast } = useToast();
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const channelRef = useRef<any>(null);
  const [loadingSound, setLoadingSound] = useState(false);

  // Fetch company's custom ping sound on mount
  useEffect(() => {
    const fetchPingSound = async () => {
      try {
        const { data, error } = await supabase
          .from('company_ping_sounds')
          .select('sound_url')
          .single();

        if (error) {
          console.log('No custom ping sound configured, will use default');
          return;
        }

        setSoundUrl(data?.sound_url || null);
      } catch (err) {
        console.warn('Failed to fetch ping sound:', err);
      }
    };

    fetchPingSound();
  }, []);

  // Play the ping sound
  const playPingSound = useCallback(async () => {
    try {
      // If sound URL is set, use that; otherwise use a default beep
      if (soundUrl) {
        setLoadingSound(true);
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
        }

        const { sound } = await Audio.Sound.createAsync(
          { uri: soundUrl },
          { shouldPlay: true }
        );
        soundRef.current = sound;
        setLoadingSound(false);
      } else {
        // Fallback: play a simple beep using Web Audio API or device sound
        await playDefaultBeep();
      }
    } catch (err) {
      console.error('Failed to play ping sound:', err);
    }
  }, [soundUrl]);

  // Default beep sound - simple fallback when no custom sound is set
  const playDefaultBeep = useCallback(async () => {
    // Fallback: If we reach here and no custom sound is configured,
    // the user should set up a custom sound in admin settings
    console.log('No custom ping sound configured. Set one in Admin > Notifications.');
  }, []);

  // Subscribe to ping events via Realtime
  useEffect(() => {
    if (!taskId) return;

    const subscribeToTaskPings = () => {
      const channel = supabase.channel(`task:${taskId}`);

      channel
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_log',
          filter: `task_id=eq.${taskId}`,
        }, (payload) => {
          // Check if this is a ping event
          if (payload.new.event_type === 'task_pinged') {
            playPingSound();
            successToast('Task pinged! 📢');
          }
        })
        .subscribe((status) => {
          console.log('Ping subscription status:', status);
        });

      channelRef.current = channel;
    };

    subscribeToTaskPings();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [taskId, playPingSound]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(console.warn);
      }
    };
  }, []);

  return { playPingSound, loadingSound };
};
