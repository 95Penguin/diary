import { useEffect, useState, type ComponentProps } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type DrawerItem = {
  label: string;
  route: Href;
  icon: ComponentProps<typeof SymbolView>['name'];
};

const groups: { title: string; items: DrawerItem[] }[] = [
  {
    title: '常用',
    items: [
      { label: '回忆', route: '/memories' as Href, icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' } },
      { label: '睡眠记录', route: '/sleep-log' as Href, icon: { ios: 'moon.zzz', android: 'bedtime', web: 'bedtime' } },
      { label: '草稿箱', route: '/drafts' as Href, icon: { ios: 'doc.text', android: 'draft', web: 'draft' } },
      { label: '收藏', route: '/favorites' as Href, icon: { ios: 'bookmark', android: 'bookmark', web: 'bookmark' } },
    ],
  },
  {
    title: '时光工具',
    items: [
      { label: '时光总结', route: '/summaries' as Href, icon: { ios: 'chart.bar.xaxis', android: 'bar_chart', web: 'bar_chart' } },
      { label: '时间胶囊', route: '/time-capsules' as Href, icon: { ios: 'hourglass', android: 'hourglass_empty', web: 'hourglass_empty' } },
      { label: '足迹地图', route: '/footprint-map' as Href, icon: { ios: 'map', android: 'map', web: 'map' } },
      { label: '时光像素', route: '/time-pixels' as Href, icon: { ios: 'square.grid.3x3', android: 'grid_view', web: 'grid_view' } },
    ],
  },
  {
    title: '整理',
    items: [
      { label: '媒体浏览', route: '/media-library' as Href, icon: { ios: 'photo.on.rectangle', android: 'perm_media', web: 'perm_media' } },
      { label: '内容管理', route: '/content-management' as Href, icon: { ios: 'folder', android: 'folder', web: 'folder' } },
    ],
  },
];

export function FunctionDrawer({ visible, draftCount, onClose }: { visible: boolean; draftCount: number; onClose: () => void }) {
  const { preferences, readingTheme } = useAppPreferences();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const drawerWidth = Math.min(width * 0.8, 340);
  const [translateX] = useState(() => new Animated.Value(-340));

  useEffect(() => {
    if (!visible) {
      translateX.setValue(-drawerWidth);
      return;
    }
    Animated.timing(translateX, {
      toValue: 0,
      duration: 190,
      useNativeDriver: true,
    }).start();
    return () => translateX.stopAnimation();
  }, [drawerWidth, translateX, visible]);

  function navigate(route: Href) {
    onClose();
    router.push(route);
  }

  return <Modal
    visible={visible}
    transparent
    animationType="fade"
    statusBarTranslucent={Platform.OS === 'android'}
    onRequestClose={onClose}
  >
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="关闭功能侧栏" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
      <Animated.View accessibilityViewIsModal style={[styles.drawer, { width: drawerWidth, backgroundColor: readingTheme.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.sm), transform: [{ translateX }] }]}>
        <View style={[styles.profile, { borderBottomColor: readingTheme.border }]}>
          {preferences.avatarUri
            ? <Image source={preferences.avatarUri} contentFit="cover" style={styles.avatar} />
            : <View style={styles.avatar}><Text style={styles.avatarText}>{preferences.nickname.slice(0, 1)}</Text></View>}
          <View style={styles.profileCopy}>
            <Text numberOfLines={1} style={[styles.nickname, { color: readingTheme.text }]}>{preferences.nickname}</Text>
            <Text numberOfLines={2} style={[styles.signature, { color: readingTheme.secondary }]}>{preferences.signature || '把日子慢慢收好。'}</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {groups.map((group) => <View key={group.title} style={styles.group}>
            <Text style={[styles.groupTitle, { color: readingTheme.secondary }]}>{group.title}</Text>
            {group.items.map((item) => <Pressable
              key={item.label}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => navigate(item.route)}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: readingTheme.surface }]}
            >
              <SymbolView name={item.icon} size={18} tintColor={colors.primary} />
              <Text style={[styles.itemText, { color: readingTheme.text }]}>{item.label}</Text>
              {item.label === '草稿箱' && draftCount > 0 ? <Text style={[styles.itemCount, { color: readingTheme.secondary }]}>{draftCount}</Text> : null}
            </Pressable>)}
          </View>)}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: readingTheme.border }]}>
          <Pressable accessibilityRole="button" onPress={() => navigate('/settings' as Href)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: readingTheme.surface }]}>
            <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} size={18} tintColor={colors.primary} />
            <Text style={[styles.itemText, { color: readingTheme.text }]}>设置</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay },
  drawer: { height: '100%', maxWidth: 340, shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 5, height: 0 }, elevation: 12 },
  profile: { minHeight: 83, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 42, height: 42, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  avatarText: { color: '#FFFFFF', fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' },
  profileCopy: { flex: 1, minWidth: 0 },
  nickname: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '600' },
  signature: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
  group: { marginBottom: spacing.sm },
  groupTitle: { marginLeft: spacing.md, marginTop: spacing.sm, marginBottom: spacing.xs, fontSize: 11, fontWeight: '600' },
  item: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderRadius: radii.md },
  itemText: { fontSize: 13, fontWeight: '500' },
  itemCount: { marginLeft: 'auto', fontSize: 11 },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
