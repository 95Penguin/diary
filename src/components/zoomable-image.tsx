import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';

const MIN_SCALE = 1;
const DOUBLE_TAP_SCALE = 2.5;
const MAX_SCALE = 8;
const RUBBER_MIN_SCALE = 0.9;
const RUBBER_MAX_SCALE = 8.8;
const EDGE_RESISTANCE = 0.24;

export function ZoomableImage({ uri, onPress }: { uri: string; onPress?: () => void }) {
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const viewportWidth = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const imageWidth = useSharedValue(0);
  const imageHeight = useSharedValue(0);
  const pinchContentX = useSharedValue(0);
  const pinchContentY = useSharedValue(0);

  const reset = (animated = true) => {
    'worklet';
    scale.value = animated ? withTiming(1, { duration: 200 }) : 1;
    translateX.value = animated ? withTiming(0, { duration: 200 }) : 0;
    translateY.value = animated ? withTiming(0, { duration: 200 }) : 0;
    startScale.value = 1;
    startX.value = 0;
    startY.value = 0;
  };

  const settle = () => {
    'worklet';
    const targetScale = clamp(scale.value, MIN_SCALE, MAX_SCALE);
    if (targetScale <= 1.01) { reset(); return; }
    const bounds = translationBounds(targetScale, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value);
    const targetX = clamp(translateX.value, -bounds.x, bounds.x);
    const targetY = clamp(translateY.value, -bounds.y, bounds.y);
    scale.value = withSpring(targetScale, { damping: 20, stiffness: 240, mass: 0.7 });
    translateX.value = withSpring(targetX, { damping: 20, stiffness: 240, mass: 0.7 });
    translateY.value = withSpring(targetY, { damping: 20, stiffness: 240, mass: 0.7 });
    startScale.value = targetScale;
    startX.value = targetX;
    startY.value = targetY;
  };

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      startScale.value = scale.value;
      startX.value = translateX.value;
      startY.value = translateY.value;
      const focalX = event.focalX - viewportWidth.value / 2;
      const focalY = event.focalY - viewportHeight.value / 2;
      pinchContentX.value = (focalX - translateX.value) / scale.value;
      pinchContentY.value = (focalY - translateY.value) / scale.value;
    })
    .onUpdate((event) => {
      const nextScale = rubberScale(startScale.value * event.scale);
      const focalX = event.focalX - viewportWidth.value / 2;
      const focalY = event.focalY - viewportHeight.value / 2;
      scale.value = nextScale;
      const proposedX = focalX - pinchContentX.value * nextScale;
      const proposedY = focalY - pinchContentY.value * nextScale;
      const bounds = translationBounds(nextScale, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value);
      translateX.value = resisted(proposedX, bounds.x);
      translateY.value = resisted(proposedY, bounds.y);
    })
    .onEnd(settle);

  const pan = Gesture.Pan()
    .manualActivation(true)
    .maxPointers(1)
    .minDistance(4)
    .onTouchesMove((_event, manager) => {
      if (scale.value > 1.02) manager.activate();
      else manager.fail();
    })
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      const bounds = translationBounds(scale.value, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value);
      translateX.value = resisted(startX.value + event.translationX, bounds.x);
      translateY.value = resisted(startY.value + event.translationY, bounds.y);
    })
    .onEnd(settle);

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDuration(260).onEnd((event, success) => {
    if (!success) return;
    if (scale.value >= DOUBLE_TAP_SCALE - 0.05) { reset(); return; }
    const targetScale = DOUBLE_TAP_SCALE;
    const pointX = event.x - viewportWidth.value / 2;
    const pointY = event.y - viewportHeight.value / 2;
    const ratio = targetScale / scale.value;
    const bounds = translationBounds(targetScale, viewportWidth.value, viewportHeight.value, imageWidth.value, imageHeight.value);
    const targetX = clamp(pointX - (pointX - translateX.value) * ratio, -bounds.x, bounds.x);
    const targetY = clamp(pointY - (pointY - translateY.value) * ratio, -bounds.y, bounds.y);
    scale.value = withTiming(targetScale, { duration: 200 });
    translateX.value = withTiming(targetX, { duration: 200 });
    translateY.value = withTiming(targetY, { duration: 200 });
    startScale.value = targetScale;
    startX.value = targetX;
    startY.value = targetY;
  });
  const singleTap = Gesture.Tap().numberOfTaps(1).onEnd((_event, success) => {
    if (success && onPress) runOnJS(onPress)();
  });
  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return <GestureDetector gesture={gesture}>
    <Animated.View
      onLayout={(event) => { viewportWidth.value = event.nativeEvent.layout.width; viewportHeight.value = event.nativeEvent.layout.height; }}
      style={[styles.viewport, animatedStyle]}
    >
      <Image
        source={uri}
        contentFit="contain"
        onLoad={(event) => { imageWidth.value = event.source.width; imageHeight.value = event.source.height; }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  </GestureDetector>;
}

function clamp(value: number, minimum: number, maximum: number) {
  'worklet';
  return Math.max(minimum, Math.min(maximum, value));
}

function rubberScale(value: number) {
  'worklet';
  if (value < MIN_SCALE) return Math.max(RUBBER_MIN_SCALE, MIN_SCALE - (MIN_SCALE - value) * EDGE_RESISTANCE);
  if (value > MAX_SCALE) return Math.min(RUBBER_MAX_SCALE, MAX_SCALE + (value - MAX_SCALE) * EDGE_RESISTANCE);
  return value;
}

function resisted(value: number, bound: number) {
  'worklet';
  if (value > bound) return bound + (value - bound) * EDGE_RESISTANCE;
  if (value < -bound) return -bound + (value + bound) * EDGE_RESISTANCE;
  return value;
}

function translationBounds(scale: number, viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number) {
  'worklet';
  if (!viewportWidth || !viewportHeight || !imageWidth || !imageHeight) {
    return { x: Math.max(0, viewportWidth * (scale - 1) / 2), y: Math.max(0, viewportHeight * (scale - 1) / 2) };
  }
  const fitScale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const displayedWidth = imageWidth * fitScale;
  const displayedHeight = imageHeight * fitScale;
  return {
    x: Math.max(0, (displayedWidth * scale - viewportWidth) / 2),
    y: Math.max(0, (displayedHeight * scale - viewportHeight) / 2),
  };
}

const styles = StyleSheet.create({ viewport: { width: '100%', height: '100%' } });
