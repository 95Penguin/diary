export type MapCoordinate = { latitude: number; longitude: number };

const PI = Math.PI;
const AXIS = 6378245;
const ECCENTRICITY_SQUARED = 0.006693421622965943;

function outsideMainland({ latitude, longitude }: MapCoordinate) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(x: number, y: number) {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  result += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  result += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
  return result;
}

function transformLongitude(x: number, y: number) {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  result += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  result += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
  return result;
}

export function wgs84ToGcj02(coordinate: MapCoordinate): MapCoordinate {
  if (outsideMainland(coordinate)) return coordinate;
  const latitudeOffset = transformLatitude(coordinate.longitude - 105, coordinate.latitude - 35);
  const longitudeOffset = transformLongitude(coordinate.longitude - 105, coordinate.latitude - 35);
  const radLatitude = coordinate.latitude / 180 * PI;
  const magic = 1 - ECCENTRICITY_SQUARED * Math.sin(radLatitude) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  const adjustedLatitude = latitudeOffset * 180 / ((AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * sqrtMagic) * PI);
  const adjustedLongitude = longitudeOffset * 180 / (AXIS / sqrtMagic * Math.cos(radLatitude) * PI);
  return {
    latitude: coordinate.latitude + adjustedLatitude,
    longitude: coordinate.longitude + adjustedLongitude,
  };
}

export function gcj02ToWgs84(coordinate: MapCoordinate): MapCoordinate {
  if (outsideMainland(coordinate)) return coordinate;
  let guess = coordinate;
  for (let index = 0; index < 3; index += 1) {
    const converted = wgs84ToGcj02(guess);
    guess = {
      latitude: guess.latitude - (converted.latitude - coordinate.latitude),
      longitude: guess.longitude - (converted.longitude - coordinate.longitude),
    };
  }
  return guess;
}
