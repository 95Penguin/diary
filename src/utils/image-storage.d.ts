export function persistJournalImage(sourceUri: string, suggestedName?: string | null): Promise<string>;
export function persistJournalImageBase64(dataBase64: string, extension?: string): Promise<string>;
export function deleteJournalImage(uri: string): void;
