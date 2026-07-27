import type { ImagePickerAsset } from 'expo-image-picker';

export const VIDEO_WARNING_BYTES = 25 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export async function getPickedMediaSize(asset: ImagePickerAsset) {
  return asset.fileSize ?? asset.file?.size ?? null;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}
