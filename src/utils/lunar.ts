import { Solar } from 'lunar-typescript';

/** Returns the Chinese lunar day name, such as “初一” or “廿三”. */
export function lunarDayLabel(year: number, month: number, day: number) {
  return Solar.fromYmd(year, month, day).getLunar().getDayInChinese();
}
