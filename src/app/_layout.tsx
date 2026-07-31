import { router, Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Component, type ErrorInfo, type ReactNode, Suspense, useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, InteractionManager, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppLockGate } from '@/components/app-lock-gate';
import { AppDialogHost } from '@/components/app-dialog-host';
import { migrateDatabase } from '@/database/migrate';
import { useAppFonts } from '@/hooks/use-app-fonts';
import { AppPreferencesProvider, useAppPreferences } from '@/preferences/app-preferences';
import { colors } from '@/theme/tokens';
import { backfillVideoThumbnails } from '@/utils/video-thumbnail-cache';
import { AUTOMATIC_BACKUP_INTERVAL_MS, runAutomaticBackup } from '@/utils/automatic-backup';
import { recordAppError } from '@/utils/app-error-log';
import { finishStartupMetric, startupTimer } from '@/utils/startup-performance';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const fontsReady = useAppFonts();

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <DatabaseErrorBoundary>
        <Suspense fallback={<LoadingFallback />}>
          <SQLiteProvider databaseName="shishi.db" onInit={initializeDatabase} useSuspense>
            <AppPreferencesProvider><AutomaticBackupGate /><AppLockGate><AppStack /></AppLockGate><AppDialogHost /></AppPreferencesProvider>
          </SQLiteProvider>
        </Suspense>
      </DatabaseErrorBoundary>
    </GestureHandlerRootView>
  );
}

function AutomaticBackupGate() {
  const db = useSQLiteContext();
  const { preferences, ready, updatePreferences } = useAppPreferences();
  const running = useRef(false);

  useEffect(() => {
    async function check() {
      if (
        Platform.OS !== 'android'
        || !ready
        || !preferences.automaticBackupEnabled
        || !preferences.backupDirectoryUri
        || running.current
      ) return;
      const lastTime = preferences.lastAutomaticBackupAt ? Date.parse(preferences.lastAutomaticBackupAt) : 0;
      if (Number.isFinite(lastTime) && Date.now() - lastTime < AUTOMATIC_BACKUP_INTERVAL_MS) return;
      running.current = true;
      try {
        const result = await runAutomaticBackup(db, preferences.backupDirectoryUri);
        await updatePreferences({
          lastAutomaticBackupAt: result.now,
          lastBackupCheckAt: result.now,
          lastBackupHealth: result.missingMedia ? 'warning' : 'healthy',
        });
      } catch (error) {
        void recordAppError('automatic-backup', error);
        const now = new Date().toISOString();
        await updatePreferences({ lastBackupCheckAt: now, lastBackupHealth: 'failed' }).catch(() => undefined);
        console.warn('Automatic backup failed', error);
      } finally {
        running.current = false;
      }
    }
    const task = InteractionManager.runAfterInteractions(() => {
      setTimeout(() => void check(), 1_000);
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => { task.cancel(); subscription.remove(); };
  }, [db, preferences.automaticBackupEnabled, preferences.backupDirectoryUri, preferences.lastAutomaticBackupAt, ready, updatePreferences]);

  return null;
}

async function initializeDatabase(db: Parameters<typeof migrateDatabase>[0]) {
  const startedAt = startupTimer();
  await migrateDatabase(db);
  finishStartupMetric('database', startedAt);
  void backfillVideoThumbnails(db).catch((error) => {
    void recordAppError('video-thumbnail-backfill', error);
    console.warn('Video thumbnail backfill failed', error);
  });
}

function AppStack() {
  const { preferences } = useAppPreferences();
  useEffect(() => {
    const openBackup = (response: Notifications.NotificationResponse | null) => {
      const route = response?.notification.request.content.data?.route;
      if (route === '/backup') router.push('/backup');
    };
    const task = InteractionManager.runAfterInteractions(() => {
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        openBackup(response);
        if (response) void Notifications.clearLastNotificationResponseAsync();
      });
    });
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openBackup(response);
      void Notifications.clearLastNotificationResponseAsync();
    });
    return () => { task.cancel(); subscription.remove(); };
  }, []);

  return <>
          <StatusBar animated style={preferences.readingTheme === 'night' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: styles.content }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="compose" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="entry/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="history/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="memories" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="summaries" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="search" options={{ animation: 'fade_from_bottom' }} />
            <Stack.Screen name="favorites" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="drafts" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="trash" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="backup" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="about" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="metadata" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="content-management" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="templates" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="batch-manage" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="readable-export" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="location-health" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="footprint-map" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="location/[name]" options={{ animation: 'slide_from_right' }} />
          </Stack>
        </>;
}

class DatabaseErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    void recordAppError('app-render-or-database', error);
    console.error('Database initialization failed', error, info);
  }

  reload = () => {
    if (Platform.OS === 'web') window.location.reload();
    else this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const locked = this.state.error.message.includes('createSyncAccessHandle');
    const databaseRelated = /database|sqlite|migration|createSyncAccessHandle/i.test(this.state.error.message);
    return <View style={styles.errorPage}>
      <Text style={styles.errorTitle}>{locked ? '数据库正在被其他页面使用' : databaseRelated ? '暂时无法打开拾时' : '当前页面暂时无法显示'}</Text>
      <Text style={styles.errorDescription}>{locked ? '请关闭其他打开拾时的浏览器标签页，然后重新加载。手机 App 不受这个 Web 限制影响。' : databaseRelated ? '数据库初始化失败，请重新加载后再试。' : '页面组件运行时遇到问题，错误信息已保存到本地诊断。请重新加载后再试。'}</Text>
      <Pressable onPress={this.reload} style={styles.retryButton}><Text style={styles.retryText}>重新加载</Text></Pressable>
    </View>;
  }
}

export function unstable_settings() { return { initialRouteName: 'index' }; }

export function LoadingFallback() {
  return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  errorPage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.background },
  errorTitle: { color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }, errorDescription: { maxWidth: 360, marginTop: 12, color: colors.textSecondary, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  retryButton: { marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.primary }, retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
