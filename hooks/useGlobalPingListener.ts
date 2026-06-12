import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePingHighlight } from '@/contexts/PingHighlightContext';
import { useRouter } from 'expo-router';

// Mounted once at app root (both _layout.tsx and _layout.web.tsx). Keeps a
// single WebSocket channel alive for the current user and plays the ping
// sound whenever they are targeted.
//
// The sound is preloaded when the session starts: on web via a persistent
// HTMLAudioElement, on native by downloading to the cache directory once per
// uploaded version (the ?v= param changes on re-upload) and keeping a loaded
// player. Pings then play instantly with no network fetch.
export const useGlobalPingListener = () => {
  const { session } = useAuth();
  const { showToast } = useToast();
  const { addPingedTask } = usePingHighlight();
  const router = useRouter();
  const playerRef = useRef<any>(null);

  // Preload the company ping sound once per session
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const preload = async () => {
      const { data, error } = await supabase
        .from('company_ping_sounds')
        .select('sound_url')
        .single();

      const url = data?.sound_url ?? null;
      console.log('[PingListener] sound url loaded:', url?.slice(0, 80) ?? null, 'error:', error?.message ?? null);
      if (!url || cancelled) return;

      try {
        if (Platform.OS === 'web') {
          const audio = new Audio(url);
          audio.preload = 'auto';
          playerRef.current = audio;
          console.log('[PingListener] web audio preloaded');
          return;
        }

        // Native: cache the file locally, keyed by upload version
        const version = url.split('?v=')[1]?.split('&')[0] ?? 'default';
        const { File, Paths } = await import('expo-file-system') as any;
        const file = new File(Paths.cache, `ping-sound-${version}.mp3`);

        if (!file.exists) {
          console.log('[PingListener] downloading sound to cache...');
          await File.downloadFileAsync(url, file);
        }
        if (cancelled) return;

        const ExpoAudio = await import('expo-audio') as any;
        await ExpoAudio.setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
        const player = ExpoAudio.createAudioPlayer({ uri: file.uri });
        player.volume = 1.0;
        playerRef.current = player;
        console.log('[PingListener] native audio preloaded from:', file.uri);
      } catch (err: any) {
        console.warn('[PingListener] sound preload failed:', err?.message);
      }
    };

    preload();
    return () => { cancelled = true; };
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

          // Play sound immediately — don't wait for the title fetch
          const player = playerRef.current;
          if (!player) {
            console.log('[PingListener] no preloaded player — skipping audio');
          } else {
            try {
              if (Platform.OS === 'web') {
                player.currentTime = 0;
                player.play().catch((err: any) => console.warn('[PingListener] sound playback failed:', err?.name, err?.message));
              } else {
                player.seekTo(0).then(() => player.play()).catch((err: any) => console.warn('[PingListener] sound playback failed:', err?.name, err?.message));
              }
            } catch (err: any) {
              console.warn('[PingListener] sound playback failed:', err?.name, err?.message);
            }
          }

          // Fetch task title for a descriptive toast (non-blocking from audio perspective)
          let taskTitle: string | null = null;
          try {
            const { data } = await supabase
              .from('tasks')
              .select('title')
              .eq('id', payload.new.task_id)
              .single();
            taskTitle = data?.title ?? null;
          } catch { /* show generic toast if lookup fails */ }

          const taskId = payload.new.task_id;
          addPingedTask(taskId);
          showToast({
            type: 'success',
            title: 'Pinged!',
            message: taskTitle ? `You were pinged on "${taskTitle}"` : 'You have been pinged on a task',
            duration: 6000,
            onPress: () => router.push(`/task/${taskId}` as any),
          });
        }
      )
      .subscribe((status, err) => {
        console.log('[PingListener] channel status:', status, err ? `error: ${err.message}` : '');
      });

    return () => {
      console.log('[PingListener] unsubscribing');
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, showToast]);

  // Release the player on unmount
  useEffect(() => {
    return () => {
      try {
        if (Platform.OS === 'web') playerRef.current?.pause();
        else playerRef.current?.remove();
      } catch { /* already released */ }
    };
  }, []);
};
