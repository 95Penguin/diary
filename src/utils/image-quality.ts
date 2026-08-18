import type { ImagePickerAsset, ImagePickerOptions } from 'expo-image-picker';

import type { ImageSaveQuality } from '@/preferences/app-preferences';
import { formatFileSize } from '@/utils/media-file-info';

const QUALITY: Record<ImageSaveQuality, number> = { original: 1, high: 0.9, compact: 0.75 };

export function imagePickerQuality(mode: ImageSaveQuality) {
  return QUALITY[mode] ?? QUALITY.high;
}

export function journalPickerOptions(mode: ImageSaveQuality): Pick<ImagePickerOptions, 'quality' | 'exif'> {
  void mode;
  return { quality: 1, exif: true };
}

export function pickedMediaSizeLabel(assets: ImagePickerAsset[], mode: ImageSaveQuality) {
  const known = assets.reduce((sum, asset) => sum + (asset.fileSize ?? asset.file?.size ?? 0), 0);
  const unknown = assets.some((asset) => !asset.fileSize && !asset.file?.size);
  const name = mode === 'original' ? '原图' : mode === 'compact' ? '节省空间' : '高清';
  if (!known) return `${name}模式 · 文件大小将在保存后统计`;
  return `${name}模式 · 预计占用${unknown ? '至少' : ''} ${formatFileSize(known)}`;
}

export function pickedMediaMetadata(asset: ImagePickerAsset) {
  const exif = asset.exif ?? {};
  const raw = exif.DateTimeOriginal ?? exif.DateTimeDigitized ?? exif.DateTime;
  const originalFilename = (asset as ImagePickerAsset & { originalFileName?: string | null }).originalFileName ?? asset.fileName;
  return { capturedAt: parseExifDate(raw), mimeType: asset.mimeType ?? null, originalFilename: originalFilename ?? null };
}

function parseExifDate(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number') {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const date = new Date(normalized.includes('T') ? normalized : normalized.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
