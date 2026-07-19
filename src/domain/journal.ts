export type FollowUp = { id: string; entryId: string; content: string; createdAt: string; updatedAt: string };
export type EntryImage = { id: string; entryId: string; uri: string; width: number; height: number; sortOrder: number };
export type Entry = {
  id: string; content: string; occurredAt: string; createdAt: string; updatedAt: string; followUps: FollowUp[]; images: EntryImage[];
};
export type Draft = { content: string; occurredAt: string; updatedAt: string };
export type EntryInput = { content: string; occurredAt: string };
