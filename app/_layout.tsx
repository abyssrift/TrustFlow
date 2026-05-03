import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View, Text, Platform } from 'react-native';
import 'react-native-reanimated';
import '../global.css';
import { cssInterop } from 'react-native-css-interop';

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
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { SubmissionProvider } from '../contexts/SubmissionContext';
import { useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import GlobalUploadBanner from '@/components/GlobalUploadBanner';
import TimerIsland from '@/components/TimerIsland';
import { TimerProvider } from '@/contexts/TimerContext';

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
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <Text className="text-typography-main">Loading TrustFlow...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <TimerProvider>
          <SubmissionProvider>
            <RootLayoutNav />
          </SubmissionProvider>
        </TimerProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

import { ThemeProvider as AppThemeProvider } from '@/contexts/ThemeContext';
import { AlertProvider } from '@/contexts/AlertContext';
import { usePushRegistration } from '@/hooks/usePushRegistration';
import { NotificationsProvider } from '@/contexts/NotificationsContext';

function PushRegistrationGuard() {
  usePushRegistration();
  return null;
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
      // Redirect to the login page.
      router.replace('/(auth)/login');
    } else if (session) {
      if (!profile?.company_id && !inOnboarding) {
        router.replace('/onboarding');
      } else if (profile?.company_id && (inAuthGroup || inOnboarding)) {
        router.replace('/(tabs)');
      }
    }
  }, [session, profile, initialized, segments]);

  return (
    <AppThemeProvider>
      <AlertProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <NotificationsProvider>
            <View className="flex-1 bg-surface-background">
            {/* Register for push notifications on native once user is signed in */}
              {session && Platform.OS !== 'web' && <PushRegistrationGuard />}
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
                <GlobalUploadBanner />
              </View>
            </View>
          </NotificationsProvider>
        </ThemeProvider>
      </AlertProvider>
    </AppThemeProvider>
  );
}
