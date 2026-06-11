import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// Sound-playback utility only. Receiving pings is handled globally by
// useGlobalPingListener (mounted at app root) — no subscription here.
export const usePingNotification = () => {
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const soundRef = useRef<any>(null);

  useEffect(() => {
    supabase
      .from('company_ping_sounds')
      .select('sound_url')
      .single()
      .then(({ data }) => setSoundUrl(data?.sound_url ?? null));
  }, []);

  const playPingSound = useCallback(async () => {
    if (!soundUrl) return;
    try {
      if (Platform.OS === 'web') {
        if (soundRef.current) {
          soundRef.current.pause();
          soundRef.current.currentTime = 0;
        }
        const audio = new Audio(soundUrl);
        soundRef.current = audio;
        await audio.play();
      } else {
        const ExpoAudio = await import('expo-audio') as any;
        if (soundRef.current) {
          soundRef.current.remove();
          soundRef.current = null;
        }
        const player = ExpoAudio.createAudioPlayer({ uri: soundUrl });
        soundRef.current = player;
        player.play();
      }
    } catch (err) {
      console.error('Failed to play ping sound:', err);
    }
  }, [soundUrl]);

  useEffect(() => {
    return () => {
      try {
        if (Platform.OS === 'web') soundRef.current?.pause();
        else soundRef.current?.remove();
      } catch { /* already released */ }
    };
  }, []);

  return { playPingSound };
};
