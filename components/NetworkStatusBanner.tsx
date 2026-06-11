import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useNetInfo } from '@react-native-community/netinfo';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
};

function useWebConnectionInfo() {
  const [connectionInfo, setConnectionInfo] = useState<WebConnectionInfo | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const updateConnectionInfo = () => {
      const nav = navigator as any;
      const navigatorConnection =
        nav.connection ||
        nav.mozConnection ||
        nav.webkitConnection;

      setConnectionInfo({
        online: navigator.onLine,
        effectiveType: navigatorConnection?.effectiveType,
        saveData: navigatorConnection?.saveData,
      });
    };

    updateConnectionInfo();

    window.addEventListener('online', updateConnectionInfo);
    window.addEventListener('offline', updateConnectionInfo);

    const nav = navigator as any;
    const navigatorConnection =
      nav.connection ||
      nav.mozConnection ||
      nav.webkitConnection;

    navigatorConnection?.addEventListener?.('change', updateConnectionInfo);

    return () => {
      window.removeEventListener('online', updateConnectionInfo);
      window.removeEventListener('offline', updateConnectionInfo);
      navigatorConnection?.removeEventListener?.('change', updateConnectionInfo);
    };
  }, []);

  return connectionInfo;
}

function useBannerState(): BannerState | null {
  const netInfo = useNetInfo();
  const webConnectionInfo = useWebConnectionInfo();

  return useMemo(() => {
    if (Platform.OS === 'web') {
      if (!webConnectionInfo) return null;

      const slowNetwork =
        webConnectionInfo.saveData ||
        webConnectionInfo.effectiveType === 'slow-2g' ||
        webConnectionInfo.effectiveType === '2g' ||
        webConnectionInfo.effectiveType === '3g';

      if (!webConnectionInfo.online) {
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
    }

    const reachable = netInfo.isInternetReachable;
    const connected = netInfo.isConnected;
    const details = netInfo.details as any;
    const generation = details?.cellularGeneration;
    const expensive = details?.isConnectionExpensive;

    if (connected === null && reachable === null) return null;

    if (connected === false || reachable === false) {
      return {
        visible: true,
        title: 'Offline',
        message: 'You are offline. Some actions will wait until your connection returns.',
        icon: 'exclamation-triangle',
      };
    }

    const slowNetwork = generation === '2g' || generation === '3g' || expensive === true;

    if (slowNetwork) {
      return {
        visible: true,
        title: 'Slow network',
        message: 'Your connection looks slow. Actions may take longer to complete or sync.',
        icon: 'wifi',
      };
    }

    return null;
  }, [(netInfo.details as any)?.cellularGeneration, (netInfo.details as any)?.isConnectionExpensive, netInfo.isConnected, netInfo.isInternetReachable, webConnectionInfo]);
}

export default function NetworkStatusBanner() {
  const insets = useSafeAreaInsets();
  const bannerState = useBannerState();

  if (!bannerState?.visible) return null;

  return (
    <View style={{ paddingTop: Platform.OS === 'web' ? 0 : insets.top }} className="bg-state-warning shadow-lg">
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