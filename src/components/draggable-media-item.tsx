/* eslint-disable react-hooks/refs -- PanResponder and React Native Animated require stable mutable gesture state. */
import { PropsWithChildren, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleProp,
  ViewStyle,
} from 'react-native';

type DraggableMediaItemProps = PropsWithChildren<{
  accessibilityLabel: string;
  columns?: number;
  count: number;
  index: number;
  itemStride: number;
  onMove: (from: number, to: number) => void;
  style?: StyleProp<ViewStyle>;
  verticalStride?: number;
}>;

function positionFor(index: number, columns: number, horizontalStride: number, verticalStride: number) {
  return {
    x: (index % columns) * horizontalStride,
    y: Math.floor(index / columns) * verticalStride,
  };
}

export function DraggableMediaItem({
  accessibilityLabel,
  children,
  columns = 1,
  count,
  index,
  itemStride,
  onMove,
  style,
  verticalStride = itemStride,
}: DraggableMediaItemProps) {
  const translation = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const armed = useRef(false);
  const dragging = useRef(false);
  const startIndex = useRef(index);
  const targetIndex = useRef(index);
  const propsRef = useRef({ columns, count, index, itemStride, onMove, verticalStride });

  useEffect(() => {
    propsRef.current = { columns, count, index, itemStride, onMove, verticalStride };
  }, [columns, count, index, itemStride, onMove, verticalStride]);

  const resetPosition = () => {
    armed.current = false;
    dragging.current = false;
    Animated.parallel([
      Animated.spring(translation, {
        damping: 18,
        stiffness: 240,
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        damping: 18,
        stiffness: 240,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => (
      armed.current && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 1
    ),
    onMoveShouldSetPanResponderCapture: (_, gesture) => (
      armed.current && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 1
    ),
    onPanResponderGrant: () => {
      dragging.current = true;
      startIndex.current = propsRef.current.index;
      targetIndex.current = propsRef.current.index;
      scale.stopAnimation();
      Animated.spring(scale, {
        damping: 18,
        stiffness: 240,
        toValue: 1.04,
        useNativeDriver: true,
      }).start();
    },
    onPanResponderMove: (_, gesture) => {
      translation.setValue({ x: gesture.dx, y: gesture.dy });
      const current = propsRef.current;
      const safeColumns = Math.max(1, current.columns);
      const start = positionFor(
        startIndex.current,
        safeColumns,
        current.itemStride,
        current.verticalStride,
      );
      const targetColumn = Math.round((start.x + gesture.dx) / current.itemStride);
      const targetRow = Math.round((start.y + gesture.dy) / current.verticalStride);
      const rawTarget = targetRow * safeColumns
        + Math.max(0, Math.min(safeColumns - 1, targetColumn));
      targetIndex.current = Math.max(0, Math.min(current.count - 1, rawTarget));
    },
    onPanResponderRelease: () => {
      const from = startIndex.current;
      const to = targetIndex.current;
      resetPosition();
      if (from !== to) propsRef.current.onMove(from, to);
    },
    onPanResponderTerminate: resetPosition,
    onPanResponderTerminationRequest: () => !dragging.current,
    onShouldBlockNativeResponder: () => true,
  // Animated values and refs are intentionally stable for the lifetime of the item.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return (
    <Animated.View
      {...responder.panHandlers}
      accessibilityActions={[
        { name: 'decrement', label: '向前移动' },
        { name: 'increment', label: '向后移动' },
      ]}
      accessibilityHint="长按缩略图后拖动到任意位置可调整顺序"
      accessibilityLabel={accessibilityLabel}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'decrement' && index > 0) onMove(index, index - 1);
        if (event.nativeEvent.actionName === 'increment' && index < count - 1) onMove(index, index + 1);
      }}
      style={[
        style,
        {
          transform: [
            { translateX: translation.x },
            { translateY: translation.y },
            { scale },
          ],
        },
      ]}
    >
      <Pressable
        delayLongPress={180}
        onLongPress={() => {
          armed.current = true;
          startIndex.current = propsRef.current.index;
          targetIndex.current = propsRef.current.index;
        }}
        onPressOut={() => {
          if (!dragging.current) armed.current = false;
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
