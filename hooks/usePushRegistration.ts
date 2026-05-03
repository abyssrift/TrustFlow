// ====================================================================
// usePushRegistration — Expo mobile push token lifecycle
// ====================================================================
//
// !! REQUIRES: expo-notifications (already installed)
//
// !! REQUIRES in Supabase Dashboard → Edge Functions → Secrets:
//    EXPO_ACCESS_TOKEN — from expo.dev → Account → Access Tokens
//    Without this, Expo's push receipts API calls from the `notify`
//    Edge Function won't be authenticated.
//    (The token send itself works without it; receipts cleanup needs it.)
//
// This hook is a no-op on web — call it unconditionally and it self-guards.
// ====================================================================

import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { supabase } from '@/lib/supabase'

const DEVICE_ID_KEY = 'trustflow_push_device_id'

// Stable device ID — generated once, persisted in AsyncStorage
async function getOrCreateDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY)
  if (stored) return stored

  const id =
    `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await AsyncStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push tokens don't work on simulators — skip silently
    return null
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return null

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId

  if (!projectId) {
    console.warn('[usePushRegistration] No EAS projectId — skipping token fetch')
    return null
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId })
  return tokenData.data
}

export function usePushRegistration() {
  // Only runs on native — web has its own Phase 6 VAPID path
  if (Platform.OS === 'web') return

  const tokenRefreshSub = useRef<Notifications.EventSubscription | null>(null)

  useEffect(() => {
    let cancelled = false

    async function setup() {
      const token = await registerForPushNotifications()
      if (!token || cancelled) return

      const deviceId = await getOrCreateDeviceId()

      const { error } = await supabase.rpc('rpc_upsert_push_subscription', {
        p_token: token,
        p_type: 'expo',
        p_device_id: deviceId,
        p_device_meta: {
          platform: Platform.OS,
          version: Platform.Version,
        },
      })

      if (error) {
        console.error('[usePushRegistration] upsert error:', error.message)
      }
    }

    setup()

    // Re-register on token rotation (rare but happens)
    tokenRefreshSub.current = Notifications.addPushTokenListener(async (tokenData) => {
      const deviceId = await getOrCreateDeviceId()
      await supabase.rpc('rpc_upsert_push_subscription', {
        p_token: tokenData.data,
        p_type: 'expo',
        p_device_id: deviceId,
        p_device_meta: {
          platform: Platform.OS,
          version: Platform.Version,
        },
      })
    })

    return () => {
      cancelled = true
      tokenRefreshSub.current?.remove()
    }
  }, [])
}
