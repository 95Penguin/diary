import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';

import { listTimeCapsules, setTimeCapsuleNotification, type TimeCapsule } from '@/database/time-capsule-repository';

const CHANNEL_ID = 'time-capsules';
const identifierFor = (id: string) => `shishi-time-capsule-${id}`;

async function ensurePermission() {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: '时间胶囊', importance: Notifications.AndroidImportance.DEFAULT });
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function scheduleTimeCapsuleNotification(capsule: Pick<TimeCapsule, 'id' | 'openAt'>) {
  if (!await ensurePermission()) return false;
  const identifier = identifierFor(capsule.id);
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({ identifier, content: { title: '一枚时间胶囊可以开启了', body: '来自过去的你正在等待。', data: { route: '/time-capsule', capsuleId: capsule.id } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(capsule.openAt), ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}) } });
  return true;
}

export async function cancelTimeCapsuleNotification(id: string) {
  if (Platform.OS !== 'web') await Notifications.cancelScheduledNotificationAsync(identifierFor(id)).catch(() => undefined);
}

export async function syncTimeCapsuleNotifications(db: SQLiteDatabase) {
  if (Platform.OS === 'web') return;
  const capsules = await listTimeCapsules(db);
  const scheduled = new Set((await Notifications.getAllScheduledNotificationsAsync()).map((item) => item.identifier));
  for (const capsule of capsules) {
    if (capsule.status !== 'locked' || !capsule.notificationEnabled || scheduled.has(identifierFor(capsule.id))) continue;
    const enabled = await scheduleTimeCapsuleNotification(capsule);
    if (!enabled) await setTimeCapsuleNotification(db, capsule.id, false);
  }
}
