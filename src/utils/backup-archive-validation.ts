import type { JournalBackup } from '@/domain/journal';

type ArchiveFiles = Record<string, Uint8Array | undefined>;
type BackupMedia = JournalBackup['images'][number] | NonNullable<JournalBackup['followUpImages']>[number];

function assertItemFiles(item: BackupMedia, files: ArchiveFiles) {
  for (const path of [item.localUri, item.pairedVideoLocalUri, item.thumbnailLocalUri]) {
    if (path && !files[path]) throw new Error('missing-backup-media');
  }
}

export function validateArchiveMediaReferences(backup: JournalBackup, files: ArchiveFiles) {
  backup.images.forEach((item) => assertItemFiles(item, files));
  (backup.followUpImages ?? []).forEach((item) => assertItemFiles(item, files));
}
