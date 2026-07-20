export type FollowUp = { id: string; entryId: string; content: string; createdAt: string; updatedAt: string };
export type EntryImage = { id: string; entryId: string; uri: string; width: number; height: number; sortOrder: number };
export type Entry = {
  id: string; content: string; occurredAt: string; createdAt: string; updatedAt: string; followUps: FollowUp[]; images: EntryImage[]; tags: string[];
};
export type DeletedEntry = Entry & { deletedAt: string };
export type JournalStats = { entries: number; followUps: number; images: number; deleted: number };
export type JournalBackup = {
  format: 'shishi-journal'; version: 1; exportedAt: string; timezone: string;
  entries: { id: string; content: string; occurredAt: string; createdAt: string; updatedAt: string; deletedAt: string | null }[];
  followUps: { id: string; entryId: string; content: string; createdAt: string; updatedAt: string; deletedAt: string | null }[];
  images: { id: string; entryId: string; localUri: string; width: number; height: number; sortOrder: number; createdAt: string }[];
  tags: { entryId: string; label: string; sortOrder: number }[];
};
export type ImportResult = { createdEntries: number; updatedEntries: number; createdFollowUps: number; updatedFollowUps: number; tags: number };
export type SearchMatchSource = 'content' | 'followUp' | 'tag';
export type SearchResult = { entry: Entry; sources: SearchMatchSource[]; matchingFollowUp?: string; matchingTag?: string };
export type Draft = { content: string; occurredAt: string; updatedAt: string; tags?: string[] };
export type EntryInput = { content: string; occurredAt: string };
