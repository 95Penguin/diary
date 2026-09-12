export function exportBackupFile(contents: string, filename: string): Promise<void>;
export function exportBackupBytes(contents: Uint8Array, filename: string, mimeType?: string): Promise<void>;
export function exportBackupUri(uri: string, filename: string, mimeType?: string): Promise<void>;
