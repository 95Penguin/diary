export async function compressVideo(
  sourceUri: string,
  onProgress?: (progress: number) => void,
) {
  // Keep the native module lazy: Expo Go and binaries built before compression
  // was added do not contain NitroModules, but the rest of the journal must
  // still be able to load and use image-only features.
  const { Video } = await import('react-native-compressor');
  return Video.compress(
    sourceUri,
    {
      compressionMethod: 'auto',
      maxSize: 1080,
      minimumFileSizeForCompress: 0,
      progressDivider: 5,
    },
    (progress) => onProgress?.(Math.max(0, Math.min(1, progress))),
  );
}
