import type { TimePixelCategory, TimePixelKind } from '../database/time-pixel-repository.ts';

// Keep saved tokens and their colors stable when improving the picker UI.
export const TIME_PIXEL_PALETTE = [
  { token: 'fern', label: '松绿', color: '#5B8C72' },
  { token: 'mist', label: '雾蓝', color: '#7E9FB8' },
  { token: 'lavender', label: '丁香', color: '#9A86B8' },
  { token: 'amber', label: '麦黄', color: '#C69A4B' },
  { token: 'rose', label: '豆沙', color: '#B8757C' },
  { token: 'teal', label: '青绿', color: '#4F9290' },
  { token: 'slate', label: '岩灰', color: '#7C8793' },
  { token: 'clay', label: '陶棕', color: '#A67C68' },
  { token: 'pine', label: '深松', color: '#346B63' },
  { token: 'sky', label: '天蓝', color: '#5F86C2' },
  { token: 'indigo', label: '靛蓝', color: '#686AA8' },
  { token: 'plum', label: '梅紫', color: '#9B5F8B' },
  { token: 'coral', label: '珊瑚', color: '#C76F5B' },
  { token: 'orange', label: '橙褐', color: '#C9823F' },
  { token: 'olive', label: '橄榄', color: '#7E8C4B' },
  { token: 'sand', label: '沙金', color: '#B39A70' },
] as const;

export function timePixelColor(token: string) {
  return TIME_PIXEL_PALETTE.find((item) => item.token === token)?.color ?? TIME_PIXEL_PALETTE[0].color;
}

export function timePixelColorChoices(categories: TimePixelCategory[], kind: TimePixelKind, excludeId?: string) {
  const others = categories.filter((category) => category.kind === kind && category.id !== excludeId);
  return TIME_PIXEL_PALETTE.map((item) => ({
    ...item,
    // Match rendered colors, including the fallback for unknown backup tokens.
    usedBy: others.filter((category) => timePixelColor(category.colorToken) === item.color),
  }));
}

export function suggestedTimePixelColor(categories: TimePixelCategory[], kind: TimePixelKind) {
  const choices = timePixelColorChoices(categories, kind);
  return (choices.find((item) => item.usedBy.length === 0) ?? choices[0]).token;
}
