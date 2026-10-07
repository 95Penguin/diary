import type { TimePixelCategory, TimePixelKind } from '../database/time-pixel-repository.ts';

export type TimePixelColorFamily = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'indigo' | 'purple';

export const TIME_PIXEL_COLOR_FAMILIES: { key: TimePixelColorFamily; label: string; color: string }[] = [
  { key: 'red', label: '红', color: '#C86F7D' },
  { key: 'orange', label: '橙', color: '#D18463' },
  { key: 'yellow', label: '黄', color: '#C5A650' },
  { key: 'green', label: '绿', color: '#63A17E' },
  { key: 'blue', label: '蓝', color: '#63A3BB' },
  { key: 'indigo', label: '靛', color: '#6479A5' },
  { key: 'purple', label: '紫', color: '#9578B4' },
];

// New categories use this brighter, low-to-medium saturation palette.
export const TIME_PIXEL_PALETTE = [
  { token: 'spring-green', label: '青芽', color: '#A8CA94', family: 'green' },
  { token: 'mint-green', label: '薄荷', color: '#80B78E', family: 'green' },
  { token: 'pine-green', label: '松绿', color: '#579676', family: 'green' },
  { token: 'forest-green', label: '森绿', color: '#39705D', family: 'green' },
  { token: 'cherry-pink', label: '樱粉', color: '#E6A4AE', family: 'red' },
  { token: 'modern-rose', label: '玫瑰', color: '#D17C8D', family: 'red' },
  { token: 'vermilion', label: '绯红', color: '#B95E6D', family: 'red' },
  { token: 'wine-red', label: '酒红', color: '#914F5C', family: 'red' },
  { token: 'apricot-orange', label: '杏橙', color: '#E9B07E', family: 'orange' },
  { token: 'soft-coral', label: '珊瑚', color: '#DD8A6E', family: 'orange' },
  { token: 'orange-tea', label: '橘茶', color: '#C77853', family: 'orange' },
  { token: 'terracotta', label: '赤陶', color: '#A9634E', family: 'orange' },
  { token: 'cream-yellow', label: '奶油黄', color: '#E4CA83', family: 'yellow' },
  { token: 'honey-yellow', label: '蜜糖', color: '#D4B15B', family: 'yellow' },
  { token: 'wheat-gold', label: '麦金', color: '#BA9644', family: 'yellow' },
  { token: 'olive-yellow', label: '橄榄黄', color: '#93934D', family: 'yellow' },
  { token: 'clear-sky', label: '晴空', color: '#90C5DA', family: 'blue' },
  { token: 'sea-salt', label: '海盐', color: '#70B0C7', family: 'blue' },
  { token: 'lake-blue', label: '湖蓝', color: '#5693AE', family: 'blue' },
  { token: 'distant-mountain', label: '远山', color: '#4F758A', family: 'blue' },
  { token: 'indigo-mist', label: '靛雾', color: '#929FC8', family: 'indigo' },
  { token: 'indigo-blue', label: '靛青', color: '#7184B3', family: 'indigo' },
  { token: 'ink-blue', label: '墨蓝', color: '#566C99', family: 'indigo' },
  { token: 'deep-indigo', label: '深靛', color: '#475577', family: 'indigo' },
  { token: 'taro-purple', label: '香芋', color: '#C1AAD5', family: 'purple' },
  { token: 'wisteria-purple', label: '藤紫', color: '#A287BE', family: 'purple' },
  { token: 'violet-purple', label: '紫罗兰', color: '#8769A5', family: 'purple' },
  { token: 'plum-purple', label: '梅紫', color: '#775776', family: 'purple' },
] as const;

// v1.0.10 saved these tokens. Keep them renderable without presenting the
// whole legacy palette to new users; the current legacy color remains available
// when its category is edited.
export const TIME_PIXEL_LEGACY_PALETTE = [
  { token: 'fern', label: '原松绿', color: '#5B8C72', family: 'green' },
  { token: 'mist', label: '原雾蓝', color: '#7E9FB8', family: 'blue' },
  { token: 'lavender', label: '原丁香', color: '#9A86B8', family: 'purple' },
  { token: 'amber', label: '原麦黄', color: '#C69A4B', family: 'yellow' },
  { token: 'rose', label: '原豆沙', color: '#B8757C', family: 'red' },
  { token: 'teal', label: '原青绿', color: '#4F9290', family: 'green' },
  { token: 'slate', label: '原岩灰', color: '#7C8793', family: 'blue' },
  { token: 'clay', label: '原陶棕', color: '#A67C68', family: 'orange' },
  { token: 'pine', label: '原深松', color: '#346B63', family: 'green' },
  { token: 'sky', label: '原天蓝', color: '#5F86C2', family: 'blue' },
  { token: 'indigo', label: '原靛蓝', color: '#686AA8', family: 'indigo' },
  { token: 'plum', label: '原梅紫', color: '#9B5F8B', family: 'purple' },
  { token: 'coral', label: '原珊瑚', color: '#C76F5B', family: 'red' },
  { token: 'orange', label: '原橙褐', color: '#C9823F', family: 'orange' },
  { token: 'olive', label: '原橄榄', color: '#7E8C4B', family: 'yellow' },
  { token: 'sand', label: '原沙金', color: '#B39A70', family: 'yellow' },
] as const;

const ALL_TIME_PIXEL_COLORS = [...TIME_PIXEL_PALETTE, ...TIME_PIXEL_LEGACY_PALETTE];

export function timePixelColor(token: string) {
  return ALL_TIME_PIXEL_COLORS.find((item) => item.token === token)?.color ?? TIME_PIXEL_PALETTE[0].color;
}

function relativeLuminance(color: string) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function timePixelTextColor(token: string) {
  const background = timePixelColor(token);
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#FFFFFF') ? '#000000' : '#FFFFFF';
}

export function timePixelColorChoices(categories: TimePixelCategory[], kind: TimePixelKind, excludeId?: string) {
  const others = categories.filter((category) => category.kind === kind && category.id !== excludeId);
  const currentToken = excludeId ? categories.find((category) => category.id === excludeId)?.colorToken : undefined;
  const currentLegacyColor = TIME_PIXEL_LEGACY_PALETTE.find((item) => item.token === currentToken);
  const palette = currentLegacyColor ? [...TIME_PIXEL_PALETTE, currentLegacyColor] : TIME_PIXEL_PALETTE;
  return palette.map((item) => ({
    ...item,
    // Match rendered colors, including the fallback for unknown backup tokens.
    usedBy: others.filter((category) => timePixelColor(category.colorToken) === item.color),
  }));
}

export function suggestedTimePixelColor(categories: TimePixelCategory[], kind: TimePixelKind) {
  const choices = timePixelColorChoices(categories, kind);
  return (choices.find((item) => item.usedBy.length === 0) ?? choices[0]).token;
}
