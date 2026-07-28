import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export const BACKUP_REMINDER_ID = 'shishi-backup-reminder';
const CHANNEL_ID = 'backup-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function prepareNotifications() {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '备份提醒',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function setBackupReminder(days: number, lastBackupAt?: string | null) {
  if (Platform.OS === 'web') return days === 0;
  await Notifications.cancelScheduledNotificationAsync(BACKUP_REMINDER_ID).catch(() => undefined);
  if (!days) return true;
  if (!await prepareNotifications()) return false;

  const intervalMs = days * 24 * 60 * 60 * 1000;
  const lastTime = lastBackupAt ? Date.parse(lastBackupAt) : Number.NaN;
  const desiredTime = Number.isFinite(lastTime) ? lastTime + intervalMs : Date.now() + intervalMs;
  const seconds = Math.max(60, Math.round((desiredTime - Date.now()) / 1000));
  await Notifications.scheduleNotificationAsync({
    identifier: BACKUP_REMINDER_ID,
    content: {
      title: '该备份一下拾时了',
      body: `距离上次完整备份已经接近 ${days} 天，记得导出一份 ZIP 备份。`,
      data: { route: '/backup' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
  });
  return true;
}
