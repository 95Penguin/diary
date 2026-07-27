import type { ImagePickerAsset } from 'expo-image-picker';
import { Alert } from 'react-native';

import type { JournalMediaType } from '@/domain/journal';
import { formatFileSize, getPickedMediaSize, VIDEO_MAX_BYTES, VIDEO_WARNING_BYTES } from '@/utils/media-file-info';
import { compressVideo } from '@/utils/video-compression';

export function getPickerMediaType(asset: ImagePickerAsset): JournalMediaType {
  if (
    asset.type === 'video'
    || asset.mimeType?.startsWith('video/')
    || (asset.duration != null && asset.duration > 0)
  ) return 'video';
  return 'image';
}

export async function inspectPickedVideos(assets: ImagePickerAsset[]) {
  const videos = assets.filter((asset) => getPickerMediaType(asset) === 'video');
  const measured = await Promise.all(videos.map(async (asset) => ({ asset, bytes: await getPickedMediaSize(asset) })));
  const blocked = measured.filter((item) => item.bytes != null && item.bytes > VIDEO_MAX_BYTES);
  const large = measured.filter((item) => item.bytes != null && item.bytes > VIDEO_WARNING_BYTES && item.bytes <= VIDEO_MAX_BYTES);
  const knownBytes = measured.reduce((total, item) => total + (item.bytes ?? 0), 0);
  return {
    blocked,
    large,
    knownBytes,
    summary: measured.length ? `${measured.length} 个视频，共 ${formatFileSize(knownBytes)}` : '',
  };
}

function chooseVideoHandling(message: string, allowOriginal: boolean) {
  return new Promise<'compress' | 'original' | 'cancel'>((resolve) => {
    Alert.alert(
      '处理视频',
      message,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve('cancel') },
        ...(allowOriginal ? [{ text: '使用原视频', onPress: () => resolve('original' as const) }] : []),
        { text: '压缩后添加', onPress: () => resolve('compress') },
      ],
      { cancelable: true, onDismiss: () => resolve('cancel') },
    );
  });
}

export async function preparePickedMedia(
  assets: ImagePickerAsset[],
  onProgress?: (label: string | null) => void,
) {
  const result = await inspectPickedVideos(assets);
  if (!result.large.length && !result.blocked.length) return assets;

  const mustCompress = result.blocked.length > 0;
  const decision = await chooseVideoHandling(
    mustCompress
      ? `${result.summary}。其中有视频超过 ${formatFileSize(VIDEO_MAX_BYTES)}，需要压缩后才能添加。`
      : `${result.summary}。压缩可明显减少本地空间和备份体积，也可保留原始画质。`,
    !mustCompress,
  );
  if (decision === 'cancel') return null;
  if (decision === 'original') return assets;

  const candidates = new Set([...result.large, ...result.blocked].map((item) => item.asset.uri));
  const next: ImagePickerAsset[] = [];
  try {
    let videoNumber = 0;
    const videoCount = candidates.size;
    for (const asset of assets) {
      if (!candidates.has(asset.uri)) {
        next.push(asset);
        continue;
      }
      videoNumber += 1;
      const compressedUri = await compressVideo(asset.uri, (progress) => {
        onProgress?.(`正在压缩视频 ${videoNumber}/${videoCount} · ${Math.round(progress * 100)}%`);
      });
      next.push({ ...asset, uri: compressedUri, fileSize: undefined });
    }
    return next;
  } catch {
    Alert.alert(
      '视频压缩失败',
      '当前安装包不包含压缩模块，或这个视频格式暂不受支持。请重新构建应用后重试，也可以先在系统相册中裁剪视频。',
    );
    return null;
  } finally {
    onProgress?.(null);
  }
}
