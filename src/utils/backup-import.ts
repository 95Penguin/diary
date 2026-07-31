import type { JournalBackup } from '@/domain/journal';
import { parseJournalTemplateSettings } from './journal-templates.ts';

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
function isMetadataCatalog(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const catalog = value as NonNullable<JournalBackup['metadataCatalog']>;
  const categories = new Set(['家', '学校', '工作', '旅行', '常去', '想再去']);
  return Array.isArray(catalog.tags) && catalog.tags.every(isString)
    && Array.isArray(catalog.locations) && catalog.locations.every(isString)
    && Array.isArray(catalog.pinnedTags) && catalog.pinnedTags.every(isString)
    && Array.isArray(catalog.pinnedLocations) && catalog.pinnedLocations.every(isString)
    && Boolean(catalog.locationDetails) && typeof catalog.locationDetails === 'object'
    && Object.values(catalog.locationDetails).every((detail) =>
      Boolean(detail) && isString(detail.address)
      && (detail.latitude === null || (typeof detail.latitude === 'number' && Number.isFinite(detail.latitude)))
      && (detail.longitude === null || (typeof detail.longitude === 'number' && Number.isFinite(detail.longitude)))
      && (detail.category === undefined || detail.category === null || categories.has(detail.category))
      && (detail.favorite === undefined || typeof detail.favorite === 'boolean'));
}

function hasUniqueIds(items: { id: string }[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export function parseJournalBackup(contents: string): JournalBackup {
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('invalid-json'); }
  if (!value || typeof value !== 'object') throw new Error('invalid-backup');
  const backup = value as Partial<JournalBackup>;
  if (backup.format !== 'shishi-journal' || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].some((version) => backup.version === version)) throw new Error('unsupported-backup');
  if (!Array.isArray(backup.entries) || !Array.isArray(backup.followUps) || !Array.isArray(backup.tags) || !Array.isArray(backup.images)) throw new Error('invalid-backup');
  const validEntries = backup.entries.every((item) => item && isString(item.id) && isString(item.content) && isString(item.occurredAt) && isString(item.createdAt) && isString(item.updatedAt) && isNullableString(item.deletedAt));
  const validFollowUps = backup.followUps.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.content) && isString(item.createdAt) && isString(item.updatedAt) && isNullableString(item.deletedAt));
  const validTags = backup.tags.every((item) => item && isString(item.entryId) && isString(item.label) && typeof item.sortOrder === 'number');
  const validImages = backup.images.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.localUri) && typeof item.width === 'number' && Number.isFinite(item.width) && typeof item.height === 'number' && Number.isFinite(item.height) && typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) && isString(item.createdAt) && isMediaType(item.mediaType) && isOptionalNullableString(item.pairedVideoLocalUri) && isOptionalNullableNumber(item.duration) && isOptionalNullableString(item.thumbnailLocalUri) && isOptionalNullableString(item.dataBase64) && isOptionalNullableString(item.mimeType) && isOptionalNullableString(item.pairedVideoDataBase64) && isOptionalNullableString(item.pairedVideoMimeType) && isOptionalNullableString(item.thumbnailDataBase64) && isOptionalNullableString(item.thumbnailMimeType));
  const validFollowUpImages = backup.followUpImages === undefined || (Array.isArray(backup.followUpImages) && backup.followUpImages.every((item) => item && isString(item.id) && isString(item.followUpId) && isString(item.localUri) && typeof item.width === 'number' && Number.isFinite(item.width) && typeof item.height === 'number' && Number.isFinite(item.height) && typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) && isString(item.createdAt) && isMediaType(item.mediaType) && isOptionalNullableString(item.pairedVideoLocalUri) && isOptionalNullableNumber(item.duration) && isOptionalNullableString(item.thumbnailLocalUri) && isOptionalNullableString(item.dataBase64) && isOptionalNullableString(item.mimeType) && isOptionalNullableString(item.pairedVideoDataBase64) && isOptionalNullableString(item.pairedVideoMimeType) && isOptionalNullableString(item.thumbnailDataBase64) && isOptionalNullableString(item.thumbnailMimeType)));
  const validVersions = backup.versions === undefined || (Array.isArray(backup.versions) && backup.versions.every((item) => item && isString(item.id) && isString(item.entryId) && isString(item.content) && isString(item.occurredAt) && isString(item.createdAt) && Array.isArray(item.tags)));
  const validSuppressed = backup.suppressedMemoryEntryIds === undefined || (Array.isArray(backup.suppressedMemoryEntryIds) && backup.suppressedMemoryEntryIds.every(isString));
  const validMetadataCatalog = isMetadataCatalog(backup.metadataCatalog);
  const validJournalTemplates = backup.journalTemplates === undefined || (() => {
    const parsed = parseJournalTemplateSettings(backup.journalTemplates);
    const source = backup.journalTemplates;
    return Boolean(source) && typeof source === 'object'
      && Object.keys(parsed.systemOverrides).length === Object.keys(source.systemOverrides ?? {}).length
      && parsed.custom.length === (Array.isArray(source.custom) ? source.custom.length : -1);
  })();
  const preferences = backup.appPreferences;
  const validAppPreferences = preferences === undefined || (
    isString(preferences.nickname)
    && isString(preferences.signature)
    && isNullableString(preferences.avatarLocalUri)
    && isOptionalNullableString(preferences.avatarDataBase64)
    && isOptionalNullableString(preferences.avatarMimeType)
    && ['system', 'light', 'dark'].includes(preferences.themeMode)
    && ['verySmall', 'small', 'standard', 'large', 'veryLarge'].includes(preferences.fontSize)
    && ['cream', 'white', 'warm', 'green', 'blue', 'pink', 'red', 'lavender', 'gray', 'night'].includes(preferences.readingTheme)
    && ['serif', 'sans', 'light', 'mono', 'system'].includes(preferences.readingFont)
    && typeof preferences.appLockEnabled === 'boolean'
    && [0, 60, 300].includes(preferences.appLockDelaySeconds)
    && [0, 7, 14, 30].includes(preferences.backupReminderDays)
    && (preferences.locationPrivacyMode === undefined || ['precise', 'approximate', 'nameOnly', 'ask'].includes(preferences.locationPrivacyMode))
    && (preferences.exportLocationMode === undefined || ['include', 'hidden'].includes(preferences.exportLocationMode))
  );
  if (!validEntries || !validFollowUps || !validTags || !validImages || !validFollowUpImages || !validVersions || !validSuppressed || !validMetadataCatalog || !validJournalTemplates || !validAppPreferences) throw new Error('invalid-backup');

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
