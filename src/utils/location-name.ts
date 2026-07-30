type ReverseGeocodedAddress = {
  city?: string | null;
  district?: string | null;
  formattedAddress?: string | null;
  name?: string | null;
  street?: string | null;
  subregion?: string | null;
  region?: string | null;
};

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function appendDistinct(parts: string[], value: string | null | undefined) {
  const next = clean(value);
  if (!next) return;
  const duplicateIndex = parts.findIndex((part) => part === next || part.includes(next) || next.includes(part));
  if (duplicateIndex < 0) parts.push(next);
  else if (next.length > parts[duplicateIndex].length) parts[duplicateIndex] = next;
}

export function formatLocationName(address: ReverseGeocodedAddress | null | undefined) {
  if (!address) return '';

  const administrative: string[] = [];
  appendDistinct(administrative, address.region);
  appendDistinct(administrative, address.city);
  appendDistinct(administrative, address.district ?? address.subregion);

  const place: string[] = [];
  appendDistinct(place, clean(address.street) || address.name);

  const concise = [...administrative, ...place].join(' · ');
  return concise || clean(address.formattedAddress);
}
