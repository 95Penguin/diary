export type LocationCandidate = {
  name: string;
  count: number;
  latitude: number;
  longitude: number;
};

export type LocationDuplicateSuggestion = {
  first: LocationCandidate;
  second: LocationCandidate;
  distanceMeters: number;
  reason: '距离很近' | '名称相似';
};

function normalizedName(value: string) {
  return value.toLocaleLowerCase().replace(/[\s·•,，.。()（）\-_/]/g, '');
}

function editDistance(first: string, second: string) {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex];
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      current[secondIndex] = Math.min(
        current[secondIndex - 1] + 1,
        previous[secondIndex] + 1,
        previous[secondIndex - 1] + (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[second.length];
}

function namesAreSimilar(first: string, second: string) {
  const left = normalizedName(first);
  const right = normalizedName(second);
  if (!left || !right || left === right) return false;
  if (Math.min(left.length, right.length) >= 2 && (left.includes(right) || right.includes(left))) return true;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length) >= 0.66;
}

function distanceMeters(first: LocationCandidate, second: LocationCandidate) {
  const latitude = (first.latitude + second.latitude) / 2;
  const latitudeDistance = (first.latitude - second.latitude) * 111_320;
  const longitudeDistance = (first.longitude - second.longitude) * 111_320 * Math.cos(latitude * Math.PI / 180);
  return Math.hypot(latitudeDistance, longitudeDistance);
}

export function findLocationDuplicates(locations: LocationCandidate[]) {
  const suggestions: LocationDuplicateSuggestion[] = [];
  for (let firstIndex = 0; firstIndex < locations.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < locations.length; secondIndex += 1) {
      const first = locations[firstIndex];
      const second = locations[secondIndex];
      const distance = distanceMeters(first, second);
      const similar = namesAreSimilar(first.name, second.name);
      if (distance <= 120 || (similar && distance <= 2_000)) {
        suggestions.push({
          first,
          second,
          distanceMeters: Math.round(distance),
          reason: distance <= 120 ? '距离很近' : '名称相似',
        });
      }
    }
  }
  return suggestions
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, 20);
}
