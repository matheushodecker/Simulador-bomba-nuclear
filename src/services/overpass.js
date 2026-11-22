/**
 * Prédios reais do OpenStreetMap via Overpass API (building=*).
 * Converte ways e multipolígonos em registros com anel externo, furos e altura.
 */
import { CONFIG } from '../config.js';

const BCFG = CONFIG.buildings;

export async function fetchBuildings(lat, lng, radiusM, { signal, onStatus } = {}) {
  const q = `[out:json][timeout:90];(way["building"](around:${Math.round(radiusM)},${lat.toFixed(6)},${lng.toFixed(6)});`
    + `relation["building"]["type"="multipolygon"](around:${Math.round(radiusM)},${lat.toFixed(6)},${lng.toFixed(6)}););out tags geom qt;`;
  let lastErr;
  for (const ep of BCFG.endpoints) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    try {
      onStatus?.(`Consultando ${new URL(ep).host}…`);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 95000);
      signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
      const res = await fetch(ep, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onStatus?.('Processando geometria…');
      return await res.json();
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('Overpass indisponível');
}

/* ---------------------------- parsing ---------------------------- */

function parseLength(v) {
  if (v == null) return null;
  const s = String(v).replace(',', '.');
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let x = parseFloat(m[0]);
  if (/ft|'/.test(s)) x *= 0.3048;
  return Number.isFinite(x) ? x : null;
}

/** hash determinístico 0–1 a partir do id OSM */
export function hash01(n) {
  let x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  x -= Math.floor(x);
  return x;
}

const NAMED_COLORS = {
  white: '#f2f2f2', black: '#2b2b2b', grey: '#9e9e9e', gray: '#9e9e9e', red: '#a63a2b', brown: '#7b5a44',
  yellow: '#d8c26a', beige: '#d9cbb0', blue: '#5b7fa6', green: '#6e8f5a', orange: '#d0844a', pink: '#d8a0a8',
  tan: '#cdb48a', silver: '#c0c0c0', maroon: '#6d2b2b', cream: '#efe6cf',
};

function parseColor(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (/^#([0-9a-f]{3}){1,2}$/.test(s)) return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
  return NAMED_COLORS[s] || null;
}

/** Paletas realistas por tipo de edificação */
const PALETTES = {
  residential: ['#d8c7ad', '#cbb59a', '#e3d6c2', '#b9876b', '#c9a98d', '#efe7da', '#a8705a'],
  commercial: ['#b8bec4', '#9fa8b0', '#c9ccd0', '#8e9aa6', '#d0cfc8', '#a7b4bd'],
  industrial: ['#b3b3ad', '#a4a7a3', '#c2c0b6', '#8f948f'],
  civic: ['#d6cbb5', '#c4b8a0', '#e0d8c6', '#b5a58a'],
  default: ['#cfc6b8', '#bdb3a5', '#d9d2c7', '#b0a798', '#c7beb0'],
};

function categoryOf(kind) {
  if (['house', 'detached', 'residential', 'apartments', 'terrace', 'bungalow', 'semidetached_house', 'dormitory', 'hut', 'cabin'].includes(kind)) return 'residential';
  if (['commercial', 'office', 'retail', 'hotel', 'supermarket', 'kiosk'].includes(kind)) return 'commercial';
  if (['industrial', 'warehouse', 'factory', 'manufacture', 'garage', 'garages', 'shed', 'service', 'hangar', 'storage_tank'].includes(kind)) return 'industrial';
  if (['church', 'cathedral', 'chapel', 'mosque', 'temple', 'school', 'university', 'hospital', 'public', 'civic', 'government', 'train_station', 'college', 'museum'].includes(kind)) return 'civic';
  return 'default';
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function closeRing(pts) {
  if (pts.length < 3) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) pts.push([a[0], a[1]]);
  return pts.length >= 4 ? pts : null;
}

/** Junta segmentos de ways (multipolígonos) em anéis fechados. */
function assembleRings(segments) {
  const segs = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings = [];
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 1000) {
      const end = ring[ring.length - 1];
      const idx = segs.findIndex((s) => same(s[0], end) || same(s[s.length - 1], end));
      if (idx < 0) break;
      let s = segs.splice(idx, 1)[0];
      if (!same(s[0], end)) s = s.reverse();
      ring = ring.concat(s.slice(1));
    }
    const closed = closeRing(ring);
    if (closed) rings.push(closed);
  }
  return rings;
}

function ringContains(ring, pt) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function makeRecord(id, tags, outer, holes) {
  const kind = tags.building === 'yes' && tags.amenity ? tags.amenity : tags.building || 'yes';
  const levels = parseLength(tags['building:levels']);
  const roofLevels = parseLength(tags['roof:levels']) || 0;
  let height = parseLength(tags.height) ?? parseLength(tags['building:height']);
  let estimated = false;
  if (height == null && levels != null) height = (levels + roofLevels * 0.5) * BCFG.levelHeight_m + 1;
  if (height == null) {
    estimated = true;
    const base = BCFG.defaultHeights[kind] ?? BCFG.defaultHeights.yes;
    height = base * (0.85 + 0.3 * hash01(id));
  }
  let minHeight = parseLength(tags.min_height);
  if (minHeight == null) {
    const ml = parseLength(tags['building:min_level']);
    minHeight = ml != null ? ml * BCFG.levelHeight_m : 0;
  }
  height = Math.max(height, minHeight + 2);
  const cat = categoryOf(kind);
  const pal = PALETTES[cat];
  const colorHex = parseColor(tags['building:colour']) || pal[Math.floor(hash01(id * 7 + 1) * pal.length)];
  return {
    id,
    kind,
    category: cat,
    name: tags.name || null,
    levels,
    height,
    minHeight,
    estimated,
    color: hexToRgb(colorHex),
    outer,
    holes,
  };
}

/**
 * @returns {Array<{id,kind,name,height,minHeight,estimated,color:number[],outer:number[][],holes:number[][][]}>}
 */
export function parseBuildings(json, maxCount = Infinity) {
  const out = [];
  for (const el of json.elements || []) {
    if (out.length >= maxCount) break;
    const tags = el.tags || {};
    if (!tags.building || tags.building === 'no') continue;
    if (el.type === 'way' && el.geometry) {
      const outer = closeRing(el.geometry.map((g) => [g.lon, g.lat]));
      if (outer) out.push(makeRecord(el.id, tags, outer, []));
    } else if (el.type === 'relation' && el.members) {
      const outers = assembleRings(el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => [g.lon, g.lat])));
      const inners = assembleRings(el.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry.map((g) => [g.lon, g.lat])));
      outers.forEach((o, k) => {
        const holes = inners.filter((h) => ringContains(o, h[0]));
        out.push(makeRecord(el.id * 10 + k + 0.5, tags, o, holes));
      });
    }
  }
  return out;
}
