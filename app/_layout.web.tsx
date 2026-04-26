import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View, Text } from 'react-native';
import 'react-native-reanimated';
import '../global.css';
import { cssInterop } from 'react-native-css-interop';

import { useColorScheme } from '@/components/useColorScheme';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ThemeProvider as AppThemeProvider } from '@/contexts/ThemeContext';
import { AlertProvider } from '@/contexts/AlertContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Sidebar from '@/components/Sidebar.web';

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
        <AppThemeProvider>
          <AlertProvider>
            <RootLayoutNav />
          </AlertProvider>
        </AppThemeProvider>
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
      <View className="flex-1 bg-surface-background">
        {showSidebar ? (
          <Sidebar>
            <Slot />
          </Sidebar>
        ) : (
          <Slot />
        )}
      </View>
    </ThemeProvider>
  );
}
