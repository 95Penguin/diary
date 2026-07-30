import { strToU8, zipSync, type Zippable } from 'fflate';

import type { JournalBackup } from '@/domain/journal';
import { readBackupArchive } from '@/utils/backup-archive-validation';
import { parseJournalBackup } from '@/utils/backup-import';
import { persistJournalImageBytes } from '@/utils/image-storage';

export type ZipBackupProgress = (completed: number, total: number) => void;
type BackupMedia = JournalBackup['images'][number] | NonNullable<JournalBackup['followUpImages']>[number];

function extensionFor(uri: string | null | undefined, fallback: string) {
  return uri?.match(/\.[a-zA-Z0-9]+(?=$|[?#])/)?.[0] ?? fallback;
}

async function readUri(uri: string | null | undefined) {
  if (!uri) return null;
  try {
    return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  } catch {
    return null;
  }
}

export async function createZipBackup(backup: JournalBackup, onProgress?: ZipBackupProgress) {
  const files: Zippable = {};
  const hasAvatar = Boolean(backup.appPreferences?.avatarLocalUri);
  const total = backup.images.length + (backup.followUpImages?.length ?? 0) + (hasAvatar ? 1 : 0);
  let completed = 0;
  let missingMedia = 0;
  async function archiveItem<T extends BackupMedia>(item: T, group: string): Promise<T> {
    const base = `media/${group}/${item.id}`;
    const primaryPath = `${base}/primary${extensionFor(item.localUri, item.mediaType === 'video' ? '.mp4' : '.jpg')}`;
    const primary = await readUri(item.localUri);
    if (primary) files[primaryPath] = [primary, { level: 0 }]; else missingMedia += 1;
    completed += 1; onProgress?.(completed, total);
    return { ...item, localUri: primary ? primaryPath : '', dataBase64: undefined, pairedVideoLocalUri: null, pairedVideoDataBase64: undefined, thumbnailLocalUri: null, thumbnailDataBase64: undefined };
  }
  const images = [] as JournalBackup['images'];
  for (const item of backup.images) images.push(await archiveItem(item, 'entries'));
  const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
  for (const item of backup.followUpImages ?? []) followUpImages.push(await archiveItem(item, 'follow-ups'));
  let appPreferences = backup.appPreferences;
  if (appPreferences?.avatarLocalUri) {
    const avatarPath = `profile/avatar${extensionFor(appPreferences.avatarLocalUri, '.jpg')}`;
    const avatar = await readUri(appPreferences.avatarLocalUri);
    if (avatar) files[avatarPath] = [avatar, { level: 0 }]; else missingMedia += 1;
    completed += 1; onProgress?.(completed, total);
    appPreferences = { ...appPreferences, avatarLocalUri: avatar ? avatarPath : null, avatarDataBase64: undefined, avatarMimeType: undefined };
  }
  files['backup.json'] = [strToU8(JSON.stringify({ ...backup, images, followUpImages, appPreferences })), { level: 6 }];
  return { bytes: zipSync(files), missingMedia };
}

function readZip(bytes: Uint8Array) {
  return readBackupArchive(bytes, parseJournalBackup);
}

export function inspectZipBackup(bytes: Uint8Array) {
  return readZip(bytes).backup;
}

export async function materializeZipBackup(bytes: Uint8Array, onProgress?: ZipBackupProgress) {
  const { files, backup } = readZip(bytes);
  const hasAvatar = Boolean(backup.appPreferences?.avatarLocalUri);
  const total = backup.images.length + (backup.followUpImages?.length ?? 0) + (hasAvatar ? 1 : 0);
  let completed = 0;
  async function restoreItem<T extends BackupMedia>(item: T): Promise<T> {
    const primary = item.localUri ? files[item.localUri] : null;
    const localUri = primary ? await persistJournalImageBytes(primary, extensionFor(item.localUri, '.jpg')) : '';
    completed += 1; onProgress?.(completed, total);
    return { ...item, localUri, pairedVideoLocalUri: null, thumbnailLocalUri: null };
  }
  const images = [] as JournalBackup['images'];
  for (const item of backup.images) images.push(await restoreItem(item));
  const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
  for (const item of backup.followUpImages ?? []) followUpImages.push(await restoreItem(item));
  let appPreferences = backup.appPreferences;
  if (appPreferences?.avatarLocalUri) {
    const avatarPath = appPreferences.avatarLocalUri;
    const avatar = files[avatarPath];
    if (!avatar) throw new Error('missing-backup-media');
    const avatarLocalUri = await persistJournalImageBytes(avatar, extensionFor(avatarPath, '.jpg'));
    completed += 1; onProgress?.(completed, total);
    appPreferences = { ...appPreferences, avatarLocalUri };
  }
  return { backup: { ...backup, images, followUpImages, appPreferences }, createdUris: [] as string[] };
}
