// Web-only hook — only import from .web.tsx files.
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = (process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
const DEVICE_ID_KEY = 'tf_push_device_id';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

// Decoded once at module load — avoids re-decoding on every subscribe() call.
// Null means the key is missing or malformed; subscribe() will bail early.
const APP_SERVER_KEY: Uint8Array | null = (() => {
  if (!VAPID_PUBLIC_KEY) return null;
  try {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    if (key.length !== 65 || key[0] !== 0x04) {
      console.error(
        `[push] Invalid VAPID public key: decoded ${key.length} bytes, first byte 0x${key[0]?.toString(16) ?? '?'}. ` +
        'Expected 65 bytes starting with 0x04. Check EXPO_PUBLIC_VAPID_PUBLIC_KEY.'
      );
      return null;
    }
    return key;
  } catch (e) {
    console.error('[push] Failed to decode VAPID_PUBLIC_KEY:', e);
    return null;
  }
})();

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading';

export function usePushSubscription() {
  const [state, setState] = useState<PushState>('loading');

  const checkState = useCallback(async () => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg) {
        setState('unsubscribed');
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'subscribed' : 'unsubscribed');
    } catch {
      setState('unsupported');
    }
  }, []);

  useEffect(() => {
    checkState();
  }, [checkState]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!APP_SERVER_KEY) {
      console.warn('[push] EXPO_PUBLIC_VAPID_PUBLIC_KEY is missing or invalid');
      return false;
    }
    setState('loading');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        return false;
      }

      // Register the SW inline if +html.tsx hasn't done it yet (e.g. first load in dev).
      const existing = await navigator.serviceWorker.getRegistration('/');
      if (!existing) {
        await navigator.serviceWorker.register('/sw.js');
      }

      // Race with a timeout so we never hang if /sw.js isn't being served.
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Service worker did not activate. Check that /sw.js is being served.')),
            8000
          )
        ),
      ]);

      // Clear any stale subscription — Chrome throws AbortError on re-subscribe with a different key.
      const staleSub = await reg.pushManager.getSubscription();
      if (staleSub) await staleSub.unsubscribe();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: APP_SERVER_KEY as any,
      });
      await supabase.rpc('rpc_upsert_push_subscription', {
        p_type: 'web',
        p_token: JSON.stringify(sub.toJSON()),
        p_device_id: getOrCreateDeviceId(),
        p_platform: 'web',
      });
      setState('subscribed');
      return true;
    } catch (err) {
      console.error('[push] subscribe failed:', err);
      await checkState();
      return false;
    }
  }, [checkState]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    setState('loading');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) await sub.unsubscribe();
      const deviceId = localStorage.getItem(DEVICE_ID_KEY);
      if (deviceId) {
        await supabase.rpc('rpc_revoke_push_subscription', { p_device_id: deviceId });
      }
      setState('unsubscribed');
    } catch (err) {
      console.error('[push] unsubscribe failed:', err);
      await checkState();
    }
  }, [checkState]);

  return { state, subscribe, unsubscribe };
}
