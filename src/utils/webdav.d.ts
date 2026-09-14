export type WebDavConfig = { serverUrl: string; username: string; password: string; directory: string };
export type WebDavUploadResult = { filename: string; size: number };
export type WebDavBackupFile = { filename: string; size: number; modifiedAt: string | null; segmented?: boolean };
export function testWebDavConnection(config: WebDavConfig): Promise<void>;
export function uploadWebDavBackup(config: WebDavConfig, sourceUri: string, filename: string, onProgress?: (sent: number, total: number) => void): Promise<WebDavUploadResult>;
export function listWebDavBackups(config: WebDavConfig): Promise<WebDavBackupFile[]>;
export function downloadWebDavBackup(config: WebDavConfig, filename: string, segmented?: boolean): Promise<{ uri: string; size: number }>;
export function deleteWebDavBackup(config: WebDavConfig, filename: string, segmented?: boolean): Promise<void>;
