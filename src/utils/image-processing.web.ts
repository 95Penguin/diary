import type { ImagePickerAsset } from 'expo-image-picker';
import type { ImageSaveQuality } from '@/preferences/app-preferences';
export async function prepareImagesForStorage(assets: ImagePickerAsset[], _mode: ImageSaveQuality, onProgress?: (label: string | null) => void) { onProgress?.(null); return assets; }
