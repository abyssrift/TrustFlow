// Web-only hook — only import from .web.tsx files.
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// Trim to guard against accidental whitespace/newlines in .env
const VAPID_PUBLIC_KEY = (process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
const DEVICE_ID_KEY = 'tf_push_device_id';

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

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
      // getRegistration() resolves immediately with undefined if no SW is registered.
      // serviceWorker.ready only resolves once a SW is active — never call it for a status check.
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
    if (!VAPID_PUBLIC_KEY) {
      console.warn('[push] EXPO_PUBLIC_VAPID_PUBLIC_KEY is not configured');
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
      let existing = await navigator.serviceWorker.getRegistration('/');
      if (!existing) {
        existing = await navigator.serviceWorker.register('/sw.js');
      }

      // serviceWorker.ready resolves once activated. Race with a timeout so we
      // never hang forever if the SW file isn't served (misconfigured dev env).
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Service worker did not activate. Check that /sw.js is being served.')),
            8000
          )
        ),
      ]);

      // VAPID public key must decode to exactly 65 bytes (uncompressed P-256 point).
      // If it's 32 bytes you've set the private key. If it's anything else the .env value is wrong.
      const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      console.log('[push] key length (chars):', VAPID_PUBLIC_KEY.length, '| decoded bytes:', appServerKey.length, '| first byte:', '0x' + appServerKey[0].toString(16));
      if (appServerKey.length !== 65) {
        throw new Error(
          `[push] VAPID public key decoded to ${appServerKey.length} bytes — expected 65. ` +
          `Check EXPO_PUBLIC_VAPID_PUBLIC_KEY in .env (${VAPID_PUBLIC_KEY.length} chars, should be 87).`
        );
      }

      // Confirm it's a valid P-256 EC point before handing it to FCM.
      // If importKey throws, the key bytes are not a valid curve point.
      try {
        await crypto.subtle.importKey('raw', appServerKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      } catch {
        throw new Error('[push] VAPID public key is not a valid P-256 point. Regenerate with: npx web-push generate-vapid-keys');
      }

      // Clear any stale subscription — Chrome throws AbortError if you subscribe
      // again with a different VAPID key without unsubscribing first.
      const staleSub = await reg.pushManager.getSubscription();
      if (staleSub) await staleSub.unsubscribe();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
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
