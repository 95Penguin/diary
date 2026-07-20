import { NotoSansSC_400Regular } from '@expo-google-fonts/noto-sans-sc/400Regular';
import { NotoSerifSC_400Regular } from '@expo-google-fonts/noto-serif-sc/400Regular';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Component, type ErrorInfo, type ReactNode, Suspense, useEffect } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

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
    <DatabaseErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <SQLiteProvider databaseName="shishi.db" onInit={migrateDatabase} useSuspense>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: styles.content }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="compose" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="entry/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="search" options={{ animation: 'fade_from_bottom' }} />
            <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="trash" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="backup" options={{ animation: 'slide_from_right' }} />
          </Stack>
        </SQLiteProvider>
      </Suspense>
    </DatabaseErrorBoundary>
  );
}

class DatabaseErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Database initialization failed', error, info); }

  reload = () => {
    if (Platform.OS === 'web') window.location.reload();
    else this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const locked = this.state.error.message.includes('createSyncAccessHandle');
    return <View style={styles.errorPage}>
      <Text style={styles.errorTitle}>{locked ? '数据库正在被其他页面使用' : '暂时无法打开拾时'}</Text>
      <Text style={styles.errorDescription}>{locked ? '请关闭其他打开拾时的浏览器标签页，然后重新加载。手机 App 不受这个 Web 限制影响。' : '数据库初始化失败，请重新加载后再试。'}</Text>
      <Pressable onPress={this.reload} style={styles.retryButton}><Text style={styles.retryText}>重新加载</Text></Pressable>
    </View>;
  }
}

export function unstable_settings() { return { initialRouteName: 'index' }; }

export function LoadingFallback() {
  return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
}

const styles = StyleSheet.create({
  content: { backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  errorPage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.background },
  errorTitle: { color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }, errorDescription: { maxWidth: 360, marginTop: 12, color: colors.textSecondary, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  retryButton: { marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.primary }, retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
