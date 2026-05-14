import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import 'react-native-reanimated';
import '../global.css';

import NetworkStatusBanner from '@/components/NetworkStatusBanner';
import Sidebar from '@/components/Sidebar.web';
import TimerIsland from '@/components/TimerIsland';
import { useColorScheme } from '@/components/useColorScheme';
import { AlertProvider } from '@/contexts/AlertContext';
import { AnalyticsProvider } from '@/contexts/AnalyticsContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { SubmissionProvider } from '@/contexts/SubmissionContext';
import { ThemeProvider as AppThemeProvider } from '@/contexts/ThemeContext';
import { TimerProvider } from '@/contexts/TimerContext';
import { ToastProvider } from '@/contexts/ToastContext';
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
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <Text className="text-typography-main">Loading TrustFlow...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SubmissionProvider>
          <TimerProvider>
            <AppThemeProvider>
              <AlertProvider>
                <ToastProvider>
                  <RootLayoutNav />
                </ToastProvider>
              </AlertProvider>
            </AppThemeProvider>
          </TimerProvider>
        </SubmissionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, profile, initialized } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';

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

  const showSidebar = session && segments[0] !== '(auth)' && segments[0] !== 'onboarding';

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnalyticsProvider>
        <NotificationsProvider>
          <View className="flex-1 bg-surface-background">
            <TimerIsland />
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
        </NotificationsProvider>
      </AnalyticsProvider>
    </ThemeProvider>
  );
}
