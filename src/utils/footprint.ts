import type { FootprintEntry } from '@/domain/journal';

export type FootprintPlace = {
  id: string; name: string; latitude: number; longitude: number; entries: FootprintEntry[];
};
export type FootprintCluster = {
  id: string; latitude: number; longitude: number; places: FootprintPlace[];
};
export type FootprintPlaceSummary = {
  visits: number; visitDays: number; firstVisitedAt: string; lastVisitedAt: string;
};

export function groupFootprintPlaces(entries: FootprintEntry[]) {
  const groups = new Map<string, FootprintEntry[]>();
  for (const entry of entries) {
    const key = `${entry.locationName.trim().toLocaleLowerCase()}|${entry.latitude.toFixed(3)}|${entry.longitude.toFixed(3)}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()].map(([id, items]) => ({
    id,
    name: items[0].locationName,
    latitude: items.reduce((sum, item) => sum + item.latitude, 0) / items.length,
    longitude: items.reduce((sum, item) => sum + item.longitude, 0) / items.length,
    entries: [...items].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
  })).sort((a, b) => b.entries[0].occurredAt.localeCompare(a.entries[0].occurredAt));
}

function gridSize(zoom: number) {
  if (zoom < 5) return 5;
  if (zoom < 8) return 0.5;
  if (zoom < 11) return 0.05;
  return 0;
}

export function clusterFootprintPlaces(places: FootprintPlace[], zoom: number) {
  const grid = gridSize(zoom);
  if (!grid) return places.map((place) => ({ id: `place:${place.id}`, latitude: place.latitude, longitude: place.longitude, places: [place] }));
  const groups = new Map<string, FootprintPlace[]>();
  for (const place of places) {
    const key = `${Math.round(place.latitude / grid)}:${Math.round(place.longitude / grid)}`;
    groups.set(key, [...(groups.get(key) ?? []), place]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    id: `cluster:${key}`,
    latitude: items.reduce((sum, item) => sum + item.latitude, 0) / items.length,
    longitude: items.reduce((sum, item) => sum + item.longitude, 0) / items.length,
    places: items,
  }));
}

export function summarizeFootprintPlace(place: FootprintPlace): FootprintPlaceSummary {
  const occurredAt = place.entries.map((entry) => entry.occurredAt).sort();
  return {
    visits: place.entries.length,
    visitDays: new Set(place.entries.map((entry) => entry.occurredAt.slice(0, 10))).size,
    firstVisitedAt: occurredAt[0],
    lastVisitedAt: occurredAt[occurredAt.length - 1],
  };
}

export function initialFootprintCamera(places: FootprintPlace[]) {
  if (!places.length) return { latitude: 35.8, longitude: 104.2, zoom: 3.5 };
  const latitude = places.reduce((sum, item) => sum + item.latitude, 0) / places.length;
  const longitude = places.reduce((sum, item) => sum + item.longitude, 0) / places.length;
  const latitudeSpan = Math.max(...places.map((item) => item.latitude)) - Math.min(...places.map((item) => item.latitude));
  const longitudeSpan = Math.max(...places.map((item) => item.longitude)) - Math.min(...places.map((item) => item.longitude));
  const span = Math.max(latitudeSpan, longitudeSpan);
  const zoom = span < 0.02 ? 14 : span < 0.2 ? 11 : span < 1 ? 9 : span < 5 ? 7 : span < 15 ? 5 : 3.5;
  return { latitude, longitude, zoom };
}
