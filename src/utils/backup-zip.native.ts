import { Directory, File, Paths } from 'expo-file-system';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { listContents, NO_COMPRESSION, unzip, zip, type ZipEntry } from 'react-native-zip-archive';

import type { JournalBackup } from '@/domain/journal';
import { readBackupArchive } from '@/utils/backup-archive-validation';
import { parseJournalBackup } from '@/utils/backup-import';
import { deleteJournalImage, persistJournalImage, persistJournalImageBytes } from '@/utils/image-storage';

export type ZipBackupProgress = (completed: number, total: number) => void;
type BackupMedia = JournalBackup['images'][number] | NonNullable<JournalBackup['followUpImages']>[number] | NonNullable<JournalBackup['timeCapsuleImages']>[number];

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
  const total = backup.images.length + (backup.followUpImages?.length ?? 0) + (backup.timeCapsuleImages?.length ?? 0) + (hasAvatar ? 1 : 0);
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
    if (pairedPath && !hasPaired) missingMedia += 1;
    if (thumbnailPath && !hasThumbnail) missingMedia += 1;
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
  const timeCapsuleImages = [] as NonNullable<JournalBackup['timeCapsuleImages']>;
  for (const item of backup.timeCapsuleImages ?? []) timeCapsuleImages.push(await archiveItem(item, 'time-capsules'));
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
  const manifest: JournalBackup = { ...backup, images, followUpImages, timeCapsuleImages, appPreferences };
  files['backup.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  return { bytes: zipSync(files), missingMedia };
}

export async function createZipBackupFile(backup: JournalBackup, onProgress?: ZipBackupProgress) {
  const directory = new Directory(Paths.cache, `backup-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const destination = new File(Paths.cache, `shishi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
  directory.create({ idempotent: true, intermediates: true });
  const hasAvatar = Boolean(backup.appPreferences?.avatarLocalUri);
  const total = backup.images.length + (backup.followUpImages?.length ?? 0) + (backup.timeCapsuleImages?.length ?? 0) + (hasAvatar ? 1 : 0);
  let completed = 0;
  let missingMedia = 0;
  async function archiveItem<T extends BackupMedia>(item: T, group: string): Promise<T> {
    const clean = withoutEmbeddedData(item);
    const base = `media/${group}/${item.id}`;
    const primaryPath = `${base}/primary${extensionFor(item.localUri, item.mediaType === 'video' ? '.mp4' : '.jpg')}`;
    const pairedPath = item.pairedVideoLocalUri ? `${base}/paired${extensionFor(item.pairedVideoLocalUri, '.mov')}` : null;
    const thumbnailPath = item.thumbnailLocalUri ? `${base}/thumbnail${extensionFor(item.thumbnailLocalUri, '.jpg')}` : null;
    const copy = async (sourceUri: string | null | undefined, path: string | null) => {
      if (!sourceUri || !path) return false;
      try {
        const source = new File(sourceUri);
        if (!source.exists) return false;
        const target = new File(directory, path);
        target.parentDirectory.create({ idempotent: true, intermediates: true });
        await source.copy(target);
        return true;
      } catch { return false; }
    };
    const hasPrimary = await copy(item.localUri, primaryPath);
    const hasPaired = await copy(item.pairedVideoLocalUri, pairedPath);
    const hasThumbnail = await copy(item.thumbnailLocalUri, thumbnailPath);
    if (!hasPrimary) missingMedia += 1;
    if (pairedPath && !hasPaired) missingMedia += 1;
    if (thumbnailPath && !hasThumbnail) missingMedia += 1;
    completed += 1;
    onProgress?.(completed, total);
    return { ...clean, localUri: hasPrimary ? primaryPath : '', pairedVideoLocalUri: hasPaired ? pairedPath : null, thumbnailLocalUri: hasThumbnail ? thumbnailPath : null };
  }
  try {
    const images = [] as JournalBackup['images'];
    for (const item of backup.images) images.push(await archiveItem(item, 'entries'));
    const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
    for (const item of backup.followUpImages ?? []) followUpImages.push(await archiveItem(item, 'follow-ups'));
    const timeCapsuleImages = [] as NonNullable<JournalBackup['timeCapsuleImages']>;
    for (const item of backup.timeCapsuleImages ?? []) timeCapsuleImages.push(await archiveItem(item, 'time-capsules'));
    let appPreferences = backup.appPreferences;
    if (appPreferences?.avatarLocalUri) {
      const avatarPath = `profile/avatar${extensionFor(appPreferences.avatarLocalUri, '.jpg')}`;
      const source = new File(appPreferences.avatarLocalUri);
      const target = new File(directory, avatarPath);
      let copied = false;
      try {
        if (source.exists) {
          target.parentDirectory.create({ idempotent: true, intermediates: true });
          await source.copy(target);
          copied = true;
        }
      } catch { /* A missing avatar should not prevent the journal backup. */ }
      if (!copied) missingMedia += 1;
      completed += 1;
      onProgress?.(completed, total);
      appPreferences = { ...appPreferences, avatarLocalUri: copied ? avatarPath : null, avatarDataBase64: undefined, avatarMimeType: undefined };
    }
    const manifest = new File(directory, 'backup.json');
    manifest.create({ intermediates: true });
    manifest.write(JSON.stringify({ ...backup, images, followUpImages, timeCapsuleImages, appPreferences }));
    if (destination.exists) destination.delete();
    await zip(directory.uri, destination.uri, NO_COMPRESSION);
    if (!destination.exists || !destination.size) throw new Error('backup-creation-failed');
    return { uri: destination.uri, size: destination.size, missingMedia };
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  } finally {
    if (directory.exists) directory.delete();
  }
}

function readZip(bytes: Uint8Array) {
  return readBackupArchive(bytes, parseJournalBackup);
}

export function inspectZipBackup(bytes: Uint8Array) {
  return readZip(bytes).backup;
}

function temporaryRestoreDirectory() {
  return new Directory(Paths.cache, `backup-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function safeArchivePath(path: string) {
  return Boolean(path)
    && !path.startsWith('/')
    && !path.startsWith('\\')
    && !path.includes('\\')
    && !path.split('/').includes('..');
}

function referencedArchivePaths(backup: JournalBackup) {
  const paths: string[] = [];
  const addItem = (item: BackupMedia) => {
    for (const path of [item.localUri, item.pairedVideoLocalUri, item.thumbnailLocalUri]) if (path) paths.push(path);
  };
  backup.images.forEach(addItem);
  (backup.followUpImages ?? []).forEach(addItem);
  (backup.timeCapsuleImages ?? []).forEach(addItem);
  if (backup.appPreferences?.avatarLocalUri) paths.push(backup.appPreferences.avatarLocalUri);
  return paths;
}

function validateNativeArchive(backup: JournalBackup, entries: ZipEntry[]) {
  const archivePaths = new Set<string>();
  let expandedSize = 0;
  let compressedSize = 0;
  for (const entry of entries) {
    if (!safeArchivePath(entry.path) || entry.isEncrypted || archivePaths.has(entry.path)) throw new Error('invalid-backup');
    archivePaths.add(entry.path);
    if (!entry.isDirectory) {
      if (entry.size < 0 || entry.compressedSize < 0) throw new Error('invalid-backup');
      expandedSize += entry.size;
      compressedSize += entry.compressedSize;
    }
  }
  if (expandedSize > compressedSize * 200 + 64 * 1024 * 1024) throw new Error('invalid-backup');
  const files = new Map(entries.filter((entry) => !entry.isDirectory).map((entry) => [entry.path, entry.size]));
  for (const path of referencedArchivePaths(backup)) {
    if (!safeArchivePath(path) || !files.get(path)) throw new Error('missing-backup-media');
  }
}

async function readManifestFromArchive(uri: string) {
  const entries = await listContents(uri);
  const manifestEntry = entries.find((entry) => entry.path === 'backup.json' && !entry.isDirectory);
  if (!manifestEntry?.size || manifestEntry.size > 32 * 1024 * 1024) throw new Error('invalid-backup');
  const directory = temporaryRestoreDirectory();
  directory.create({ idempotent: true, intermediates: true });
  try {
    await unzip(uri, directory.uri, { entries: ['backup.json'] });
    const manifest = new File(directory, 'backup.json');
    if (!manifest.exists) throw new Error('invalid-backup');
    const backup = parseJournalBackup(await manifest.text());
    validateNativeArchive(backup, entries);
    return backup;
  } catch (error) {
    if (error instanceof Error && ['invalid-backup', 'unsupported-backup', 'missing-backup-media'].includes(error.message)) throw error;
    throw new Error('invalid-backup');
  } finally {
    if (directory.exists) directory.delete();
  }
}

export async function inspectZipBackupFile(uri: string) {
  return readManifestFromArchive(uri);
}

export async function storeRecoverySnapshotFile(sourceUri: string, maxSnapshots = 3) {
  const source = new File(sourceUri);
  if (!source.exists || !source.size) throw new Error('recovery-snapshot-missing');
  const directory = new Directory(Paths.document, 'recovery-snapshots');
  directory.create({ idempotent: true, intermediates: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const destination = new File(directory, `拾时恢复前快照-${stamp}-${Math.random().toString(36).slice(2, 6)}.zip`);
  try {
    await source.copy(destination);
    if (!destination.exists || destination.size !== source.size) throw new Error('recovery-snapshot-verification-failed');
    await inspectZipBackupFile(destination.uri);
    const snapshots = directory.list()
      .filter((item): item is File => item instanceof File && item.name.startsWith('拾时恢复前快照-') && item.name.endsWith('.zip'))
      .sort((left, right) => right.name.localeCompare(left.name));
    snapshots.slice(maxSnapshots).forEach((item) => item.delete());
    return { uri: destination.uri, size: destination.size, retained: Math.min(snapshots.length, maxSnapshots) };
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function materializeZipBackupFile(uri: string, onProgress?: ZipBackupProgress) {
  const backup = await readManifestFromArchive(uri);
  const directory = temporaryRestoreDirectory();
  const createdUris: string[] = [];
  directory.create({ idempotent: true, intermediates: true });
  const hasAvatar = Boolean(backup.appPreferences?.avatarLocalUri);
  const total = backup.images.length + (backup.followUpImages?.length ?? 0) + (backup.timeCapsuleImages?.length ?? 0) + (hasAvatar ? 1 : 0);
  let completed = 0;
  try {
    await unzip(uri, directory.uri);
    async function restoreItem<T extends BackupMedia>(item: T): Promise<T> {
      const copy = async (path: string | null | undefined) => {
        if (!path || !safeArchivePath(path)) return null;
        const source = new File(directory, path);
        if (!source.exists || !source.size) throw new Error('missing-backup-media');
        const restored = await persistJournalImage(source.uri, path);
        createdUris.push(restored);
        return restored;
      };
      const localUri = await copy(item.localUri);
      const pairedVideoLocalUri = await copy(item.pairedVideoLocalUri);
      const thumbnailLocalUri = await copy(item.thumbnailLocalUri);
      completed += 1;
      onProgress?.(completed, total);
      return { ...item, localUri: localUri ?? '', pairedVideoLocalUri, thumbnailLocalUri };
    }
    const images = [] as JournalBackup['images'];
    for (const item of backup.images) images.push(await restoreItem(item));
    const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
    for (const item of backup.followUpImages ?? []) followUpImages.push(await restoreItem(item));
    const timeCapsuleImages = [] as NonNullable<JournalBackup['timeCapsuleImages']>;
    for (const item of backup.timeCapsuleImages ?? []) timeCapsuleImages.push(await restoreItem(item));
    let appPreferences = backup.appPreferences;
    if (appPreferences?.avatarLocalUri) {
      const source = new File(directory, appPreferences.avatarLocalUri);
      if (!source.exists || !source.size) throw new Error('missing-backup-media');
      const avatarLocalUri = await persistJournalImage(source.uri, appPreferences.avatarLocalUri);
      createdUris.push(avatarLocalUri);
      completed += 1;
      onProgress?.(completed, total);
      appPreferences = { ...appPreferences, avatarLocalUri };
    }
    return { backup: { ...backup, images, followUpImages, timeCapsuleImages, appPreferences }, createdUris };
  } catch (error) {
    createdUris.forEach(deleteJournalImage);
    throw error;
  } finally {
    if (directory.exists) directory.delete();
  }
}

export async function materializeZipBackup(bytes: Uint8Array, onProgress?: ZipBackupProgress) {
  const { files, backup } = readZip(bytes);
  const createdUris: string[] = [];
  const hasAvatar = Boolean(backup.appPreferences?.avatarLocalUri);
  const total = backup.images.length + (backup.followUpImages?.length ?? 0) + (backup.timeCapsuleImages?.length ?? 0) + (hasAvatar ? 1 : 0);
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
    const timeCapsuleImages = [] as NonNullable<JournalBackup['timeCapsuleImages']>;
    for (const item of backup.timeCapsuleImages ?? []) timeCapsuleImages.push(await restoreItem(item));
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
    return { backup: { ...backup, images, followUpImages, timeCapsuleImages, appPreferences }, createdUris };
  } catch (error) {
    createdUris.forEach(deleteJournalImage);
    throw error;
  }
}
