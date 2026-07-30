import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ExpoGaodeMapModule } from 'expo-gaode-map';
import { useSQLiteContext } from 'expo-sqlite';

import { colors, radii, spacing } from '@/theme/tokens';

const CONSENT_KEY = 'amap-privacy-consent-v1';
const PRIVACY_VERSION = '2026-07-30';

function configurePrivacy() {
  ExpoGaodeMapModule.setPrivacyConfig({
    hasShow: true,
    hasContainsPrivacy: true,
    hasAgree: true,
    privacyVersion: PRIVACY_VERSION,
  });
}

export function GaodeMapPrivacyGate({ children, onDecline }: { children: ReactNode; onDecline?: () => void }) {
  const db = useSQLiteContext();
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void db.getFirstAsync<{ value: string }>('SELECT value FROM kv_store WHERE key = ?', CONSENT_KEY)
      .then((row) => {
        if (!active) return;
        if (row?.value === PRIVACY_VERSION) {
          configurePrivacy();
          setAccepted(true);
        } else {
          setAccepted(false);
        }
      });
    return () => { active = false; };
  }, [db]);

  async function accept() {
    configurePrivacy();
    await db.runAsync(
      `INSERT INTO kv_store (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      CONSENT_KEY,
      PRIVACY_VERSION,
    );
    setAccepted(true);
  }

  if (accepted) return children;
  if (accepted === null) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return <View style={styles.center}>
    <Text style={styles.title}>使用地图前请确认</Text>
    <Text style={styles.message}>
      地图、地点搜索和地址解析由高德地图提供。使用这些功能时，高德地图 SDK 会处理设备信息、网络信息和你主动使用的位置信息；拾时不会在后台持续定位。
    </Text>
    <View style={styles.actions}>
      {onDecline ? <Pressable onPress={onDecline} style={styles.secondaryButton}><Text style={styles.secondaryText}>暂不使用</Text></Pressable> : null}
      <Pressable onPress={() => void accept()} style={styles.primaryButton}><Text style={styles.primaryText}>同意并使用</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, zIndex: 20, elevation: 20, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.primarySoft },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  message: { maxWidth: 330, marginTop: spacing.sm, color: colors.textSecondary, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  actions: { width: '100%', maxWidth: 300, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  primaryButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.primary },
  primaryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  secondaryButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.background },
  secondaryText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
});
