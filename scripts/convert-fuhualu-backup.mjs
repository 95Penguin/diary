import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strToU8, zipSync } from 'fflate';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultSource = resolve(scriptDirectory, '../../浮华录');
const sourceDirectory = resolve(process.argv[2] ?? defaultSource);
const outputPath = resolve(process.argv[3] ?? join(sourceDirectory, '拾时导入备份.zip'));
const sourceJsonPath = join(sourceDirectory, '浮华录.json');

function parseJsonArray(value, fieldName) {
  if (value === '' || value === null || value === undefined) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed;
  } catch {}
  throw new Error(`${fieldName} 不是合法的文件列表：${value}`);
}

function isoFromMilliseconds(value, fieldName) {
  const milliseconds = Number(value);
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} 不是合法时间：${value}`);
  }
  return date.toISOString();
}

function imageSize(bytes, filename) {
  if (bytes.length >= 24 && bytes.toString('ascii', 1, 4) === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  throw new Error(`无法读取图片尺寸：${filename}`);
}

function stableId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

const source = JSON.parse(readFileSync(sourceJsonPath, 'utf8'));
if (!source || !Array.isArray(source.list)) throw new Error('浮华录.json 缺少 list 数组');

const entries = [];
const followUps = [];
const images = [];
const tags = [];
const archiveFiles = {};
const referencedFiles = new Set();

for (const [entryIndex, item] of source.list.entries()) {
  const diary = item?.diaryBean;
  if (!diary || typeof diary.record_id !== 'string' || !diary.record_id) {
    throw new Error(`第 ${entryIndex + 1} 条日记缺少 record_id`);
  }
  const entryId = diary.record_id;
  const occurredAt = isoFromMilliseconds(diary.time, `日记 ${diary.id} 的 time`);
  const location = diary.location && diary.location !== 'null'
    ? String(diary.locationDetail || diary.location).trim() || null
    : null;
  entries.push({
    id: entryId,
    content: String(diary.content ?? ''),
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
    mood: null,
    weather: null,
    favoritedAt: null,
    locationName: location,
    latitude: null,
    longitude: null,
  });

  const label = String(diary.tag ?? '').trim();
  if (label) tags.push({ entryId, label, sortOrder: 0 });

  for (const [sortOrder, filename] of parseJsonArray(diary.fileList, `日记 ${diary.id} 的 fileList`).entries()) {
    const filePath = join(sourceDirectory, basename(filename));
    const bytes = readFileSync(filePath);
    const imageId = stableId('fuhualu-image', `${entryId}:${filename}`);
    const extension = extname(filename).toLowerCase() || '.jpg';
    const archivePath = `media/entries/${imageId}/primary${extension}`;
    const { width, height } = imageSize(bytes, filename);
    images.push({
      id: imageId,
      entryId,
      localUri: archivePath,
      width,
      height,
      sortOrder,
      createdAt: occurredAt,
      mediaType: 'image',
      pairedVideoLocalUri: null,
      duration: null,
      thumbnailLocalUri: null,
    });
    archiveFiles[archivePath] = [bytes, { level: 0 }];
    referencedFiles.add(basename(filename));
  }

  for (const comment of item.Comment ?? []) {
    const createdAt = isoFromMilliseconds(comment.time, `评论 ${comment.id} 的 time`);
    const followUpId = stableId('fuhualu-follow-up', `${entryId}:${comment.id}:${comment.time}`);
    followUps.push({
      id: followUpId,
      entryId,
      content: String(comment.commentContent ?? ''),
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    });
    const files = parseJsonArray(comment.fileList, `评论 ${comment.id} 的 fileList`);
    if (files.length > 0) {
      throw new Error(`评论 ${comment.id} 含附件；当前转换器尚未映射续写附件`);
    }
  }
}

const duplicateCheck = (items, name) => {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`${name} ID 重复`);
};
duplicateCheck(entries, '日记');
duplicateCheck(followUps, '评论');
duplicateCheck(images, '图片');

const sourceMedia = readdirSync(sourceDirectory).filter((name) => name !== '浮华录.json' && name !== basename(outputPath));
const unreferenced = sourceMedia.filter((name) => !referencedFiles.has(name));
if (unreferenced.length > 0) throw new Error(`存在未被 JSON 引用的文件：${unreferenced.join('、')}`);

const backup = {
  format: 'shishi-journal',
  version: 11,
  exportedAt: new Date().toISOString(),
  timezone: 'Asia/Shanghai',
  entries,
  followUps,
  images,
  followUpImages: [],
  tags,
  versions: [],
  suppressedMemoryEntryIds: [],
  metadataCatalog: {
    tags: [...new Set(tags.map((tag) => tag.label))],
    locations: [...new Set(entries.map((entry) => entry.locationName).filter(Boolean))],
    pinnedTags: [],
    pinnedLocations: [],
    locationDetails: {},
  },
};

archiveFiles['backup.json'] = [strToU8(JSON.stringify(backup)), { level: 6 }];
writeFileSync(outputPath, zipSync(archiveFiles));
console.log(JSON.stringify({
  output: outputPath,
  entries: entries.length,
  followUps: followUps.length,
  images: images.length,
  tags: tags.length,
  locations: backup.metadataCatalog.locations.length,
}, null, 2));
