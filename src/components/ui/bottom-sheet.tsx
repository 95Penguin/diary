import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing } from '@/theme/tokens';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  backgroundColor: string;
  contentHeight?: number;
  scrollable?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  onShow?: () => void;
  sheetStyle?: StyleProp<ViewStyle>;
};

export function BottomSheet({
  visible,
  onClose,
  children,
  backgroundColor,
  contentHeight,
  scrollable = false,
  contentContainerStyle,
  onShow,
  sheetStyle,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const bottomPadding = Math.max(insets.bottom, spacing.md);
  const availableHeight = Math.max(1, height - Math.max(insets.top, spacing.md) - spacing.md);
  const maximumHeight = Math.min(620, availableHeight);
  const requestedHeight = contentHeight == null ? null : Math.min(contentHeight + bottomPadding, maximumHeight);
  const maxSheetWidth = width >= 768 ? 680 : width;
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={onShow}>
    <Pressable accessible={false} onPress={onClose} style={styles.overlay}>
      <Pressable
        accessible={false}
        onPress={(event) => event.stopPropagation()}
        style={[
          styles.sheet,
          { backgroundColor, paddingBottom: bottomPadding, maxHeight: maximumHeight, maxWidth: maxSheetWidth },
          requestedHeight == null ? null : { height: requestedHeight },
          sheetStyle,
        ]}
      >
        <View pointerEvents="none" style={styles.handleSlot}><View style={styles.handle} /></View>
        {scrollable ? <ScrollView
          bounces={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        >{children}</ScrollView> : children}
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: colors.overlay },
  handleSlot: { position: 'absolute', zIndex: 1, top: spacing.sm, left: 0, right: 0, alignItems: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  sheet: {
    height: '72%',
    width: '100%',
    maxHeight: 620,
    overflow: 'hidden',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    elevation: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -5 },
  },
});
