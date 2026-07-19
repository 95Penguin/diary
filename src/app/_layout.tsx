import { NotoSansSC_400Regular } from '@expo-google-fonts/noto-sans-sc/400Regular';
import { NotoSerifSC_400Regular } from '@expo-google-fonts/noto-serif-sc/400Regular';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { migrateDatabase } from '@/database/migrate';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ShishiSans: NotoSansSC_400Regular,
    ShishiSerif: NotoSerifSC_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <Suspense fallback={<LoadingFallback />}>
      <SQLiteProvider databaseName="shishi.db" onInit={migrateDatabase} useSuspense>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: styles.content }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="compose" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="entry/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="search" options={{ animation: 'fade_from_bottom' }} />
        </Stack>
      </SQLiteProvider>
    </Suspense>
  );
}

export function unstable_settings() { return { initialRouteName: 'index' }; }

export function LoadingFallback() {
  return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
}

const styles = StyleSheet.create({
  content: { backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
