import type { JournalBackup } from '@/domain/journal';

function isString(value: unknown): value is string { return typeof value === 'string'; }
function isNullableString(value: unknown): value is string | null { return value === null || isString(value); }

export function parseJournalBackup(contents: string): JournalBackup {
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('invalid-json'); }
  if (!value || typeof value !== 'object') throw new Error('invalid-backup');
  const backup = value as Partial<JournalBackup>;
  if (backup.format !== 'shishi-journal' || backup.version !== 1) throw new Error('unsupported-backup');
  if (!Array.isArray(backup.entries) || !Array.isArray(backup.followUps) || !Array.isArray(backup.tags) || !Array.isArray(backup.images)) throw new Error('invalid-backup');
  const validEntries = backup.entries.every((item) => item && isString(item.id) && isString(item.content) && isString(item.occurredAt) && isString(item.createdAt) && isString(item.updatedAt) && isNullableString(item.deletedAt));
  const validFollowUps = backup.followUps.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.content) && isString(item.createdAt) && isString(item.updatedAt) && isNullableString(item.deletedAt));
  const validTags = backup.tags.every((item) => item && isString(item.entryId) && isString(item.label) && typeof item.sortOrder === 'number');
  if (!validEntries || !validFollowUps || !validTags) throw new Error('invalid-backup');
  return backup as JournalBackup;
}
