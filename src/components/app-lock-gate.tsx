import * as LocalAuthentication from 'expo-local-authentication';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export function AppLockGate({ children }: { children: ReactNode }) {
  const { preferences, ready, readingTheme } = useAppPreferences();
  const [locked, setLocked] = useState(true);
  const [checking, setChecking] = useState(false);
  const authenticating = useRef(false);
  const backgroundedAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (!preferences.appLockEnabled || authenticating.current) return;
    authenticating.current = true;
    setChecking(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '解锁拾时',
        cancelLabel: '取消',
        fallbackLabel: '使用锁屏密码',
        disableDeviceFallback: false,
      });
      if (result.success) setLocked(false);
    } finally {
      authenticating.current = false;
      setChecking(false);
    }
  }, [preferences.appLockEnabled]);

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => setLocked(preferences.appLockEnabled));
    return () => cancelAnimationFrame(frame);
  }, [preferences.appLockEnabled, ready]);

  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (authenticating.current) return;
      if (state === 'active') {
        if (
          preferences.appLockEnabled
          && backgroundedAt.current
          && Date.now() - backgroundedAt.current >= preferences.appLockDelaySeconds * 1000
        ) {
          setLocked(true);
        }
        backgroundedAt.current = null;
      } else {
        backgroundedAt.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, [preferences.appLockDelaySeconds, preferences.appLockEnabled]);

  if (!ready) {
    return <View style={[styles.center, { backgroundColor: readingTheme.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!preferences.appLockEnabled || !locked) return children;

  return <View accessibilityViewIsModal style={[styles.center, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.mark, { backgroundColor: readingTheme.surface }]}><Text style={styles.markText}>时</Text></View>
    <Text style={[styles.title, { color: readingTheme.text }]}>拾时已锁定</Text>
    <Text style={[styles.description, { color: readingTheme.secondary }]}>使用手机的指纹、人脸或锁屏密码解锁</Text>
    <Pressable
      accessibilityRole="button"
      disabled={checking}
      onPress={() => void unlock()}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {checking ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>解锁</Text>}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  mark: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 32 },
  markText: { color: colors.primary, fontFamily: fonts.serif, fontSize: 25 },
  title: { marginTop: spacing.xl, fontFamily: fonts.serif, fontSize: 20, fontWeight: '600' },
  description: { marginTop: spacing.sm, fontSize: 11, textAlign: 'center' },
  button: { minWidth: 132, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, borderRadius: radii.pill, backgroundColor: colors.primary },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
