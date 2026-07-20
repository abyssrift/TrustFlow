import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import 'react-native-reanimated';
import '../global.css';

// Polyfill Platform global for libraries that expect it
if (typeof (globalThis as any).Platform === 'undefined') {
  (globalThis as any).Platform = Platform;
}

import { useColorScheme } from '@/components/useColorScheme';

// Interop for Icons to support Tailwind colors
cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export {
    // Catch any errors thrown by the Layout component.
    ErrorBoundary
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

import BrandSplash from '@/components/BrandSplash';
import GlobalUploadBanner from '@/components/GlobalUploadBanner';
import NetworkStatusBanner from '@/components/NetworkStatusBanner';
import TimerIsland from '@/components/TimerIsland';
import WelcomeTour from '@/components/onboarding/WelcomeTour';
import { TimerProvider, useTimer } from '@/contexts/TimerContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { SubmissionProvider } from '../contexts/SubmissionContext';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
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
          <RootLayoutNav />
        </TimerProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

import { AlertProvider } from '@/contexts/AlertContext';
import { AnalyticsProvider } from '@/contexts/AnalyticsContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { ThemeProvider as AppThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { usePushRegistration } from '@/hooks/usePushRegistration';
import { usePushAutoSubscribe } from '@/hooks/usePushAutoSubscribe';
import { useGlobalPingListener } from '@/hooks/useGlobalPingListener';
import { PingHighlightProvider } from '@/contexts/PingHighlightContext';
import WebPushPrompt from '@/components/WebPushPrompt';

function PushRegistrationGuard() {
  usePushRegistration();
  return null;
}

function WebPushAutoSubscribeGuard() {
  usePushAutoSubscribe();
  return null;
}

function GlobalPingGuard() {
  useGlobalPingListener();
  return null;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, profile, initialized } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();

  // Save current route to storage whenever it changes.
  // NOTE: must be the resolved pathname (e.g. /task/abc-123) — useSegments()
  // returns route placeholders, so joining them saved the literal "/task/[id]",
  // which restored to a broken task page whose back target was the dashboard.
  useEffect(() => {
    const skip = segments[0] === '(auth)' || segments[0] === 'onboarding' || segments[0] === 'share';
    if (initialized && session && profile?.company_id && !skip) {
      AsyncStorage.setItem('@TrustFlow_current_route', pathname).catch(e => {
        console.warn('Failed to save current route:', e);
      });
    }
  }, [pathname, segments, initialized, session, profile?.company_id]);

  useEffect(() => {
    if (!initialized) {
      if (Platform.OS !== 'web') console.log('[RootLayoutNav] [Native] Waiting for initialized=true...');
      return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';

    // Public FileHub share links (/share/[token]) are meant to be opened by
    // logged-out recipients outside the app entirely — never redirect them.
    if (segments[0] === 'share') return;

    if (Platform.OS === 'web') {
      // Original Web Logic - preserved exactly as requested
      if (!session && !inAuthGroup) {
        console.log('[RootLayoutNav] [Web] No session, redirecting to login');
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
      return;
    }

    // Mobile/Native Hardened Logic
    console.log('[RootLayoutNav] [Native] Auth State:', {
      hasSession: !!session,
      hasProfile: !!profile,
      companyId: profile?.company_id,
      segments
    });

    if (!session && !inAuthGroup) {
      console.log('[RootLayoutNav] [Native] Redirecting to login - no session');
      router.replace('/(auth)/login');
    } else if (session) {
      // CRITICAL: If profile is still null (loading in background), do NOT redirect
      // to onboarding. Wait for profile to load first to avoid the race condition
      // where session is set but profile hasn't been fetched yet.
      if (profile === null) {
        console.log('[RootLayoutNav] [Native] Session exists but profile still loading, waiting...');
        return; // Don't navigate yet — wait for profile to load
      }

      if (!profile.company_id && !inOnboarding) {
        console.log('[RootLayoutNav] [Native] Profile loaded but no company, redirecting to onboarding');
        router.replace('/onboarding');
      } else if (profile.company_id && (inAuthGroup || inOnboarding)) {
        console.log('[RootLayoutNav] [Native] Ready! Restoring route or going to tabs');
        const restoreSavedRoute = async () => {
          try {
            const savedRoute = await AsyncStorage.getItem('@TrustFlow_current_route');
            if (savedRoute && !savedRoute.startsWith('/(auth)') && !savedRoute.startsWith('/onboarding') && !savedRoute.includes('[')) {
              if (savedRoute.startsWith('/task/')) {
                // Seed the board underneath the task page so "back" returns to
                // the tasks board instead of the tabs navigator's initial tab
                // (the dashboard), which is all a bare replace() leaves behind.
                router.replace('/(tabs)/tasks' as any);
                router.push(savedRoute as any);
              } else {
                router.replace(savedRoute as any);
              }
            } else {
              router.replace('/(tabs)');
            }
          } catch (e) {
            router.replace('/(tabs)');
          }
        };
        restoreSavedRoute();
      }
    }
  }, [session, profile, initialized, segments]);

  return (
    <AppThemeProvider>
      <AnalyticsProvider>
        <AlertProvider>
          <SubmissionProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <NotificationsProvider>
                <ToastProvider>
                  <PingHighlightProvider>
                    <ThemedRoot />
                  </PingHighlightProvider>
                </ToastProvider>
              </NotificationsProvider>
            </ThemeProvider>
          </SubmissionProvider>
        </AlertProvider>
      </AnalyticsProvider>
    </AppThemeProvider>
  );
}

import LoadingOverlay from '@/components/LoadingOverlay';

function ThemedRoot() {
  const { themeVariables, isLoading } = useTheme();
  const { session, initialized } = useAuth();
  const { smartTimer } = useTimer();

  return (
    <View style={themeVariables} className="flex-1">
      <View
        className="flex-1 bg-surface-background"
        onTouchStart={Platform.OS !== 'web' ? () => smartTimer.recordActivity() : undefined}
      >
        {/* Register for push notifications on native once user is signed in */}
        {session && Platform.OS !== 'web' && <PushRegistrationGuard />}
        {/* Auto-subscribe to web push on every login if not already active */}
        {session && Platform.OS === 'web' && <WebPushAutoSubscribeGuard />}
        {/* Always-on ping listener — one WebSocket channel for the current user */}
        {session && <GlobalPingGuard />}

        {/* Global Loading Overlay */}
        {(!initialized || isLoading) && <LoadingOverlay />}

        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="admin/pipelines" options={{ headerShown: false }} />
          <Stack.Screen name="admin/roles" options={{ headerShown: false }} />
          <Stack.Screen name="admin/notifications" options={{ headerShown: false }} />
          <Stack.Screen name="notifications/preferences" options={{ headerShown: false }} />
          <Stack.Screen name="task/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
        <TimerIsland />
        <View className="absolute top-0 left-0 right-0 z-[999]">
          <NetworkStatusBanner />
          <GlobalUploadBanner />
        </View>
        {session && <WebPushPrompt />}
        {session && <WelcomeTour />}
      </View>
    </View>
  );
}
