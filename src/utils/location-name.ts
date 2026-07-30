type ReverseGeocodedAddress = {
  city?: string | null;
  country?: string | null;
  district?: string | null;
  formattedAddress?: string | null;
  isoCountryCode?: string | null;
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

function trimAdministrativeSuffix(value: string) {
  return value
    .replace(/特别行政区$/u, '')
    .replace(/自治州$/u, '')
    .replace(/[省市]$/u, '');
}

function isChina(address: ReverseGeocodedAddress) {
  const code = clean(address.isoCountryCode).toUpperCase();
  if (code) return code === 'CN' || code === 'CHN';
  const country = clean(address.country);
  return !country || /^(中国|中华人民共和国)$/u.test(country);
}

export function formatLocationName(address: ReverseGeocodedAddress | null | undefined) {
  if (!address) return '';

  const place = clean(address.name) || clean(address.street);
  if (!isChina(address)) {
    const country = clean(address.country);
    const overseasPlace = place || clean(address.city) || clean(address.region);
    return [country, overseasPlace].filter(Boolean).join(' · ') || clean(address.formattedAddress);
  }

  const city = trimAdministrativeSuffix(clean(address.city) || clean(address.region));
  const localPlace = place || clean(address.district ?? address.subregion);
  const concise: string[] = [];
  appendDistinct(concise, city);
  appendDistinct(concise, localPlace);
  return concise.join(' · ') || clean(address.formattedAddress);
}
