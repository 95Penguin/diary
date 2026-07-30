import type { LocationPrivacyMode } from '@/preferences/app-preferences';

export type CoordinatePrivacyChoice = Exclude<LocationPrivacyMode, 'ask'>;
export type PrivateCoordinates = { latitude: number | null; longitude: number | null };

export function applyLocationPrivacy(
  latitude: number | null,
  longitude: number | null,
  mode: LocationPrivacyMode,
  askChoice: CoordinatePrivacyChoice = 'precise',
): PrivateCoordinates {
  if (latitude == null || longitude == null) return { latitude: null, longitude: null };
  const resolved = mode === 'ask' ? askChoice : mode;
  if (resolved === 'nameOnly') return { latitude: null, longitude: null };
  if (resolved === 'approximate') {
    return {
      latitude: Math.round(latitude * 100) / 100,
      longitude: Math.round(longitude * 100) / 100,
    };
  }
  return { latitude, longitude };
}
