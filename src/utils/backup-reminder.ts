import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export const BACKUP_REMINDER_ID = 'shishi-backup-reminder';
const CHANNEL_ID = 'backup-reminders';
const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_COUNT = 12;
let operation: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = operation.catch(() => undefined).then(task);
  operation = next;
  return next;
}

export function latestBackupAt(...values: (string | null | undefined)[]) {
  const times = values.map((value) => value ? Date.parse(value) : Number.NaN).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

async function hasPermission(request: boolean) {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '备份提醒',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    const channel = await Notifications.getNotificationChannelAsync(CHANNEL_ID);
    if (channel?.importance === Notifications.AndroidImportance.NONE) return false;
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return request && (await Notifications.requestPermissionsAsync()).granted;
}

async function scheduledReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.filter((item) => item.identifier === BACKUP_REMINDER_ID || item.identifier.startsWith(`${BACKUP_REMINDER_ID}-`));
}

async function cancelReminders() {
  for (const reminder of await scheduledReminders()) {
    await Notifications.cancelScheduledNotificationAsync(reminder.identifier);
  }
}

async function scheduleReminders(days: number, lastBackupAt: string | null) {
  await cancelReminders();
  const intervalMs = days * DAY_MS;
  const lastTime = lastBackupAt ? Date.parse(lastBackupAt) : Number.NaN;
  const desiredTime = Number.isFinite(lastTime) ? lastTime + intervalMs : Date.now() + intervalMs;
  const firstAt = Math.max(Date.now() + 60_000, desiredTime);
  for (let index = 0; index < REMINDER_COUNT; index += 1) {
    const scheduledFor = firstAt + index * intervalMs;
    await Notifications.scheduleNotificationAsync({
      identifier: `${BACKUP_REMINDER_ID}-${index}`,
      content: {
        title: '该备份一下拾时了',
        body: '记得导出一份 ZIP 备份，保存你的日迹。',
        data: { route: '/backup', reminderDays: days, backupAt: lastBackupAt ?? '', scheduledFor },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(60, Math.ceil((scheduledFor - Date.now()) / 1000)),
        repeats: false,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
  }
  return firstAt;
}

export function setBackupReminder(days: number, lastBackupAt?: string | null) {
  return serialize(() => updateBackupReminder(days, lastBackupAt));
}

async function updateBackupReminder(days: number, lastBackupAt?: string | null) {
  if (Platform.OS === 'web') return days === 0;
  if (!days) {
    await cancelReminders();
    return true;
  }
  // A rejected permission request must not erase the previous schedule.
  if (!await hasPermission(true)) return false;
  await scheduleReminders(days, lastBackupAt ?? null);
  return true;
}

export function syncBackupReminder(days: number, lastBackupAt?: string | null) {
  return serialize(() => reconcileBackupReminder(days, lastBackupAt));
}

async function reconcileBackupReminder(days: number, lastBackupAt?: string | null) {
  if (Platform.OS === 'web') return { permitted: false, nextAt: null as string | null };
  const reminders = await scheduledReminders();
  if (!days) {
    if (reminders.length) await cancelReminders();
    return { permitted: true, nextAt: null as string | null };
  }
  const permitted = await hasPermission(false);
  if (!permitted) return { permitted: false, nextAt: null as string | null };
  const backupAt = lastBackupAt ?? '';
  const matches = reminders.length > 0 && reminders.every((item) => item.content.data?.reminderDays === days && item.content.data?.backupAt === backupAt);
  const future = matches ? reminders.map((item) => Number(item.content.data?.scheduledFor)).filter((time) => Number.isFinite(time) && time > Date.now()).sort((a, b) => a - b) : [];
  const nextAt = future.length ? future[0] : await scheduleReminders(days, lastBackupAt ?? null);
  return { permitted: true, nextAt: new Date(nextAt).toISOString() };
}
