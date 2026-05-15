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
// This hook is a no-op on web and in Expo Go — call it unconditionally and it self-guards.
// ====================================================================

import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type * as NotificationsType from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { supabase } from '@/lib/supabase'

const DEVICE_ID_KEY = 'trustflow_push_device_id'

// expo-notifications dropped remote push support from Expo Go in SDK 53.
// DevicePushTokenAutoRegistration.fx.js fires addPushTokenListener as a
// module-load side effect, which calls console.error before we can catch it.
// Guard against loading the module at all in Expo Go.
const isExpoGo = Constants.appOwnership === 'expo'

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
    return null
  }
  if (isExpoGo) {
    return null
  }

  try {
    const Notifications = require('expo-notifications')
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
  } catch (error) {
    console.warn('[usePushRegistration] Push registration skipped (expected in Expo Go):', error)
    return null
  }
}

export function usePushRegistration() {
  // No-op on web (Phase 6 VAPID) and in Expo Go (unsupported since SDK 53)
  if (Platform.OS === 'web' || isExpoGo) return

  const tokenRefreshSub = useRef<NotificationsType.EventSubscription | null>(null)

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
        p_platform: Platform.OS,
      })

      if (error) {
        console.error('[usePushRegistration] upsert error:', error.message)
      }
    }

    setup()

    // Re-register on token rotation (rare but happens)
    try {
      const Notifications = require('expo-notifications')
      tokenRefreshSub.current = Notifications.addPushTokenListener(async (tokenData: any) => {
        const deviceId = await getOrCreateDeviceId()
        await supabase.rpc('rpc_upsert_push_subscription', {
          p_token: tokenData.data,
          p_type: 'expo',
          p_device_id: deviceId,
          p_platform: Platform.OS,
        })
      })
    } catch (err) {
      console.warn('[usePushRegistration] Could not add token listener (expected in Expo Go):', err)
    }

    return () => {
      cancelled = true
      tokenRefreshSub.current?.remove()
    }
  }, [])
}
