import { File } from 'expo-file-system';
import { strToU8, zipSync, type Zippable } from 'fflate';

import type { JournalBackup } from '@/domain/journal';
import { readBackupArchive } from '@/utils/backup-archive-validation';
import { parseJournalBackup } from '@/utils/backup-import';
import { deleteJournalImage, persistJournalImageBytes } from '@/utils/image-storage';

export type ZipBackupProgress = (completed: number, total: number) => void;
type BackupMedia = JournalBackup['images'][number] | NonNullable<JournalBackup['followUpImages']>[number];

function extensionFor(uri: string | null | undefined, fallback: string) {
  return uri?.match(/\.[a-zA-Z0-9]+(?=$|[?#])/)?.[0] ?? fallback;
}

function withoutEmbeddedData<T extends BackupMedia>(item: T): T {
  const {
    dataBase64: _dataBase64,
    pairedVideoDataBase64: _pairedVideoDataBase64,
    thumbnailDataBase64: _thumbnailDataBase64,
    ...rest
  } = item;
  return rest as T;
}

async function appendFile(files: Zippable, sourceUri: string | null | undefined, archivePath: string) {
  if (!sourceUri) return false;
  try {
    const file = new File(sourceUri);
    if (!file.exists) return false;
    files[archivePath] = [await file.bytes(), { level: 0 }];
    return true;
  } catch {
    return false;
  }
}

export async function createZipBackup(backup: JournalBackup, onProgress?: ZipBackupProgress) {
  const files: Zippable = {};
  const hasAvatar = Boolean(backup.appPreferences?.avatarLocalUri);
  const total = backup.images.length + (backup.followUpImages?.length ?? 0) + (hasAvatar ? 1 : 0);
  let completed = 0;
  let missingMedia = 0;

  async function archiveItem<T extends BackupMedia>(item: T, group: string): Promise<T> {
    const clean = withoutEmbeddedData(item);
    const base = `media/${group}/${item.id}`;
    const primaryPath = `${base}/primary${extensionFor(item.localUri, item.mediaType === 'video' ? '.mp4' : '.jpg')}`;
    const pairedPath = item.pairedVideoLocalUri ? `${base}/paired${extensionFor(item.pairedVideoLocalUri, '.mov')}` : null;
    const thumbnailPath = item.thumbnailLocalUri ? `${base}/thumbnail${extensionFor(item.thumbnailLocalUri, '.jpg')}` : null;
    const hasPrimary = await appendFile(files, item.localUri, primaryPath);
    const hasPaired = pairedPath ? await appendFile(files, item.pairedVideoLocalUri, pairedPath) : false;
    const hasThumbnail = thumbnailPath ? await appendFile(files, item.thumbnailLocalUri, thumbnailPath) : false;
    if (!hasPrimary) missingMedia += 1;
    completed += 1;
    onProgress?.(completed, total);
    return {
      ...clean,
      localUri: hasPrimary ? primaryPath : '',
      pairedVideoLocalUri: hasPaired ? pairedPath : null,
      thumbnailLocalUri: hasThumbnail ? thumbnailPath : null,
    };
  }

  const images = [] as JournalBackup['images'];
  for (const item of backup.images) images.push(await archiveItem(item, 'entries'));
  const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
  for (const item of backup.followUpImages ?? []) followUpImages.push(await archiveItem(item, 'follow-ups'));
  let appPreferences = backup.appPreferences;
  if (appPreferences?.avatarLocalUri) {
    const avatarPath = `profile/avatar${extensionFor(appPreferences.avatarLocalUri, '.jpg')}`;
    const hasProfileAvatar = await appendFile(files, appPreferences.avatarLocalUri, avatarPath);
    if (!hasProfileAvatar) missingMedia += 1;
    completed += 1;
    onProgress?.(completed, total);
    appPreferences = {
      ...appPreferences,
      avatarLocalUri: hasProfileAvatar ? avatarPath : null,
      avatarDataBase64: undefined,
      avatarMimeType: undefined,
    };
  }
  const manifest: JournalBackup = { ...backup, images, followUpImages, appPreferences };
  files['backup.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
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
  const createdUris: string[] = [];
  const hasAvatar = Boolean(backup.appPreferences?.avatarLocalUri);
  const total = backup.images.length + (backup.followUpImages?.length ?? 0) + (hasAvatar ? 1 : 0);
  let completed = 0;

  async function restoreItem<T extends BackupMedia>(item: T): Promise<T> {
    const primary = item.localUri ? files[item.localUri] : null;
    if (!primary) {
      completed += 1;
      onProgress?.(completed, total);
      return { ...item, localUri: '', pairedVideoLocalUri: null, thumbnailLocalUri: null };
    }
    const localUri = await persistJournalImageBytes(primary, extensionFor(item.localUri, '.jpg'));
    createdUris.push(localUri);
    let pairedVideoLocalUri: string | null = null;
    const pairedPath = item.pairedVideoLocalUri;
    if (pairedPath && files[pairedPath]) {
      pairedVideoLocalUri = await persistJournalImageBytes(files[pairedPath], extensionFor(pairedPath, '.mov'));
      createdUris.push(pairedVideoLocalUri);
    }
    let thumbnailLocalUri: string | null = null;
    const thumbnailPath = item.thumbnailLocalUri;
    if (thumbnailPath && files[thumbnailPath]) {
      thumbnailLocalUri = await persistJournalImageBytes(files[thumbnailPath], extensionFor(thumbnailPath, '.jpg'));
      createdUris.push(thumbnailLocalUri);
    }
    completed += 1;
    onProgress?.(completed, total);
    return { ...item, localUri, pairedVideoLocalUri, thumbnailLocalUri };
  }

  try {
    const images = [] as JournalBackup['images'];
    for (const item of backup.images) images.push(await restoreItem(item));
    const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
    for (const item of backup.followUpImages ?? []) followUpImages.push(await restoreItem(item));
    let appPreferences = backup.appPreferences;
    if (appPreferences?.avatarLocalUri) {
      const avatarPath = appPreferences.avatarLocalUri;
      const avatarBytes = files[avatarPath];
      if (!avatarBytes) throw new Error('missing-backup-media');
      const avatarLocalUri = await persistJournalImageBytes(avatarBytes, extensionFor(avatarPath, '.jpg'));
      createdUris.push(avatarLocalUri);
      completed += 1;
      onProgress?.(completed, total);
      appPreferences = { ...appPreferences, avatarLocalUri };
    }
    return { backup: { ...backup, images, followUpImages, appPreferences }, createdUris };
  } catch (error) {
    createdUris.forEach(deleteJournalImage);
    throw error;
  }
}
