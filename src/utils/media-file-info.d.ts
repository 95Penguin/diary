import type { ImagePickerAsset } from 'expo-image-picker';

export const VIDEO_WARNING_BYTES: number;
export const VIDEO_MAX_BYTES: number;
export function getPickedMediaSize(asset: ImagePickerAsset): Promise<number | null>;
export function formatFileSize(bytes: number): string;
