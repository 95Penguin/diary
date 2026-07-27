import assert from 'node:assert/strict';
import test from 'node:test';

import { parseJournalBackup } from '../src/utils/backup-import.ts';
import { validateArchiveMediaReferences } from '../src/utils/backup-archive-validation.ts';

function validBackup() {
  return {
    format: 'shishi-journal',
    version: 9,
    exportedAt: '2026-07-27T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
    entries: [{
      id: 'entry-1',
      content: '正文',
      occurredAt: '2026-07-27T00:00:00.000Z',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
      deletedAt: null,
    }],
    followUps: [{
      id: 'follow-up-1',
      entryId: 'entry-1',
      content: '后续',
      createdAt: '2026-07-27T00:01:00.000Z',
      updatedAt: '2026-07-27T00:01:00.000Z',
      deletedAt: null,
    }],
    images: [{
      id: 'image-1',
      entryId: 'entry-1',
      localUri: 'media/entries/image-1/primary.mp4',
      width: 1920,
      height: 1080,
      sortOrder: 0,
      createdAt: '2026-07-27T00:00:00.000Z',
      mediaType: 'video',
      duration: 8,
      thumbnailLocalUri: 'media/entries/image-1/thumbnail.jpg',
    }],
    followUpImages: [{
      id: 'follow-up-image-1',
      followUpId: 'follow-up-1',
      localUri: 'media/follow-ups/follow-up-image-1/primary.jpg',
      width: 800,
      height: 600,
      sortOrder: 0,
      createdAt: '2026-07-27T00:01:00.000Z',
      mediaType: 'image',
    }],
    tags: [{ entryId: 'entry-1', label: '测试', sortOrder: 0 }],
    versions: [],
    suppressedMemoryEntryIds: ['entry-1'],
  };
}

test('accepts a complete current backup', () => {
  const backup = validBackup();
  assert.deepEqual(parseJournalBackup(JSON.stringify(backup)), backup);
});

test('rejects malformed JSON and unsupported versions', () => {
  assert.throws(() => parseJournalBackup('{'), /invalid-json/);
  assert.throws(
    () => parseJournalBackup(JSON.stringify({ ...validBackup(), version: 99 })),
    /unsupported-backup/,
  );
});

test('rejects duplicate IDs and dangling relationships', () => {
  const duplicate = validBackup();
  duplicate.entries.push({ ...duplicate.entries[0] });
  assert.throws(() => parseJournalBackup(JSON.stringify(duplicate)), /invalid-backup/);

  const dangling = validBackup();
  dangling.followUps[0].entryId = 'missing-entry';
  assert.throws(() => parseJournalBackup(JSON.stringify(dangling)), /invalid-backup/);
});

test('rejects invalid media metadata', () => {
  const backup = validBackup();
  backup.images[0].mediaType = 'audio';
  assert.throws(() => parseJournalBackup(JSON.stringify(backup)), /invalid-backup/);
});

test('accepts archive only when every referenced media file is present', () => {
  const backup = parseJournalBackup(JSON.stringify(validBackup()));
  const files = {
    'media/entries/image-1/primary.mp4': new Uint8Array([1]),
    'media/entries/image-1/thumbnail.jpg': new Uint8Array([2]),
    'media/follow-ups/follow-up-image-1/primary.jpg': new Uint8Array([3]),
  };
  assert.doesNotThrow(() => validateArchiveMediaReferences(backup, files));
  delete files['media/entries/image-1/thumbnail.jpg'];
  assert.throws(() => validateArchiveMediaReferences(backup, files), /missing-backup-media/);
});
