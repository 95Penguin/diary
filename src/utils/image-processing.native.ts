import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

import type { ImageSaveQuality } from '@/preferences/app-preferences';

function isImage(asset: ImagePickerAsset) {
  return asset.type !== 'video' && !asset.mimeType?.startsWith('video/') && !(asset.duration && asset.duration > 0);
}

function needsLosslessOutput(asset: ImagePickerAsset) {
  return asset.mimeType === 'image/png'
    || /\.png$/i.test(asset.fileName ?? '')
    || asset.mimeType === 'image/webp'
    || /\.webp$/i.test(asset.fileName ?? '');
}

export async function prepareImagesForStorage(assets: ImagePickerAsset[], mode: ImageSaveQuality, onProgress?: (label: string | null) => void) {
  if (mode === 'original') return assets;
  const maxEdge = mode === 'compact' ? 2048 : 4096;
  const compress = mode === 'compact' ? 0.75 : 0.9;
  const result: ImagePickerAsset[] = [];
  let number = 0; const imageCount = assets.filter(isImage).length;
  try {
    for (const asset of assets) {
      if (!isImage(asset) || /\.gif$/i.test(asset.fileName ?? '') || asset.mimeType === 'image/gif') { result.push(asset); continue; }
      number += 1; onProgress?.(`正在处理图片 ${number}/${imageCount}`);
      const context = ImageManipulator.manipulate(asset.uri);
      const longest = Math.max(asset.width, asset.height);
      if (longest > maxEdge) {
        if (asset.width >= asset.height) context.resize({ width: maxEdge });
        else context.resize({ height: maxEdge });
      }
      const rendered = await context.renderAsync();
      // ImageManipulator cannot reliably preserve an alpha channel when WebP is
      // encoded as JPEG. PNG keeps transparent PNG/WebP assets visually intact.
      const lossless = needsLosslessOutput(asset);
      const saved = await rendered.saveAsync({ compress, format: lossless ? SaveFormat.PNG : SaveFormat.JPEG });
      const file = new File(saved.uri);
      result.push({ ...asset, originalFileName: (asset as ImagePickerAsset & { originalFileName?: string | null }).originalFileName ?? asset.fileName, uri: saved.uri, width: saved.width, height: saved.height, fileSize: file.exists ? file.size ?? undefined : undefined, mimeType: lossless ? 'image/png' : 'image/jpeg', fileName: replaceExtension(asset.fileName, lossless ? '.png' : '.jpg') } as ImagePickerAsset);
    }
    return result;
  } finally { onProgress?.(null); }
}

function replaceExtension(name: string | null | undefined, extension: string) {
  return name ? `${name.replace(/\.[^.]+$/, '')}${extension}` : `journal-image${extension}`;
}
