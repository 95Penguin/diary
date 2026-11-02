import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

function createReminderHarness() {
  const scheduled = [];
  let permission = true;
  let requests = 0;
  const notifications = {
    AndroidImportance: { DEFAULT: 3, NONE: 0 },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
    setNotificationChannelAsync: async () => undefined,
    getNotificationChannelAsync: async () => ({ importance: 3 }),
    getPermissionsAsync: async () => ({ granted: permission }),
    requestPermissionsAsync: async () => { requests += 1; return { granted: permission }; },
    getAllScheduledNotificationsAsync: async () => [...scheduled],
    cancelScheduledNotificationAsync: async (identifier) => {
      const index = scheduled.findIndex((item) => item.identifier === identifier);
      if (index >= 0) scheduled.splice(index, 1);
    },
    scheduleNotificationAsync: async (item) => {
      scheduled.push(item);
      return item.identifier;
    },
  };
  const source = readFileSync(new URL('../src/utils/backup-reminder.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name) => name === 'react-native' ? { Platform: { OS: 'android' } } : notifications,
    Date,
    Number,
    Math,
  });
  return { api: module.exports, scheduled, setPermission: (value) => { permission = value; }, getRequests: () => requests };
}

test('backup reminders continue after the first notification and survive sync', async () => {
  const { api, scheduled } = createReminderHarness();
  const lastBackupAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(await api.setBackupReminder(7, lastBackupAt), true);
  assert.equal(scheduled.length, 12);
  assert.equal(scheduled[0].trigger.repeats, false);
  assert.equal(scheduled[1].content.data.scheduledFor - scheduled[0].content.data.scheduledFor, 7 * 24 * 60 * 60 * 1000);
  const first = scheduled[0];
  const status = await api.syncBackupReminder(7, lastBackupAt);
  assert.equal(status.permitted, true);
  assert.equal(scheduled[0], first);
  scheduled.shift();
  await api.syncBackupReminder(7, lastBackupAt);
  assert.equal(scheduled.length, 11);
});

test('denied permission preserves an existing reminder and does not prompt during sync', async () => {
  const { api, scheduled, setPermission, getRequests } = createReminderHarness();
  await api.setBackupReminder(7);
  const original = scheduled[0];
  setPermission(false);
  assert.equal(await api.setBackupReminder(14), false);
  assert.equal(scheduled[0], original);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.syncBackupReminder(7))), { permitted: false, nextAt: null });
  assert.equal(getRequests(), 1);
});

test('a newer automatic backup resets the reminder schedule', async () => {
  const { api, scheduled } = createReminderHarness();
  const older = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const newer = new Date().toISOString();
  await api.setBackupReminder(7, older);
  await api.syncBackupReminder(7, api.latestBackupAt(older, newer));
  assert.equal(scheduled.length, 12);
  assert.equal(scheduled[0].content.data.backupAt, newer);
  assert.ok(scheduled[0].trigger.seconds > 6 * 24 * 60 * 60);
});

test('startup repairs a missing or exhausted reminder schedule', async () => {
  const { api, scheduled } = createReminderHarness();
  const status = await api.syncBackupReminder(14);
  assert.equal(status.permitted, true);
  assert.equal(scheduled.length, 12);
  scheduled.splice(0);
  await api.syncBackupReminder(14);
  assert.equal(scheduled.length, 12);
});
