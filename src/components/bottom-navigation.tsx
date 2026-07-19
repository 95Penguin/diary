import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '@/theme/tokens';

export type HomeView = 'timeline' | 'calendar';

export function BottomNavigation({ view, onChange, onCompose }: { view: HomeView; onChange: (view: HomeView) => void; onCompose: () => void }) {
  return <View style={styles.container}>
    <Pressable style={styles.item} onPress={() => onChange('timeline')}><Text style={[styles.icon, view === 'timeline' && styles.active]}>⌂</Text><Text style={[styles.label, view === 'timeline' && styles.active]}>时间轴</Text></Pressable>
    <Pressable accessibilityLabel="记录此刻" onPress={onCompose} style={({ pressed }) => [styles.compose, pressed && { opacity: 0.75 }]}><Text style={styles.plus}>＋</Text></Pressable>
    <Pressable style={styles.item} onPress={() => onChange('calendar')}><Text style={[styles.icon, view === 'calendar' && styles.active]}>▦</Text><Text style={[styles.label, view === 'calendar' && styles.active]}>日历</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { height: 82, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  item: { width: 90, alignItems: 'center', gap: 2 },
  icon: { color: colors.textFaint, fontSize: 22 }, label: { color: colors.textFaint, fontSize: 10 }, active: { color: colors.primary, fontWeight: '700' },
  compose: { width: 56, height: 56, marginTop: -30, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.primary, borderWidth: 5, borderColor: colors.background, shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  plus: { color: '#FFFFFF', fontSize: 29, marginTop: -2 },
});
