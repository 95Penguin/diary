import type { ImagePickerAsset } from 'expo-image-picker';

import type { JournalMediaType } from '@/domain/journal';

export function getPickerMediaType(asset: ImagePickerAsset): JournalMediaType {
  if (asset.type === 'livePhoto' || asset.pairedVideoAsset) return 'livePhoto';
  if (
    asset.type === 'video'
    || asset.mimeType?.startsWith('video/')
    || (asset.duration != null && asset.duration > 0)
  ) return 'video';
  return 'image';
}
