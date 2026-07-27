import type { JournalBackup } from '@/domain/journal';

function isString(value: unknown): value is string { return typeof value === 'string'; }
function isNullableString(value: unknown): value is string | null { return value === null || isString(value); }
function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}
function isOptionalNullableNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
}
function isMediaType(value: unknown) {
  return value === undefined || value === 'image' || value === 'video' || value === 'livePhoto';
}

function hasUniqueIds(items: { id: string }[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export function parseJournalBackup(contents: string): JournalBackup {
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('invalid-json'); }
  if (!value || typeof value !== 'object') throw new Error('invalid-backup');
  const backup = value as Partial<JournalBackup>;
  if (backup.format !== 'shishi-journal' || ![1, 2, 3, 4, 5, 6, 7, 8, 9].some((version) => backup.version === version)) throw new Error('unsupported-backup');
  if (!Array.isArray(backup.entries) || !Array.isArray(backup.followUps) || !Array.isArray(backup.tags) || !Array.isArray(backup.images)) throw new Error('invalid-backup');
  const validEntries = backup.entries.every((item) => item && isString(item.id) && isString(item.content) && isString(item.occurredAt) && isString(item.createdAt) && isString(item.updatedAt) && isNullableString(item.deletedAt));
  const validFollowUps = backup.followUps.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.content) && isString(item.createdAt) && isString(item.updatedAt) && isNullableString(item.deletedAt));
  const validTags = backup.tags.every((item) => item && isString(item.entryId) && isString(item.label) && typeof item.sortOrder === 'number');
  const validImages = backup.images.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.localUri) && typeof item.width === 'number' && Number.isFinite(item.width) && typeof item.height === 'number' && Number.isFinite(item.height) && typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) && isString(item.createdAt) && isMediaType(item.mediaType) && isOptionalNullableString(item.pairedVideoLocalUri) && isOptionalNullableNumber(item.duration) && isOptionalNullableString(item.thumbnailLocalUri) && isOptionalNullableString(item.dataBase64) && isOptionalNullableString(item.mimeType) && isOptionalNullableString(item.pairedVideoDataBase64) && isOptionalNullableString(item.pairedVideoMimeType) && isOptionalNullableString(item.thumbnailDataBase64) && isOptionalNullableString(item.thumbnailMimeType));
  const validFollowUpImages = backup.followUpImages === undefined || (Array.isArray(backup.followUpImages) && backup.followUpImages.every((item) => item && isString(item.id) && isString(item.followUpId) && isString(item.localUri) && typeof item.width === 'number' && Number.isFinite(item.width) && typeof item.height === 'number' && Number.isFinite(item.height) && typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) && isString(item.createdAt) && isMediaType(item.mediaType) && isOptionalNullableString(item.pairedVideoLocalUri) && isOptionalNullableNumber(item.duration) && isOptionalNullableString(item.thumbnailLocalUri) && isOptionalNullableString(item.dataBase64) && isOptionalNullableString(item.mimeType) && isOptionalNullableString(item.pairedVideoDataBase64) && isOptionalNullableString(item.pairedVideoMimeType) && isOptionalNullableString(item.thumbnailDataBase64) && isOptionalNullableString(item.thumbnailMimeType)));
  const validVersions = backup.versions === undefined || (Array.isArray(backup.versions) && backup.versions.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.content) && isString(item.occurredAt) && isString(item.createdAt) && Array.isArray(item.tags)));
  const validSuppressed = backup.suppressedMemoryEntryIds === undefined || (Array.isArray(backup.suppressedMemoryEntryIds) && backup.suppressedMemoryEntryIds.every(isString));
  if (!validEntries || !validFollowUps || !validTags || !validImages || !validFollowUpImages || !validVersions || !validSuppressed) throw new Error('invalid-backup');

  const entries = backup.entries as JournalBackup['entries'];
  const followUps = backup.followUps as JournalBackup['followUps'];
  const images = backup.images as JournalBackup['images'];
  const followUpImages = (backup.followUpImages ?? []) as NonNullable<JournalBackup['followUpImages']>;
  const versions = (backup.versions ?? []) as NonNullable<JournalBackup['versions']>;
  if (!hasUniqueIds(entries) || !hasUniqueIds(followUps) || !hasUniqueIds(images) || !hasUniqueIds(followUpImages) || !hasUniqueIds(versions)) {
    throw new Error('invalid-backup');
  }
  const entryIds = new Set(entries.map((item) => item.id));
  const followUpIds = new Set(followUps.map((item) => item.id));
  if (
    followUps.some((item) => !entryIds.has(item.entryId))
    || images.some((item) => !entryIds.has(item.entryId))
    || followUpImages.some((item) => !followUpIds.has(item.followUpId))
    || (backup.tags as JournalBackup['tags']).some((item) => !entryIds.has(item.entryId))
    || versions.some((item) => !entryIds.has(item.entryId))
    || (backup.suppressedMemoryEntryIds ?? []).some((id) => !entryIds.has(id))
  ) {
    throw new Error('invalid-backup');
  }
  return backup as JournalBackup;
}
