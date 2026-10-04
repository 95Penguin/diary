import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TimePixelCategory, TimePixelKind } from '@/database/time-pixel-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, radii, spacing } from '@/theme/tokens';
import { TIME_PIXEL_COLOR_FAMILIES, timePixelColor, timePixelColorChoices, type TimePixelColorFamily } from '@/utils/time-pixel-colors';

type Props = {
  value: string;
  onChange: (value: string) => void;
  categories: TimePixelCategory[];
  kind: TimePixelKind;
  categoryId?: string;
  name: string;
  collapsible?: boolean;
};

export function TimePixelColorPicker({ value, onChange, categories, kind, categoryId, name, collapsible = false }: Props) {
  const { readingTheme: theme } = useAppPreferences();
  const choices = timePixelColorChoices(categories, kind, categoryId);
  const selected = choices.find((item) => item.token === value) ?? choices[0];
  const [expanded, setExpanded] = useState(false);
  const [family, setFamily] = useState<TimePixelColorFamily>(selected.family);
  const familyScrollRef = useRef<ScrollView>(null);
  const visibleChoices = choices.filter((item) => item.family === family);
  const peers = categories.filter((item) => item.kind === kind && item.id !== categoryId).slice(0, 2);
  const preview = [
    { key: 'current', name: name.trim() || (kind === 'location' ? '新地点' : '新阶段'), color: selected.color },
    ...peers.map((item) => ({ key: `category:${item.id}`, name: item.name, color: timePixelColor(item.colorToken) })),
    { key: 'unrecorded', name: '未记录', color: theme.border },
  ];

  return <View>
    <Text style={[styles.label, { color: theme.secondary }]}>颜色 · {selected.label}</Text>
    {collapsible ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${selected.label}，${expanded ? '收起' : '展开'}颜色选择`} onPress={() => setExpanded((current) => !current)} style={[styles.compact, { backgroundColor: theme.surface }]}>
      <View style={styles.compactPixels}>{Array.from({ length: 5 }, (_, index) => <View key={index} style={[styles.pixel, { backgroundColor: selected.color }]} />)}</View>
      <Text style={[styles.compactName, { color: theme.text }]}>{selected.label}{selected.usedBy.length ? ` · ${selected.usedBy.length}项同色` : ''}</Text>
      <Text style={styles.toggle}>{expanded ? '收起' : '换色'}</Text>
    </Pressable> : null}
    {!collapsible || expanded ? <>
    <ScrollView ref={familyScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.familyRow} accessibilityRole="radiogroup" accessibilityLabel="颜色分类">
      {TIME_PIXEL_COLOR_FAMILIES.map((item) => <Pressable
        key={item.key}
        accessibilityRole="radio"
        accessibilityState={{ checked: family === item.key }}
        onPress={() => setFamily(item.key)}
        onLayout={(event) => {
          if (family === item.key) familyScrollRef.current?.scrollTo({ x: Math.max(0, event.nativeEvent.layout.x - spacing.md), animated: false });
        }}
        style={[styles.familyChoice, { backgroundColor: family === item.key ? colors.primarySoft : theme.surface, borderColor: family === item.key ? colors.primary : 'transparent' }]}
      >
        <View style={[styles.familySwatch, { backgroundColor: item.color }]} />
        <Text style={[styles.familyText, { color: family === item.key ? colors.primary : theme.secondary }, family === item.key && styles.familyTextActive]}>{item.label}</Text>
      </Pressable>)}
    </ScrollView>
    <View accessibilityRole="radiogroup" accessibilityLabel="预设颜色" style={styles.palette}>
      {visibleChoices.map((item) => {
        const checked = selected.token === item.token;
        const usage = item.usedBy.length ? `${item.usedBy.length}项已用` : '无其他项使用';
        return <Pressable
          key={item.token}
          accessibilityRole="radio"
          accessibilityState={{ checked }}
          accessibilityLabel={`${item.label}，${usage}${item.usedBy.length ? `：${item.usedBy.map((category) => category.name).join('、')}` : ''}`}
          accessibilityHint="可重复选择，保存后生效"
          onPress={() => onChange(item.token)}
          style={styles.choiceSlot}
        >
          <View style={[styles.choice, { borderColor: checked ? colors.primary : 'transparent', backgroundColor: theme.surface }]}>
            <View style={[styles.swatch, { backgroundColor: item.color }]} />
            <Text numberOfLines={1} style={[styles.choiceName, { color: theme.text }]}>{item.label}{checked ? ' ✓' : ''}</Text>
          </View>
        </Pressable>;
      })}
    </View>
    <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.secondary }]}>
      {selected.usedBy.length
        ? `与「${selected.usedBy.map((item) => item.name).join('」「')}」同色，仍可使用；选择不同颜色更容易区分。`
        : '没有其他同类项目使用这个颜色。地点与人生阶段分别统计。'}
    </Text>
    <View style={[styles.preview, { backgroundColor: theme.surface }]}>
      <Text style={[styles.previewTitle, { color: theme.secondary }]}>像素配色预览 · 仅示意，不代表天数</Text>
      <View accessible={false} style={styles.previewPixels}>
        {preview.flatMap((item) => Array.from({ length: 4 }, (_, index) => <View key={`${item.key}-${index}`} style={[styles.pixel, { backgroundColor: item.color }]} />))}
      </View>
      <View style={styles.legend}>
        {preview.map((item) => <View key={item.key} style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
          <Text style={[styles.legendName, { color: theme.text }]}>{item.name}</Text>
        </View>)}
      </View>
    </View>
    </> : null}
    {categoryId ? <Text style={[styles.hint, { color: theme.secondary }]}>保存后，该{kind === 'location' ? '地点' : '阶段'}的所有历史记录都会使用新颜色，不改变日期和备注。</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  compact: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md },
  compactPixels: { flexDirection: 'row', gap: 3 },
  compactName: { flex: 1, fontSize: 11 },
  toggle: { color: colors.primary, fontSize: 11 },
  label: { marginTop: spacing.md, marginBottom: spacing.sm, fontSize: 10 },
  familyRow: { minHeight: 72, alignItems: 'center', gap: spacing.xs, paddingBottom: spacing.xs },
  familyChoice: { width: 56, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 2, borderRadius: radii.md },
  familySwatch: { width: 28, height: 28, borderRadius: radii.sm },
  familyText: { fontSize: 10 },
  familyTextActive: { fontWeight: '700' },
  palette: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -2 },
  choiceSlot: { width: '25%', padding: 2 },
  choice: { minHeight: 72, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 2, borderWidth: 2, borderRadius: radii.md },
  swatch: { width: 32, height: 32, borderRadius: radii.sm },
  choiceName: { maxWidth: '100%', fontSize: 10, marginTop: 5, textAlign: 'center' },
  hint: { marginTop: spacing.sm, fontSize: 10, lineHeight: 17 },
  preview: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md },
  previewTitle: { fontSize: 10, lineHeight: 16 },
  previewPixels: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginVertical: spacing.sm },
  pixel: { width: 12, height: 12, borderRadius: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  legendSwatch: { width: 9, height: 9, borderRadius: 3 },
  legendName: { fontSize: 10, flexShrink: 1 },
});
