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

  useEffect(() => {
    const index = Math.max(0, values.indexOf(selected));
    requestAnimationFrame(() => ref.current?.scrollTo({ y: index * NUMBER_WHEEL_ITEM_HEIGHT, animated: false }));
  }, [selected, values]);

  const valueAtOffset = (offset: number) => values[
    Math.max(0, Math.min(values.length - 1, Math.round(offset / NUMBER_WHEEL_ITEM_HEIGHT)))
  ];
  const selectedIndex = Math.max(0, values.indexOf(selected));

  return (
    <ScrollView
      ref={ref}
      accessibilityRole="adjustable"
      accessibilityValue={{ text: `${selected}${suffix}` }}
      accessibilityActions={[{ name: 'increment', label: '下一个' }, { name: 'decrement', label: '上一个' }]}
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
      onMomentumScrollEnd={(event) => {
        const value = valueAtOffset(event.nativeEvent.contentOffset.y);
        if (value != null) onSelect(value);
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
