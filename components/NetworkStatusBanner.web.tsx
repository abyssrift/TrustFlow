import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { supabaseUrl } from '@/lib/supabase';

type BannerState = {
  visible: boolean;
  title: string;
  message: string;
  icon: 'exclamation-triangle' | 'wifi';
};

type WebConnectionInfo = {
  online: boolean;
  effectiveType?: string;
  saveData?: boolean;
  reachable?: boolean;
};

const REACHABILITY_PROBE_INTERVAL_MS = 20000;
const REACHABILITY_PROBE_TIMEOUT_MS = 5000;

function abortWithReason(controller: AbortController, reason: Error) {
  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
}

function useWebConnectionInfo() {
  const [connectionInfo, setConnectionInfo] = useState<WebConnectionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    let probeInFlight = false;
    let activeController: AbortController | null = null;

    const probeReachability = async () => {
      if (cancelled || probeInFlight) return;
      probeInFlight = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = setTimeout(() => {
        const reason = new Error('Reachability probe timed out');
        reason.name = 'AbortError';
        abortWithReason(controller, reason);
      }, REACHABILITY_PROBE_TIMEOUT_MS);

      try {
        await fetch(`${supabaseUrl}/auth/v1/health`, { cache: 'no-store', signal: controller.signal });
        if (!cancelled) setConnectionInfo(prev => (prev ? { ...prev, reachable: true } : prev));
      } catch {
        // Unmount cancellation is expected; timeout and real fetch failures
        // still mark the backend unreachable for the production banner.
        if (cancelled) return;
        setConnectionInfo(prev => (prev ? { ...prev, reachable: false } : prev));
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        probeInFlight = false;
      }
    };

    const updateConnectionInfo = () => {
      const nav = navigator as any;
      const navigatorConnection = nav.connection || nav.mozConnection || nav.webkitConnection;

      setConnectionInfo(prev => ({
        online: navigator.onLine,
        effectiveType: navigatorConnection?.effectiveType,
        saveData: navigatorConnection?.saveData,
        reachable: prev?.reachable,
      }));

      probeReachability();
    };

    updateConnectionInfo();
    window.addEventListener('online', updateConnectionInfo);
    window.addEventListener('offline', updateConnectionInfo);

    const nav = navigator as any;
    const navigatorConnection = nav.connection || nav.mozConnection || nav.webkitConnection;
    navigatorConnection?.addEventListener?.('change', updateConnectionInfo);
    const interval = setInterval(probeReachability, REACHABILITY_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (activeController) {
        const reason = new Error('Reachability probe cancelled during unmount');
        reason.name = 'AbortError';
        abortWithReason(activeController, reason);
      }
      window.removeEventListener('online', updateConnectionInfo);
      window.removeEventListener('offline', updateConnectionInfo);
      navigatorConnection?.removeEventListener?.('change', updateConnectionInfo);
      clearInterval(interval);
    };
  }, []);

  return connectionInfo;
}

export default function NetworkStatusBanner() {
  const webConnectionInfo = useWebConnectionInfo();
  const bannerState = useMemo<BannerState | null>(() => {
    if (!webConnectionInfo) return null;

    const slowNetwork = webConnectionInfo.saveData ||
      webConnectionInfo.effectiveType === 'slow-2g' ||
      webConnectionInfo.effectiveType === '2g' ||
      webConnectionInfo.effectiveType === '3g';

    if (!webConnectionInfo.online || webConnectionInfo.reachable === false) {
      return {
        visible: true,
        title: 'Offline',
        message: 'You are offline. Some actions will wait until your connection returns.',
        icon: 'exclamation-triangle',
      };
    }

    if (slowNetwork) {
      return {
        visible: true,
        title: 'Slow network',
        message: 'Your connection looks slow. Actions may take longer to complete or sync.',
        icon: 'wifi',
      };
    }

    return null;
  }, [webConnectionInfo]);

  if (!bannerState?.visible) return null;

  return (
    <View className="bg-state-warning shadow-lg">
      <View className="px-4 py-3 flex-row items-start">
        <View className="w-8 h-8 rounded-full bg-white/15 items-center justify-center mr-3 mt-0.5">
          <FontAwesome name={bannerState.icon} size={14} color="#fff" />
        </View>
        <View className="flex-1 mr-3">
          <Text className="text-white text-[10px] font-black uppercase tracking-[0.2em] opacity-80" numberOfLines={1}>
            {bannerState.title}
          </Text>
          <Text className="text-white text-xs font-medium leading-4 mt-1" numberOfLines={2}>
            {bannerState.message}
          </Text>
        </View>
      </View>
    </View>
  );
}
