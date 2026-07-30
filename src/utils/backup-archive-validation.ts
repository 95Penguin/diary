import type { JournalBackup } from '@/domain/journal';
import { strFromU8, unzipSync } from 'fflate';

type ArchiveFiles = Record<string, Uint8Array | undefined>;
type BackupMedia = JournalBackup['images'][number] | NonNullable<JournalBackup['followUpImages']>[number];

function assertItemFiles(item: BackupMedia, files: ArchiveFiles) {
  for (const path of [item.localUri, item.pairedVideoLocalUri, item.thumbnailLocalUri]) {
    if (path && (!files[path] || files[path].byteLength === 0)) {
      throw new Error('missing-backup-media');
    }
  }
}

export function validateArchiveMediaReferences(backup: JournalBackup, files: ArchiveFiles) {
  backup.images.forEach((item) => assertItemFiles(item, files));
  (backup.followUpImages ?? []).forEach((item) => assertItemFiles(item, files));
  const avatarPath = backup.appPreferences?.avatarLocalUri;
  if (avatarPath && (!files[avatarPath] || files[avatarPath].byteLength === 0)) {
    throw new Error('missing-backup-media');
  }
}

export function readBackupArchive(
  bytes: Uint8Array,
  parseBackup: (contents: string) => JournalBackup,
) {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('invalid-backup');
  }
  const manifest = files['backup.json'];
  if (!manifest?.byteLength) throw new Error('invalid-backup');
  const backup = parseBackup(strFromU8(manifest));
  validateArchiveMediaReferences(backup, files);
  return { files, backup };
}
