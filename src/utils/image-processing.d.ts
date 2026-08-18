import type { ImagePickerAsset } from 'expo-image-picker';
import type { ImageSaveQuality } from '@/preferences/app-preferences';
export function prepareImagesForStorage(assets: ImagePickerAsset[], mode: ImageSaveQuality, onProgress?: (label: string | null) => void): Promise<ImagePickerAsset[]>;
