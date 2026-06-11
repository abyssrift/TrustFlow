import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';

// Mounted once at app root (both _layout.tsx and _layout.web.tsx). Keeps a
// single WebSocket channel alive for the current user and plays the ping
// sound whenever they are targeted.
export const useGlobalPingListener = () => {
  const { session } = useAuth();
  const { successToast } = useToast();
  const soundUrlRef = useRef<string | null>(null);
  const soundRef = useRef<any>(null);

  // Fetch the company ping sound URL once and keep it in a ref (no re-subscribe on load)
  useEffect(() => {
    if (!session) return;
    supabase
      .from('company_ping_sounds')
      .select('sound_url')
      .single()
      .then(({ data, error }) => {
        soundUrlRef.current = data?.sound_url ?? null;
        console.log('[PingListener] sound url loaded:', data?.sound_url?.slice(0, 80) ?? null, 'error:', error?.message ?? null);
      });
  }, [session]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      console.log('[PingListener] no user id — not subscribing');
      return;
    }

    console.log('[PingListener] subscribing for user:', userId);

    const channel = supabase
      .channel('global-ping-listener')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'task_ping_targets',
          filter: `target_user_id=eq.${userId}`,
        },
        async (payload) => {
          console.log('[PingListener] ping event received:', JSON.stringify(payload.new));
          successToast('You have been pinged! 📢');

          const url = soundUrlRef.current;
          if (!url) {
            console.log('[PingListener] no sound url — skipping audio');
            return;
          }

          try {
            if (Platform.OS === 'web') {
              // Web: use native HTMLAudioElement
              if (soundRef.current) {
                soundRef.current.pause();
                soundRef.current.currentTime = 0;
              }
              const audio = new Audio(url);
              soundRef.current = audio;
              await audio.play();
              console.log('[PingListener] web audio playing');
            } else {
              // Native: expo-audio (expo-av was removed from Expo Go in SDK 54+)
              const ExpoAudio = await import('expo-audio') as any;
              // Play through the iOS silent-mode switch
              await ExpoAudio.setAudioModeAsync({ playsInSilentMode: true }).catch((e: any) => {
                console.warn('[PingListener] setAudioModeAsync failed:', e?.message);
              });
              if (soundRef.current) {
                soundRef.current.remove();
                soundRef.current = null;
              }
              const player = ExpoAudio.createAudioPlayer({ uri: url });
              soundRef.current = player;
              player.volume = 1.0;
              player.addListener('playbackStatusUpdate', (status: any) => {
                console.log('[PingListener] player status:', JSON.stringify({
                  isLoaded: status?.isLoaded,
                  playing: status?.playing,
                  didJustFinish: status?.didJustFinish,
                  duration: status?.duration,
                  currentTime: status?.currentTime,
                  reasonForWaitingToPlay: status?.reasonForWaitingToPlay,
                }));
              });
              player.play();
              console.log('[PingListener] player.play() called for:', url.slice(0, 80));
            }
          } catch (err: any) {
            console.warn('[PingListener] sound playback failed:', err?.name, err?.message);
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[PingListener] channel status:', status, err ? `error: ${err.message}` : '');
      });

    return () => {
      console.log('[PingListener] unsubscribing');
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, successToast]);

  useEffect(() => {
    return () => {
      try {
        if (Platform.OS === 'web') {
          soundRef.current?.pause();
        } else {
          soundRef.current?.remove();
        }
      } catch { /* already released */ }
    };
  }, []);
};
