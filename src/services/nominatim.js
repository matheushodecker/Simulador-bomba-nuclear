/**
 * Busca de lugares e geocodificação reversa — Nominatim (OpenStreetMap).
 * Política de uso: no máximo 1 requisição/s e sem autocompletar a cada tecla.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
import { fetchJson } from './http.js';

const BASE = 'https://nominatim.openstreetmap.org';
let lastCall = 0;

async function throttle() {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function searchPlaces(query) {
  await throttle();
  const url = `${BASE}/search?format=jsonv2&limit=6&accept-language=pt-BR&q=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { timeoutMs: 15000 });
  return data.map((d) => ({
    name: d.display_name,
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
    type: d.type,
    bbox: d.boundingbox ? d.boundingbox.map(Number) : null, // [s, n, w, e]
  }));
}

const countryCache = new Map();

/** País de um ponto (ou null no mar). */
export async function countryAt(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (countryCache.has(key)) return countryCache.get(key);
  await throttle();
  const url = `${BASE}/reverse?format=jsonv2&zoom=3&accept-language=pt-BR&lat=${lat}&lon=${lng}`;
  let out = null;
  try {
    const d = await fetchJson(url, { timeoutMs: 15000 });
    if (d && d.address && d.address.country_code) {
      out = { code: d.address.country_code, name: d.address.country };
    }
  } catch {
    out = null;
  }
  countryCache.set(key, out);
  return out;
}
