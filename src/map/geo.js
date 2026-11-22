/** Geodésia esférica simples (raio médio da Terra). */
const R_EARTH_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Distância de grande círculo (km). */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Ponto a `distKm` na direção `bearingDeg` (0 = norte, sentido horário). */
export function destination(p, bearingDeg, distKm) {
  const d = distKm / R_EARTH_KM;
  const th = toRad(bearingDeg);
  const la1 = toRad(p.lat);
  const lo1 = toRad(p.lng);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(th));
  const lo2 = lo1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lng: ((toDeg(lo2) + 540) % 360) - 180, lat: toDeg(la2) };
}

/** Círculo geodésico como anel GeoJSON [[lng,lat],...]. */
export function circleRing(center, radiusKm, steps = 128) {
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(center, (i / steps) * 360, radiusKm);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

/** Converte pontos locais (x a favor do vento, y transversal, km) em [lng,lat]. */
export function localToLngLat(center, bearingDeg, pts) {
  return pts.map(([x, y]) => {
    const d = Math.hypot(x, y);
    if (d < 1e-9) return [center.lng, center.lat];
    const ang = (Math.atan2(y, x) * 180) / Math.PI; // y positivo = à direita do vento
    const p = destination(center, bearingDeg + ang, d);
    return [p.lng, p.lat];
  });
}

export function bbox(ring) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return [[minX, minY], [maxX, maxY]];
}

/** Ponto dentro de polígono (ray casting) — coordenadas planas. */
export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
