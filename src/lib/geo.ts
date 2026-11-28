export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_MI = 3958.8;

/** Straight-line (great-circle) distance in miles. */
export function distanceMiles(a: LatLon, b: LatLon): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}
