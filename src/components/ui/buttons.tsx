import { forwardRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type TextProps, type View, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

export const buttonMetrics = {
  compactHeight: 28,
  iconSize: 32,
  actionHeight: 42,
  minimumTouchTarget: 44,
} as const;

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

type ButtonLabelProps = TextProps & {
  tone?: 'primary' | 'secondary' | 'danger';
};

export function ButtonLabel({ tone = 'primary', style, ...props }: ButtonLabelProps) {
  return <Text {...props} style={[styles.label, tone === 'primary' ? styles.primaryLabel : tone === 'danger' ? styles.dangerLabel : styles.secondaryLabel, style]} />;
}

export const CompactPillButton = forwardRef<View, ButtonProps>(function CompactPillButton({ accessibilityRole = 'button', children, disabled, style, ...props }, ref) {
  return <Pressable
    {...props}
    ref={ref}
    accessibilityRole={accessibilityRole}
    disabled={disabled}
    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    style={({ pressed }) => [styles.compactPill, style, pressed && styles.pressed, disabled && styles.disabled]}
  >{children}</Pressable>;
});

export function IconButton({ accessibilityRole = 'button', children, disabled, style, ...props }: ButtonProps) {
  return <Pressable
    {...props}
    accessibilityRole={accessibilityRole}
    disabled={disabled}
    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    style={({ pressed }) => [styles.icon, style, pressed && styles.pressed, disabled && styles.disabled]}
  >{children}</Pressable>;
}

export function PrimaryButton({ accessibilityRole = 'button', children, disabled, style, ...props }: ButtonProps) {
  return <Pressable
    {...props}
    accessibilityRole={accessibilityRole}
    disabled={disabled}
    style={({ pressed }) => [styles.primary, style, pressed && styles.pressed, disabled && styles.disabled]}
  >{children}</Pressable>;
}

export function SecondaryButton({ accessibilityRole = 'button', children, disabled, style, ...props }: ButtonProps) {
  return <Pressable
    {...props}
    accessibilityRole={accessibilityRole}
    disabled={disabled}
    style={({ pressed }) => [styles.secondary, style, pressed && styles.pressed, disabled && styles.disabled]}
  >{children}</Pressable>;
}

export function DangerButton({ accessibilityRole = 'button', children, disabled, style, ...props }: ButtonProps) {
  return <Pressable
    {...props}
    accessibilityRole={accessibilityRole}
    disabled={disabled}
    style={({ pressed }) => [styles.danger, style, pressed && styles.pressed, disabled && styles.disabled]}
  >{children}</Pressable>;
}

const styles = StyleSheet.create({
  compactPill: {
    height: buttonMetrics.compactHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  icon: {
    width: buttonMetrics.iconSize,
    height: buttonMetrics.iconSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  primary: {
    minHeight: buttonMetrics.actionHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  secondary: {
    minHeight: buttonMetrics.actionHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft,
  },
  danger: {
    minHeight: buttonMetrics.actionHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: '#F8E9E6',
  },
  label: { fontSize: 12, lineHeight: 17, fontWeight: '700', textAlign: 'center' },
  primaryLabel: { color: '#FFFFFF' },
  secondaryLabel: { color: colors.primary },
  dangerLabel: { color: colors.danger },
  pressed: { opacity: 0.62 },
  disabled: { opacity: 0.4 },
});
