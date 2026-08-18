import { useMemo, useRef } from 'react';
import { FlatList, Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppPreferences } from '@/preferences/app-preferences';
import { fonts, radii, spacing } from '@/theme/tokens';
import type { MediaMonth } from '@/utils/media-library';

const ITEM_HEIGHT = 52;

type MediaMonthPickerProps = {
  visible: boolean;
  months: MediaMonth[];
  selectedKey: string | null;
  selectedYear: number | null;
  bottomInset: number;
  onChangeKey: (key: string | null) => void;
  onChangeYear: (year: number) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function MediaMonthPicker({
  visible, months, selectedKey, selectedYear, bottomInset,
  onChangeKey, onChangeYear, onClose, onConfirm,
}: MediaMonthPickerProps) {
  const { readingTheme } = useAppPreferences();
  const yearRef = useRef<FlatList<number>>(null);
  const monthRef = useRef<FlatList<MediaMonth>>(null);
  const years = useMemo(
    () => [...new Set(months.map((item) => Number(item.key.slice(0, 4))))].sort((left, right) => left - right),
    [months],
  );
  const yearMonths = useMemo(
    () => months
      .filter((item) => Number(item.key.slice(0, 4)) === selectedYear)
      .sort((left, right) => Number(left.key.slice(5)) - Number(right.key.slice(5))),
    [months, selectedYear],
  );

  function selectYear(year: number) {
    const firstMonth = months
      .filter((item) => Number(item.key.slice(0, 4)) === year)
      .sort((left, right) => Number(left.key.slice(5)) - Number(right.key.slice(5)))[0];
    onChangeYear(year);
    onChangeKey(firstMonth?.key ?? null);
    requestAnimationFrame(() => monthRef.current?.scrollToOffset({ offset: 0, animated: false }));
  }

  function updateYear(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.max(0, Math.min(years.length - 1, Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT)));
    const year = years[index];
    if (year != null && year !== selectedYear) selectYear(year);
  }

  function updateMonth(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.max(0, Math.min(yearMonths.length - 1, Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT)));
    onChangeKey(yearMonths[index]?.key ?? null);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        const yearIndex = Math.max(0, years.indexOf(selectedYear ?? years[0]));
        const monthIndex = Math.max(0, yearMonths.findIndex((item) => item.key === selectedKey));
        requestAnimationFrame(() => {
          yearRef.current?.scrollToOffset({ offset: yearIndex * ITEM_HEIGHT, animated: false });
          monthRef.current?.scrollToOffset({ offset: monthIndex * ITEM_HEIGHT, animated: false });
        });
      }}
    >
      <Pressable accessibilityLabel="关闭月份索引" onPress={onClose} style={styles.overlay}>
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={[styles.sheet, { backgroundColor: readingTheme.background, paddingBottom: Math.max(bottomInset, spacing.xl) }]}
        >
          <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
            <Pressable hitSlop={12} onPress={onClose}><Text style={[styles.action, { color: readingTheme.secondary }]}>取消</Text></Pressable>
            <Text style={[styles.title, { color: readingTheme.text }]}>选择月份</Text>
            <Pressable hitSlop={12} onPress={onConfirm}><Text style={styles.action}>确定</Text></Pressable>
          </View>
          <View style={styles.wheel}>
            <View pointerEvents="none" style={[styles.selection, { borderColor: readingTheme.border }]} />
            <FlatList
              ref={yearRef}
              data={years}
              keyExtractor={(year) => String(year)}
              showsVerticalScrollIndicator={false}
              snapToInterval={ITEM_HEIGHT}
              decelerationRate="fast"
              contentContainerStyle={styles.content}
              getItemLayout={(_, index) => ({ index, length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index })}
              onScrollEndDrag={updateYear}
              onMomentumScrollEnd={updateYear}
              renderItem={({ item: year }) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: year === selectedYear }}
                  onPress={() => {
                    selectYear(year);
                    yearRef.current?.scrollToOffset({ offset: years.indexOf(year) * ITEM_HEIGHT, animated: true });
                  }}
                  style={styles.item}
                >
                  <Text style={[styles.label, { color: year === selectedYear ? readingTheme.text : readingTheme.secondary }, year === selectedYear && styles.selectedLabel]}>{year}年</Text>
                </Pressable>
              )}
            />
            <FlatList
              ref={monthRef}
              data={yearMonths}
              keyExtractor={(item) => item.key}
              showsVerticalScrollIndicator={false}
              snapToInterval={ITEM_HEIGHT}
              decelerationRate="fast"
              contentContainerStyle={styles.content}
              getItemLayout={(_, index) => ({ index, length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index })}
              onScrollEndDrag={updateMonth}
              onMomentumScrollEnd={updateMonth}
              renderItem={({ item, index }) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item.key === selectedKey }}
                  onPress={() => {
                    onChangeKey(item.key);
                    monthRef.current?.scrollToOffset({ offset: index * ITEM_HEIGHT, animated: true });
                  }}
                  style={styles.item}
                >
                  <Text style={[styles.label, { color: item.key === selectedKey ? readingTheme.text : readingTheme.secondary }, item.key === selectedKey && styles.selectedLabel]}>{Number(item.key.slice(5))}月</Text>
                  <Text style={[styles.count, { color: readingTheme.secondary }]}>{item.count} 项</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: { height: 352, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700' },
  action: { minWidth: 44, color: '#426C5A', fontSize: 14, fontWeight: '600' },
  wheel: { height: 260, overflow: 'hidden', flexDirection: 'row', justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  selection: { position: 'absolute', left: spacing.xl, right: spacing.xl, top: 104, height: ITEM_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { paddingVertical: 104 },
  item: { width: 150, height: ITEM_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { fontSize: 15, textAlign: 'center' },
  selectedLabel: { fontSize: 18, fontWeight: '700' },
  count: { minWidth: 38, fontSize: 10 },
});
