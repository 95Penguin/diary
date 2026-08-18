import assert from 'node:assert/strict';
import test from 'node:test';

import { addTimeCapsuleImages, createTimeCapsule, createTimeCapsuleReply, deleteTimeCapsule, getTimeCapsule, listTimeCapsules, openTimeCapsule } from '../src/database/time-capsule-repository.ts';
import { migrateDatabase } from '../src/database/migrate.ts';
import { createJournalExport, importJournalBackup } from '../src/database/journal-repository.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

test('time capsule follows locked, ready and opened lifecycle', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await migrateDatabase(db);
  const createdAt = new Date('2026-08-01T00:00:00.000Z');
  const id = await createTimeCapsule(db, { title: '  写给未来  ', content: '  希望你一切都好  ', openAt: '2026-09-01T00:00:00.000Z' }, createdAt);

  const locked = await getTimeCapsule(db, id, createdAt);
  assert.equal(locked.status, 'locked');
  assert.equal(locked.content, '');
  assert.equal(await openTimeCapsule(db, id, new Date('2026-08-31T23:59:59.000Z')), false);
  const ready = await getTimeCapsule(db, id, new Date('2026-09-01T00:00:00.000Z'));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.content, '');
  assert.equal(await openTimeCapsule(db, id, new Date('2026-09-01T00:00:00.000Z')), true);
  const opened = await getTimeCapsule(db, id, new Date('2026-09-02T00:00:00.000Z'));
  assert.equal(opened.status, 'opened');
  assert.equal(opened.title, '写给未来');
  assert.equal(opened.content, '希望你一切都好');
  await createTimeCapsuleReply(db, id, '  我现在很好  ', new Date('2026-09-02T01:00:00.000Z'));
  const withReply = await getTimeCapsule(db, id, new Date('2026-09-02T02:00:00.000Z'));
  assert.equal(withReply.replies.length, 1);
  assert.equal(withReply.replies[0].content, '我现在很好');

  await deleteTimeCapsule(db, id, new Date('2026-09-03T00:00:00.000Z'));
  assert.deepEqual(await listTimeCapsules(db), []);
});

test('time capsule refuses replies before it has been opened', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await migrateDatabase(db);
  const now = new Date('2026-08-01T00:00:00.000Z');
  const id = await createTimeCapsule(db, { title: '未来', content: '正文', openAt: '2026-09-01T00:00:00.000Z' }, now);
  await assert.rejects(() => createTimeCapsuleReply(db, id, '回应', now), /not-opened/);
});

test('time capsule rejects missing content and non-future opening times', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await migrateDatabase(db);
  const now = new Date('2026-08-01T00:00:00.000Z');
  await assert.rejects(() => createTimeCapsule(db, { title: '', content: '内容', openAt: '2026-09-01T00:00:00.000Z' }, now), /content-required/);
  await assert.rejects(() => createTimeCapsule(db, { title: '标题', content: '内容', openAt: now.toISOString() }, now), /must-be-future/);
});

test('backup and restore preserve capsules, opened state and replies', async (t) => {
  const source = createTestDatabase();
  const target = createTestDatabase();
  t.after(() => { source.close(); target.close(); });
  await migrateDatabase(source); await migrateDatabase(target);
  const createdAt = new Date('2026-08-01T00:00:00.000Z');
  const id = await createTimeCapsule(source, { title: '备份胶囊', content: '不能丢失', openAt: '2026-09-01T00:00:00.000Z' }, createdAt);
  await addTimeCapsuleImages(source, id, [{ uri: 'file:///capsule/photo.jpg', width: 1200, height: 900, mediaType: 'image', pairedVideoUri: null, duration: null, thumbnailUri: null }], createdAt);
  await openTimeCapsule(source, id, new Date('2026-09-01T00:00:00.000Z'));
  await createTimeCapsuleReply(source, id, '未来回应', new Date('2026-09-02T00:00:00.000Z'));
  const backup = await createJournalExport(source);
  assert.equal(backup.version, 14);
  assert.equal(backup.timeCapsules.length, 1);
  assert.equal(backup.timeCapsuleReplies.length, 1);
  assert.equal(backup.timeCapsuleImages.length, 1);
  await importJournalBackup(target, backup);
  const restored = await getTimeCapsule(target, id, new Date('2026-09-03T00:00:00.000Z'));
  assert.equal(restored.content, '不能丢失');
  assert.equal(restored.replies[0].content, '未来回应');
  assert.equal(restored.images[0].uri, 'file:///capsule/photo.jpg');
});
