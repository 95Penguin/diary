import * as FileSystem from 'expo-file-system/legacy';
import { File, FileMode, Paths, UploadType } from 'expo-file-system';

import type { WebDavBackupFile, WebDavConfig, WebDavUploadResult } from './webdav';

const SEGMENT_SIZE = 32 * 1024 * 1024;
const COPY_BUFFER_SIZE = 2 * 1024 * 1024;
const SEGMENT_UPLOAD_CONCURRENCY = 2;
type RawWebDavFile = { filename: string; size: number; modifiedAt: string | null };
type SegmentedManifest = { version: 1; filename: string; totalSize: number; parts: { filename: string; size: number }[] };

function normalizeConfig(config: WebDavConfig) {
  const serverUrl = config.serverUrl.trim();
  let url: URL;
  try { url = new URL(serverUrl); } catch { throw new Error('webdav-invalid-url'); }
  if (url.protocol !== 'https:') throw new Error('webdav-https-required');
  if (!config.username.trim() || !config.password) throw new Error('webdav-credentials-required');
  const directory = config.directory.trim().replace(/^\/+|\/+$/g, '') || '拾时备份';
  url.hash = '';
  url.search = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return { ...config, serverUrl: url.toString(), username: config.username.trim(), directory };
}

function encodeBasic(value: string) {
  const bytes = new TextEncoder().encode(value);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]; const second = bytes[index + 1]; const third = bytes[index + 2];
    result += chars[first >> 2];
    result += chars[((first & 3) << 4) | ((second ?? 0) >> 4)];
    result += second === undefined ? '=' : chars[((second & 15) << 2) | ((third ?? 0) >> 6)];
    result += third === undefined ? '=' : chars[third & 63];
  }
  return result;
}

function headers(config: WebDavConfig) {
  return { Authorization: `Basic ${encodeBasic(`${config.username}:${config.password}`)}` };
}

function childUrl(base: string, ...parts: string[]) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${parts.map(encodeURIComponent).join('/')}`;
  return url.toString();
}

async function request(url: string, init: RequestInit, accepted: number[]) {
  let response: Response;
  try { response = await fetch(url, init); } catch { throw new Error('webdav-network-error'); }
  if (!accepted.includes(response.status)) {
    if (response.status === 401) throw new Error('webdav-auth-failed');
    if (response.status === 403) throw new Error('webdav-forbidden');
    if (response.status === 507) throw new Error('webdav-storage-full');
    throw new Error(`webdav-http-${response.status}`);
  }
  return response;
}

async function ensureDirectory(config: ReturnType<typeof normalizeConfig>) {
  let target = config.serverUrl;
  for (const part of config.directory.split('/').filter(Boolean)) {
    target = childUrl(`${target}/`, part);
    const probe = await request(target, { method: 'PROPFIND', headers: { ...headers(config), Depth: '0' } }, [200, 207, 404]);
    if (probe.status === 404) {
      const created = await request(target, { method: 'MKCOL', headers: headers(config) }, [201, 405]);
      // Some servers return 405 when another client created the directory in the
      // meantime. Do not treat every 405 as success: verify that it now exists.
      if (created.status === 405) {
        await request(target, { method: 'PROPFIND', headers: { ...headers(config), Depth: '0' } }, [200, 207]);
      }
    }
  }
  return target;
}

function ownedBackupFilename(value: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  decoded = decoded.split('/').filter(Boolean).at(-1) ?? '';
  return /^拾时云备份-\d{8}-\d{6}(?:-\d{3})?\.zip$/u.test(decoded) ? decoded : null;
}

function decodedFilename(value: string) {
  try { return decodeURIComponent(value).split('/').filter(Boolean).at(-1) ?? ''; }
  catch { return ''; }
}

function xmlValue(block: string, name: string) {
  return block.match(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'i'))?.[1]?.trim() ?? '';
}

function decodeXml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function listRawFiles(config: ReturnType<typeof normalizeConfig>) {
  const directoryUrl = await ensureDirectory(config);
  const response = await request(directoryUrl, {
    method: 'PROPFIND',
    headers: { ...headers(config), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>',
  }, [207]);
  const blocks = (await response.text()).match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];
  return blocks.flatMap<RawWebDavFile>((block) => {
    if (/<(?:[\w-]+:)?collection\b/i.test(block)) return [];
    const filename = decodedFilename(decodeXml(xmlValue(block, 'href')));
    if (!filename) return [];
    const size = Number(xmlValue(block, 'getcontentlength'));
    const modified = xmlValue(block, 'getlastmodified');
    const modifiedDate = modified ? new Date(modified) : null;
    return [{ filename, size: Number.isFinite(size) ? size : 0, modifiedAt: modifiedDate && !Number.isNaN(modifiedDate.getTime()) ? modifiedDate.toISOString() : null }];
  });
}

export async function testWebDavConnection(input: WebDavConfig) {
  const config = normalizeConfig(input);
  await request(config.serverUrl, { method: 'PROPFIND', headers: { ...headers(config), Depth: '0' } }, [200, 207]);
  await ensureDirectory(config);
}

async function uploadSingleWebDavFile(input: WebDavConfig, sourceUri: string, filename: string, onProgress?: (sent: number, total: number) => void): Promise<WebDavUploadResult> {
  const config = normalizeConfig(input);
  const source = new File(sourceUri);
  if (!source.exists || !source.size) throw new Error('webdav-source-missing');
  const directoryUrl = await ensureDirectory(config);
  const safeFilename = filename.replace(/[\\/:*?"<>|]/g, '-');
  const temporaryUrl = childUrl(`${directoryUrl}/`, `${safeFilename}.uploading`);
  const finalUrl = childUrl(`${directoryUrl}/`, safeFilename);
  let upload: { status: number } | null = null;
  let uploadError: unknown;
  for (let attempt = 0; attempt < 2 && !upload; attempt += 1) {
    try {
      const task = source.createUploadTask(temporaryUrl, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: 'application/zip',
        headers: headers(config),
        onProgress: ({ bytesSent, totalBytes }) => onProgress?.(bytesSent, totalBytes || source.size),
      });
      try { upload = await task.uploadAsync(); }
      finally { task.release(); }
    } catch (error) {
      uploadError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  if (!upload) {
    void fetch(temporaryUrl, { method: 'DELETE', headers: headers(config) }).catch(() => undefined);
    const detail = uploadError instanceof Error ? uploadError.message : String(uploadError ?? 'unknown');
    throw new Error(`webdav-upload-failed: ${detail}`);
  }
  if (upload.status < 200 || upload.status >= 300) {
    void fetch(temporaryUrl, { method: 'DELETE', headers: headers(config) }).catch(() => undefined);
    if (upload.status === 401) throw new Error('webdav-auth-failed');
    if (upload.status === 507) throw new Error('webdav-storage-full');
    throw new Error(`webdav-http-${upload.status}`);
  }
  try {
    await request(temporaryUrl, {
      method: 'MOVE',
      headers: { ...headers(config), Destination: finalUrl, Overwrite: 'F' },
    }, [201, 204]);
    const verified = await request(finalUrl, { method: 'PROPFIND', headers: { ...headers(config), Depth: '0' } }, [200, 207]);
    const remoteSize = Number(xmlValue(await verified.text(), 'getcontentlength'));
    if (!Number.isFinite(remoteSize) || remoteSize <= 0 || remoteSize !== source.size) throw new Error('webdav-size-mismatch');
    return { filename: safeFilename, size: source.size };
  } catch (error) {
    void fetch(temporaryUrl, { method: 'DELETE', headers: headers(config) }).catch(() => undefined);
    if (error instanceof Error && error.message === 'webdav-size-mismatch') void fetch(finalUrl, { method: 'DELETE', headers: headers(config) }).catch(() => undefined);
    throw error;
  }
}

export async function uploadWebDavBackup(input: WebDavConfig, sourceUri: string, filename: string, onProgress?: (sent: number, total: number) => void): Promise<WebDavUploadResult> {
  const source = new File(sourceUri);
  if (!source.exists || !source.size) throw new Error('webdav-source-missing');
  if (source.size <= SEGMENT_SIZE) return uploadSingleWebDavFile(input, sourceUri, filename, onProgress);

  const safeFilename = filename.replace(/[\\/:*?"<>|]/g, '-');
  const sourceHandle = source.open(FileMode.ReadOnly);
  const parts: SegmentedManifest['parts'] = [];
  const uploadedNames: string[] = [];
  let completedBytes = 0;
  try {
    let partIndex = 0;
    while (completedBytes < source.size) {
      const batch: { filename: string; size: number; file: File }[] = [];
      for (let slot = 0; slot < SEGMENT_UPLOAD_CONCURRENCY && completedBytes + batch.reduce((total, part) => total + part.size, 0) < source.size; slot += 1) {
        const preparedBytes = batch.reduce((total, part) => total + part.size, 0);
        const partSize = Math.min(SEGMENT_SIZE, source.size - completedBytes - preparedBytes);
        const partName = `${safeFilename}.part${String(partIndex + 1).padStart(3, '0')}`;
        const partFile = new File(Paths.cache, `webdav-${Date.now()}-${partIndex}.part`);
        partFile.create({ overwrite: true });
        const partHandle = partFile.open(FileMode.WriteOnly);
        try {
          let written = 0;
          while (written < partSize) {
            const bytes = sourceHandle.readBytes(Math.min(COPY_BUFFER_SIZE, partSize - written));
            if (!bytes.length) throw new Error('webdav-source-read-failed');
            partHandle.writeBytes(bytes);
            written += bytes.length;
          }
        } finally { partHandle.close(); }
        batch.push({ filename: partName, size: partSize, file: partFile });
        partIndex += 1;
      }

      const batchBase = completedBytes;
      const sentByPart = batch.map(() => 0);
      try {
        const errors = await Promise.all(batch.map(async (part, index) => {
          try {
            await uploadSingleWebDavFile(input, part.file.uri, part.filename, (sent) => {
              sentByPart[index] = sent;
              onProgress?.(batchBase + sentByPart.reduce((total, value) => total + value, 0), source.size);
            });
            uploadedNames.push(part.filename);
            return null;
          } catch (error) { return error; }
        }));
        const failed = errors.find((error) => error !== null);
        if (failed) throw failed;
        parts.push(...batch.map((part) => ({ filename: part.filename, size: part.size })));
        completedBytes += batch.reduce((total, part) => total + part.size, 0);
        onProgress?.(completedBytes, source.size);
      } finally {
        batch.forEach((part) => { if (part.file.exists) part.file.delete(); });
      }
    }

    const manifest: SegmentedManifest = { version: 1, filename: safeFilename, totalSize: source.size, parts };
    const manifestFile = new File(Paths.cache, `webdav-${Date.now()}.parts.json`);
    manifestFile.create({ overwrite: true });
    manifestFile.write(JSON.stringify(manifest));
    try {
      await uploadSingleWebDavFile(input, manifestFile.uri, `${safeFilename}.parts.json`);
      uploadedNames.push(`${safeFilename}.parts.json`);
    } finally { if (manifestFile.exists) manifestFile.delete(); }
    return { filename: safeFilename, size: source.size };
  } catch (error) {
    const config = normalizeConfig(input);
    const directoryUrl = await ensureDirectory(config).catch(() => null);
    if (directoryUrl) {
      await Promise.all(uploadedNames.map((name) => fetch(childUrl(`${directoryUrl}/`, name), { method: 'DELETE', headers: headers(config) }).catch(() => undefined)));
    }
    throw error;
  } finally { sourceHandle.close(); }
}

export async function listWebDavBackups(input: WebDavConfig): Promise<WebDavBackupFile[]> {
  const config = normalizeConfig(input);
  const files = await listRawFiles(config);
  const direct = files.flatMap<WebDavBackupFile>((file) => ownedBackupFilename(file.filename) ? [file] : []);
  const segmented = files.flatMap<WebDavBackupFile>((manifest) => {
    if (!manifest.filename.endsWith('.parts.json')) return [];
    const filename = manifest.filename.slice(0, -'.parts.json'.length);
    if (!ownedBackupFilename(filename) || direct.some((item) => item.filename === filename)) return [];
    const prefix = `${filename}.part`;
    const size = files.filter((item) => item.filename.startsWith(prefix)).reduce((total, item) => total + item.size, 0);
    return [{ filename, size, modifiedAt: manifest.modifiedAt, segmented: true }];
  });
  return [...direct, ...segmented].sort((a, b) => b.filename.localeCompare(a.filename));
}

async function readSegmentedManifest(config: ReturnType<typeof normalizeConfig>, directoryUrl: string, filename: string) {
  const response = await request(childUrl(`${directoryUrl}/`, `${filename}.parts.json`), { method: 'GET', headers: headers(config) }, [200]);
  let value: unknown;
  try { value = JSON.parse(await response.text()); } catch { throw new Error('webdav-invalid-manifest'); }
  const manifest = value as Partial<SegmentedManifest>;
  if (manifest.version !== 1 || manifest.filename !== filename || !Number.isInteger(manifest.totalSize) || !Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('webdav-invalid-manifest');
  if (manifest.parts.length !== Math.ceil((manifest.totalSize as number) / SEGMENT_SIZE)) throw new Error('webdav-invalid-manifest');
  if (manifest.parts.some((part, index) => {
    const expectedName = `${filename}.part${String(index + 1).padStart(3, '0')}`;
    const expectedSize = Math.min(SEGMENT_SIZE, (manifest.totalSize as number) - index * SEGMENT_SIZE);
    return !part || part.filename !== expectedName || part.size !== expectedSize;
  })) throw new Error('webdav-invalid-manifest');
  if (manifest.parts.reduce((total, part) => total + part.size, 0) !== manifest.totalSize) throw new Error('webdav-invalid-manifest');
  return manifest as SegmentedManifest;
}

export async function downloadWebDavBackup(input: WebDavConfig, filename: string, segmented = false) {
  const config = normalizeConfig(input);
  const safeFilename = ownedBackupFilename(filename);
  if (!safeFilename) throw new Error('webdav-invalid-backup-name');
  const directoryUrl = await ensureDirectory(config);
  const destination = new File(Paths.cache, `webdav-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.zip`);
  try {
    if (!segmented) {
      const result = await FileSystem.downloadAsync(childUrl(`${directoryUrl}/`, safeFilename), destination.uri, { headers: headers(config) });
      if (result.status !== 200 || !destination.exists || !destination.size) throw new Error(`webdav-http-${result.status}`);
      return { uri: destination.uri, size: destination.size };
    }
    const manifest = await readSegmentedManifest(config, directoryUrl, safeFilename);
    destination.create({ overwrite: true });
    const destinationHandle = destination.open(FileMode.WriteOnly);
    try {
      for (const [index, part] of manifest.parts.entries()) {
        const temporary = new File(Paths.cache, `webdav-download-${Date.now()}-${index}.part`);
        try {
          const result = await FileSystem.downloadAsync(childUrl(`${directoryUrl}/`, part.filename), temporary.uri, { headers: headers(config) });
          if (result.status !== 200 || !temporary.exists || temporary.size !== part.size) throw new Error('webdav-segment-mismatch');
          const sourceHandle = temporary.open(FileMode.ReadOnly);
          try {
            let copied = 0;
            while (copied < part.size) {
              const bytes = sourceHandle.readBytes(Math.min(COPY_BUFFER_SIZE, part.size - copied));
              if (!bytes.length) throw new Error('webdav-segment-mismatch');
              destinationHandle.writeBytes(bytes);
              copied += bytes.length;
            }
          } finally { sourceHandle.close(); }
        } finally { if (temporary.exists) temporary.delete(); }
      }
    } finally { destinationHandle.close(); }
    if (destination.size !== manifest.totalSize) throw new Error('webdav-segment-mismatch');
    return { uri: destination.uri, size: destination.size };
  } catch (error) {
    if (destination.exists) destination.delete();
    if (error instanceof Error && error.message.startsWith('webdav-')) throw error;
    throw new Error('webdav-download-failed');
  }
}

export async function deleteWebDavBackup(input: WebDavConfig, filename: string, segmented = false) {
  const config = normalizeConfig(input);
  const safeFilename = ownedBackupFilename(filename);
  if (!safeFilename) throw new Error('webdav-invalid-backup-name');
  const directoryUrl = await ensureDirectory(config);
  if (!segmented) {
    await request(childUrl(`${directoryUrl}/`, safeFilename), { method: 'DELETE', headers: headers(config) }, [200, 204, 404]);
    return;
  }
  const manifest = await readSegmentedManifest(config, directoryUrl, safeFilename);
  // Removing the commit marker first makes an interrupted deletion disappear
  // from the logical backup list instead of leaving a visible broken backup.
  await request(childUrl(`${directoryUrl}/`, `${safeFilename}.parts.json`), { method: 'DELETE', headers: headers(config) }, [200, 204, 404]);
  for (const part of manifest.parts) await request(childUrl(`${directoryUrl}/`, part.filename), { method: 'DELETE', headers: headers(config) }, [200, 204, 404]);
}
