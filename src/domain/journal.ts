import type { JournalTemplateSettings } from '@/utils/journal-templates';

export type JournalMediaType = 'image' | 'video' | 'livePhoto';
export type FollowUpImage = { id: string; followUpId: string; uri: string; width: number; height: number; sortOrder: number; mediaType: JournalMediaType; pairedVideoUri: string | null; duration: number | null; thumbnailUri: string | null };
export type FollowUp = { id: string; entryId: string; content: string; createdAt: string; updatedAt: string; images: FollowUpImage[] };
export type EntryImage = { id: string; entryId: string; uri: string; width: number; height: number; sortOrder: number; mediaType: JournalMediaType; pairedVideoUri: string | null; duration: number | null; thumbnailUri: string | null };
export type LibraryMedia = {
  id: string; entryId: string; source: 'entry' | 'followUp'; sourceId: string;
  uri: string; width: number; height: number; sortOrder: number; mediaType: JournalMediaType;
  pairedVideoUri: string | null; duration: number | null; thumbnailUri: string | null;
  occurredAt: string; attachedAt: string; entryContent: string;
};
export type Entry = {
  id: string; content: string; occurredAt: string; createdAt: string; updatedAt: string;
  mood: string | null; weather: string | null; favoritedAt: string | null; locationName: string | null; latitude: number | null; longitude: number | null;
  followUps: FollowUp[]; images: EntryImage[]; tags: string[];
};
export type DeletedEntry = Entry & { deletedAt: string };
export type EntryVersion = {
  id: string; entryId: string; content: string; occurredAt: string; mood: string | null; weather: string | null;
  locationName: string | null; latitude: number | null; longitude: number | null; tags: string[]; createdAt: string;
};
export type JournalStats = { entries: number; followUps: number; images: number; deleted: number };
export type FootprintEntry = { id: string; content: string; occurredAt: string; locationName: string; latitude: number; longitude: number };
export type PendingFootprintEntry = Pick<FootprintEntry, 'id' | 'content' | 'occurredAt' | 'locationName'>;
export type PendingLocationGroup = { locationName: string; count: number };
export type JournalBackup = {
  format: 'shishi-journal'; version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13; exportedAt: string; timezone: string;
  entries: { id: string; content: string; occurredAt: string; createdAt: string; updatedAt: string; deletedAt: string | null; mood?: string | null; weather?: string | null; favoritedAt?: string | null; locationName?: string | null; latitude?: number | null; longitude?: number | null }[];
  followUps: { id: string; entryId: string; content: string; createdAt: string; updatedAt: string; deletedAt: string | null }[];
  images: { id: string; entryId: string; localUri: string; width: number; height: number; sortOrder: number; createdAt: string; mediaType?: JournalMediaType; pairedVideoLocalUri?: string | null; duration?: number | null; thumbnailLocalUri?: string | null; dataBase64?: string | null; mimeType?: string | null; pairedVideoDataBase64?: string | null; pairedVideoMimeType?: string | null; thumbnailDataBase64?: string | null; thumbnailMimeType?: string | null }[];
  followUpImages?: { id: string; followUpId: string; localUri: string; width: number; height: number; sortOrder: number; createdAt: string; mediaType?: JournalMediaType; pairedVideoLocalUri?: string | null; duration?: number | null; thumbnailLocalUri?: string | null; dataBase64?: string | null; mimeType?: string | null; pairedVideoDataBase64?: string | null; pairedVideoMimeType?: string | null; thumbnailDataBase64?: string | null; thumbnailMimeType?: string | null }[];
  timeCapsules?: { id: string; title: string; content: string; openAt: string; openedAt: string | null; createdAt: string; updatedAt: string; deletedAt: string | null; notificationEnabled: boolean }[];
  timeCapsuleReplies?: { id: string; capsuleId: string; content: string; createdAt: string; updatedAt: string }[];
  timeCapsuleImages?: { id: string; capsuleId: string; localUri: string; width: number; height: number; sortOrder: number; createdAt: string; mediaType?: JournalMediaType; pairedVideoLocalUri?: string | null; duration?: number | null; thumbnailLocalUri?: string | null; dataBase64?: string | null; mimeType?: string | null; pairedVideoDataBase64?: string | null; pairedVideoMimeType?: string | null; thumbnailDataBase64?: string | null; thumbnailMimeType?: string | null }[];
  tags: { entryId: string; label: string; sortOrder: number }[];
  versions?: { id: string; entryId: string; content: string; occurredAt: string; mood: string | null; weather: string | null; locationName: string | null; latitude: number | null; longitude: number | null; tags: string[]; createdAt: string }[];
  suppressedMemoryEntryIds?: string[];
  journalTemplates?: JournalTemplateSettings;
  metadataCatalog?: {
    tags: string[];
    locations: string[];
    pinnedTags: string[];
    pinnedLocations: string[];
    locationDetails: Record<string, {
      address: string;
      latitude: number | null;
      longitude: number | null;
      category?: '家' | '学校' | '工作' | '旅行' | '常去' | '想再去' | null;
      favorite?: boolean;
    }>;
  };
  appPreferences?: {
    nickname: string;
    signature: string;
    avatarLocalUri: string | null;
    avatarDataBase64?: string | null;
    avatarMimeType?: string | null;
    themeMode: 'system' | 'light' | 'dark';
    fontSize: 'verySmall' | 'small' | 'standard' | 'large' | 'veryLarge';
    readingTheme: 'cream' | 'white' | 'warm' | 'green' | 'cyan' | 'blue' | 'pink' | 'red' | 'lavender' | 'gray' | 'night';
    readingFont: 'serif' | 'sans' | 'light' | 'mono' | 'system';
    readingComfort?: 'compact' | 'comfortable' | 'spacious';
    appLockEnabled: boolean;
    appLockDelaySeconds: 0 | 60 | 300;
    backupReminderDays: 0 | 7 | 14 | 30;
    locationPrivacyMode?: 'precise' | 'approximate' | 'nameOnly' | 'ask';
    exportLocationMode?: 'include' | 'hidden';
  };
};
export type ImportResult = { createdEntries: number; updatedEntries: number; createdFollowUps: number; updatedFollowUps: number; tags: number };
export type SearchMatchSource = 'content' | 'followUp' | 'tag';
export type SearchResult = { entry: Entry; sources: SearchMatchSource[]; matchingFollowUp?: string; matchingTag?: string };
export type DraftImage = { uri: string; width: number; height: number; mediaType?: JournalMediaType; pairedVideoUri?: string | null; duration?: number | null; thumbnailUri?: string | null };
export type Draft = { id: string; content: string; occurredAt: string; createdAt: string; updatedAt: string; tags: string[]; mood: string | null; weather: string | null; images: DraftImage[]; locationName: string | null; latitude: number | null; longitude: number | null };
export type EntryInput = { content: string; occurredAt: string; mood?: string | null; weather?: string | null; locationName?: string | null; latitude?: number | null; longitude?: number | null };
