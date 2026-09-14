import type { WebDavBackupFile, WebDavConfig, WebDavUploadResult } from './webdav';

export async function testWebDavConnection(_config: WebDavConfig): Promise<void> {
  throw new Error('webdav-native-only');
}

export async function uploadWebDavBackup(_config: WebDavConfig, _sourceUri: string, _filename: string, _onProgress?: (sent: number, total: number) => void): Promise<WebDavUploadResult> {
  throw new Error('webdav-native-only');
}
export async function listWebDavBackups(_config: WebDavConfig): Promise<WebDavBackupFile[]> { throw new Error('webdav-native-only'); }
export async function downloadWebDavBackup(_config: WebDavConfig, _filename: string, _segmented?: boolean) { throw new Error('webdav-native-only'); }
export async function deleteWebDavBackup(_config: WebDavConfig, _filename: string, _segmented?: boolean) { throw new Error('webdav-native-only'); }
