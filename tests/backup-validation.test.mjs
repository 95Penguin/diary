import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

import { parseJournalBackup } from '../src/utils/backup-import.ts';
import {
  readBackupArchive,
  validateArchiveMediaReferences,
} from '../src/utils/backup-archive-validation.ts';

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

test('accepts location catalog in v10 and rejects unsafe location metadata', () => {
  const backup = {
    ...validBackup(),
    version: 10,
    metadataCatalog: {
      tags: [],
      locations: ['学校'],
      pinnedTags: [],
      pinnedLocations: ['学校'],
      locationDetails: {
        学校: { address: '北京市海淀区', latitude: 39.9, longitude: 116.4, category: '学校', favorite: true },
      },
    },
  };
  assert.deepEqual(parseJournalBackup(JSON.stringify(backup)), backup);
  backup.metadataCatalog.locationDetails.学校.latitude = 'not-a-coordinate';
  assert.throws(() => parseJournalBackup(JSON.stringify(backup)), /invalid-backup/);
  backup.metadataCatalog.locationDetails.学校.latitude = null;
  backup.metadataCatalog.locationDetails.学校.longitude = null;
  assert.deepEqual(parseJournalBackup(JSON.stringify(backup)), backup);
});

test('accepts portable profile and settings in v11 and rejects invalid values', () => {
  const backup = {
    ...validBackup(),
    version: 11,
    appPreferences: {
      nickname: '拾时',
      signature: '把日子慢慢收好。',
      avatarLocalUri: 'profile/avatar.png',
      themeMode: 'system',
      fontSize: 'large',
      readingTheme: 'green',
      readingFont: 'serif',
      appLockEnabled: true,
      appLockDelaySeconds: 60,
      backupReminderDays: 14,
    },
  };
  assert.deepEqual(parseJournalBackup(JSON.stringify(backup)), backup);
  backup.appPreferences.fontSize = 'huge';
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

test('requires a referenced profile avatar to exist in the archive', () => {
  const backup = parseJournalBackup(JSON.stringify({
    ...validBackup(),
    version: 11,
    appPreferences: {
      nickname: '拾时',
      signature: '',
      avatarLocalUri: 'profile/avatar.jpg',
      themeMode: 'system',
      fontSize: 'standard',
      readingTheme: 'cream',
      readingFont: 'serif',
      appLockEnabled: false,
      appLockDelaySeconds: 0,
      backupReminderDays: 0,
    },
  }));
  const files = {
    'media/entries/image-1/primary.mp4': new Uint8Array([1]),
    'media/entries/image-1/thumbnail.jpg': new Uint8Array([2]),
    'media/follow-ups/follow-up-image-1/primary.jpg': new Uint8Array([3]),
  };
  assert.throws(() => validateArchiveMediaReferences(backup, files), /missing-backup-media/);
  files['profile/avatar.jpg'] = new Uint8Array([4]);
  assert.doesNotThrow(() => validateArchiveMediaReferences(backup, files));
});

test('rejects empty media files as corrupt archive content', () => {
  const backup = parseJournalBackup(JSON.stringify(validBackup()));
  const files = {
    'media/entries/image-1/primary.mp4': new Uint8Array(),
    'media/entries/image-1/thumbnail.jpg': new Uint8Array([2]),
    'media/follow-ups/follow-up-image-1/primary.jpg': new Uint8Array([3]),
  };
  assert.throws(() => validateArchiveMediaReferences(backup, files), /missing-backup-media/);
});

test('reads a complete ZIP and rejects missing, malformed or corrupt manifests', () => {
  const backup = validBackup();
  const complete = zipSync({
    'backup.json': strToU8(JSON.stringify(backup)),
    'media/entries/image-1/primary.mp4': new Uint8Array([1]),
    'media/entries/image-1/thumbnail.jpg': new Uint8Array([2]),
    'media/follow-ups/follow-up-image-1/primary.jpg': new Uint8Array([3]),
  });
  assert.equal(readBackupArchive(complete, parseJournalBackup).backup.entries[0].id, 'entry-1');

  assert.throws(
    () => readBackupArchive(new Uint8Array([1, 2, 3]), parseJournalBackup),
    /invalid-backup/,
  );
  assert.throws(
    () => readBackupArchive(zipSync({ 'note.txt': strToU8('no manifest') }), parseJournalBackup),
    /invalid-backup/,
  );
  assert.throws(
    () => readBackupArchive(zipSync({ 'backup.json': strToU8('{') }), parseJournalBackup),
    /invalid-json/,
  );
});
