import type { JournalBackup } from '@/domain/journal';

function isString(value: unknown): value is string { return typeof value === 'string'; }
function isNullableString(value: unknown): value is string | null { return value === null || isString(value); }

export function parseJournalBackup(contents: string): JournalBackup {
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('invalid-json'); }
  if (!value || typeof value !== 'object') throw new Error('invalid-backup');
  const backup = value as Partial<JournalBackup>;
  if (backup.format !== 'shishi-journal' || ![1, 2, 3, 4, 5, 6, 7, 8].some((version) => backup.version === version)) throw new Error('unsupported-backup');
  if (!Array.isArray(backup.entries) || !Array.isArray(backup.followUps) || !Array.isArray(backup.tags) || !Array.isArray(backup.images)) throw new Error('invalid-backup');
  const validEntries = backup.entries.every((item) => item && isString(item.id) && isString(item.content) && isString(item.occurredAt) && isString(item.createdAt) && isString(item.updatedAt) && isNullableString(item.deletedAt));
  const validFollowUps = backup.followUps.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.content) && isString(item.createdAt) && isString(item.updatedAt) && isNullableString(item.deletedAt));
  const validTags = backup.tags.every((item) => item && isString(item.entryId) && isString(item.label) && typeof item.sortOrder === 'number');
  const validImages = backup.images.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.localUri) && typeof item.width === 'number' && typeof item.height === 'number' && typeof item.sortOrder === 'number' && isString(item.createdAt) && (item.dataBase64 === undefined || isNullableString(item.dataBase64)) && (item.mimeType === undefined || isNullableString(item.mimeType)));
  const validFollowUpImages = backup.followUpImages === undefined || (Array.isArray(backup.followUpImages) && backup.followUpImages.every((item) => item && isString(item.id) && isString(item.followUpId) && isString(item.localUri) && typeof item.width === 'number' && typeof item.height === 'number' && typeof item.sortOrder === 'number' && isString(item.createdAt) && (item.dataBase64 === undefined || isNullableString(item.dataBase64)) && (item.mimeType === undefined || isNullableString(item.mimeType))));
  const validVersions = backup.versions === undefined || (Array.isArray(backup.versions) && backup.versions.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.content) && isString(item.occurredAt) && isString(item.createdAt) && Array.isArray(item.tags)));
  const validSuppressed = backup.suppressedMemoryEntryIds === undefined || (Array.isArray(backup.suppressedMemoryEntryIds) && backup.suppressedMemoryEntryIds.every(isString));
  if (!validEntries || !validFollowUps || !validTags || !validImages || !validFollowUpImages || !validVersions || !validSuppressed) throw new Error('invalid-backup');
  return backup as JournalBackup;
}
