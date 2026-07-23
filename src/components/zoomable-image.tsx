import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.max(1, Math.min(4, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) reset();
    });

  const pan = Gesture.Pan()
    .manualActivation(true)
    .maxPointers(1)
    .minDistance(4)
    .onTouchesMove((_event, manager) => {
      if (scale.value > 1.02) manager.activate();
      else manager.fail();
    })
    .onUpdate((event) => {
      if (scale.value > 1.02) {
        translateX.value = savedX.value + event.translationX;
        translateY.value = savedY.value + event.translationY;
      }
    })
    .onEnd(() => {
      if (scale.value > 1.02) {
        savedX.value = translateX.value;
        savedY.value = translateY.value;
      }
    });

  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    if (scale.value > 1.02) reset();
    else {
      scale.value = withTiming(2);
      savedScale.value = 2;
    }
  });
  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return <GestureDetector gesture={gesture}>
    <Animated.View style={[{ width: '100%', height: '100%' }, animatedStyle]}>
      <Image source={uri} contentFit="contain" style={{ width: '100%', height: '100%' }} />
    </Animated.View>
  </GestureDetector>;
}
