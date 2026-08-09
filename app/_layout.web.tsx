import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import 'react-native-reanimated';
import '../global.css';

import BrandSplash from '@/components/BrandSplash';
import NetworkStatusBanner from '@/components/NetworkStatusBanner';
import Sidebar from '@/components/Sidebar.web';
import IslandTimeApprovalsBridge from '@/components/island/IslandTimeApprovalsBridge.web';
import IslandTimerBridge from '@/components/island/IslandTimerBridge.web';
import TimerIsland from '@/components/TimerIsland';
import WelcomeTour from '@/components/onboarding/WelcomeTour';
import { useColorScheme } from '@/components/useColorScheme';
import { TourProvider } from '@/lib/tour/TourContext';
import TourOverlay from '@/lib/tour/TourOverlay.web';
import { useNavTourAutoStart } from '@/lib/tour/navTour';
import { AlertProvider } from '@/contexts/AlertContext';
import { AnalyticsProvider } from '@/contexts/AnalyticsContext';
import { IslandProvider } from '@/contexts/IslandContext';
import { UploadManagerProvider } from '@/contexts/UploadManagerContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { SubmissionProvider } from '@/contexts/SubmissionContext';
import { ThemeProvider as AppThemeProvider } from '@/contexts/ThemeContext';
import { TimerProvider } from '@/contexts/TimerContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { useGlobalPingListener } from '@/hooks/useGlobalPingListener';
import { PingHighlightProvider } from '@/contexts/PingHighlightContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync().catch(() => { });
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return <BrandSplash />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <TimerProvider>
          <AppThemeProvider>
            <AlertProvider>
              <SubmissionProvider>
                <ToastProvider>
                  <IslandProvider>
                    <UploadManagerProvider>
                      <TourProvider>
                        <RootLayoutNav />
                      </TourProvider>
                    </UploadManagerProvider>
                  </IslandProvider>
                </ToastProvider>
              </SubmissionProvider>
            </AlertProvider>
          </AppThemeProvider>
        </TimerProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function GlobalPingGuard() {
  useGlobalPingListener();
  return null;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, profile, initialized } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [welcomeToured, setWelcomeToured] = useState(false);

  // Ready to start the nav tour once WelcomeTour has run this session, or
  // for users who already completed it before this feature shipped.
  useNavTourAutoStart(!!profile?.onboarded_at || welcomeToured);

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';

    // Public FileHub share links (/share/[token]) are meant to be opened by
    // logged-out recipients outside the app entirely — never redirect them.
    if (segments[0] === 'share') return;

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session) {
      // Wait for profile to load before making redirection decisions
      if (profile === null) return;

      if (!profile?.company_id && !inOnboarding) {
        router.replace('/onboarding');
      } else if (profile?.company_id && (inAuthGroup || inOnboarding)) {
        router.replace('/(tabs)');
      }
    }
  }, [session, profile, initialized, segments]);

  const showSidebar = session && segments[0] !== '(auth)' && segments[0] !== 'onboarding' && segments[0] !== 'share';

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnalyticsProvider>
        <NotificationsProvider>
          <PingHighlightProvider>
          {/* 100dvh, not 100vh: on mobile browsers `vh` is the *large* viewport and
              includes the space behind the retracting address bar, so a 100vh root
              overflows the (overflow:hidden) body and clips whatever sits at its
              bottom edge — namely the floating mobile nav. `dvh` tracks the
              visible viewport instead. Matches body's sizing in global.css. */}
          <View className="flex-1 bg-surface-background" style={{ flex: 1, minHeight: '100dvh', height: '100%', width: '100%' } as any}>
            {/* Always-on ping listener — one WebSocket channel for the current user */}
            {session && <GlobalPingGuard />}
            {session && <WelcomeTour onComplete={() => setWelcomeToured(true)} />}
            <TourOverlay />
            {/* Desktop web shows the timer in the topbar island (published via
                IslandTimerBridge), so only draw the floating pill on mobile web
                (< 768). The bridge mirrors the running timer into the island. */}
            <TimerIsland floating={width < 768} />
            {session && width >= 768 && <IslandTimerBridge />}
            {session && width >= 768 && <IslandTimeApprovalsBridge />}
            <View className="absolute top-0 left-0 right-0 z-[999]">
              <NetworkStatusBanner />
            </View>
            {showSidebar ? (
              <Sidebar>
                <Slot />
              </Sidebar>
            ) : (
              <Slot />
            )}
          </View>
          </PingHighlightProvider>
        </NotificationsProvider>
      </AnalyticsProvider>
    </ThemeProvider>
  );
}
