export type FollowUp = { id: string; entryId: string; content: string; createdAt: string; updatedAt: string };
export type EntryImage = { id: string; entryId: string; uri: string; width: number; height: number; sortOrder: number };
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
export type JournalBackup = {
  format: 'shishi-journal'; version: 1 | 2 | 3 | 4 | 5 | 6; exportedAt: string; timezone: string;
  entries: { id: string; content: string; occurredAt: string; createdAt: string; updatedAt: string; deletedAt: string | null; mood?: string | null; weather?: string | null; favoritedAt?: string | null; locationName?: string | null; latitude?: number | null; longitude?: number | null }[];
  followUps: { id: string; entryId: string; content: string; createdAt: string; updatedAt: string; deletedAt: string | null }[];
  images: { id: string; entryId: string; localUri: string; width: number; height: number; sortOrder: number; createdAt: string; dataBase64?: string | null; mimeType?: string | null }[];
  tags: { entryId: string; label: string; sortOrder: number }[];
  versions?: { id: string; entryId: string; content: string; occurredAt: string; mood: string | null; weather: string | null; locationName: string | null; latitude: number | null; longitude: number | null; tags: string[]; createdAt: string }[];
  suppressedMemoryEntryIds?: string[];
};
export type ImportResult = { createdEntries: number; updatedEntries: number; createdFollowUps: number; updatedFollowUps: number; tags: number };
export type SearchMatchSource = 'content' | 'followUp' | 'tag';
export type SearchResult = { entry: Entry; sources: SearchMatchSource[]; matchingFollowUp?: string; matchingTag?: string };
export type DraftImage = { uri: string; width: number; height: number };
export type Draft = { id: string; content: string; occurredAt: string; createdAt: string; updatedAt: string; tags: string[]; mood: string | null; weather: string | null; images: DraftImage[]; locationName: string | null; latitude: number | null; longitude: number | null };
export type EntryInput = { content: string; occurredAt: string; mood?: string | null; weather?: string | null; locationName?: string | null; latitude?: number | null; longitude?: number | null };
