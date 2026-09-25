import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useAppPreferences } from '@/preferences/app-preferences';

export const NUMBER_WHEEL_ITEM_HEIGHT = 44;

type NumberWheelColumnProps = {
  values: number[];
  selected: number;
  suffix: string;
  onPreview?: (value: number) => void;
  onSelect: (value: number) => void;
};

export function NumberWheelColumn({ values, selected, suffix, onPreview, onSelect }: NumberWheelColumnProps) {
  const { readingTheme } = useAppPreferences();
  const ref = useRef<ScrollView>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const index = Math.max(0, values.indexOf(selected));
    requestAnimationFrame(() => ref.current?.scrollTo({ y: index * NUMBER_WHEEL_ITEM_HEIGHT, animated: false }));
  }, [selected, values]);

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  }, []);

  const valueAtOffset = (offset: number) => values[
    Math.max(0, Math.min(values.length - 1, Math.round(offset / NUMBER_WHEEL_ITEM_HEIGHT)))
  ];
  const selectedIndex = Math.max(0, values.indexOf(selected));
  const commitOffset = (offset: number) => {
    const value = valueAtOffset(offset);
    if (value != null) onSelect(value);
  };
  const cancelPendingDragCommit = () => {
    if (!settleTimerRef.current) return;
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  };

  return (
    <ScrollView
      ref={ref}
      accessibilityRole="adjustable"
      accessibilityValue={{ text: `${selected}${suffix}` }}
      accessibilityActions={[{ name: 'increment', label: '下一个' }, { name: 'decrement', label: '上一个' }]}
      nestedScrollEnabled
      onAccessibilityAction={(event) => {
        const delta = event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0;
        const value = values[Math.max(0, Math.min(values.length - 1, selectedIndex + delta))];
        if (value != null) onSelect(value);
      }}
      showsVerticalScrollIndicator={false}
      snapToInterval={NUMBER_WHEEL_ITEM_HEIGHT}
      decelerationRate="fast"
      contentContainerStyle={styles.content}
      scrollEventThrottle={16}
      onScroll={(event) => {
        const value = valueAtOffset(event.nativeEvent.contentOffset.y);
        if (value != null) onPreview?.(value);
      }}
      onScrollEndDrag={(event) => {
        cancelPendingDragCommit();
        const offset = event.nativeEvent.contentOffset.y;
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null;
          commitOffset(offset);
        }, 80);
      }}
      onMomentumScrollBegin={cancelPendingDragCommit}
      onMomentumScrollEnd={(event) => {
        cancelPendingDragCommit();
        commitOffset(event.nativeEvent.contentOffset.y);
      }}
      style={styles.column}
    >
      {values.map((value) => (
        <Pressable key={value} onPress={() => onSelect(value)} style={styles.item}>
          <Text style={[
            styles.text,
            { color: value === selected ? readingTheme.text : readingTheme.secondary },
            value === selected && styles.selectedText,
          ]}>{value}{suffix}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  content: { paddingVertical: 66 },
  item: { height: NUMBER_WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 16 },
  selectedText: { fontSize: 20, fontWeight: '600' },
});
