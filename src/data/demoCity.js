/**
 * Cidade de DEMONSTRAÇÃO gerada por procedimento (sem nenhum serviço externo).
 * Usada na edição "artefato", onde mapas, OSM e Google 3D Tiles não podem ser
 * baixados. Gera ruas, avenidas, um rio, parques e ~9 mil prédios em zonas
 * (centro com torres, bairros médios e subúrbios de casas), no mesmo formato
 * dos registros do Overpass/OSM usados pelo resto do app.
 */
import { metersPerDegree } from '../map/geo.js';

export const DEMO_CENTER = { lat: 12.0, lng: -32.0 }; // oceano Atlântico: claramente fictícia
export const DEMO_NAME = 'Cidade-modelo (demonstração)';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const PAL = {
  tower: ['#9aa7b3', '#b8c2cc', '#7f8d99', '#a9b4a8', '#c9ccd0', '#8796a8'],
  mid: ['#c9b79c', '#b9a58a', '#d3c6b0', '#a98d74', '#c4c0b8', '#b08a6e'],
  house: ['#d9c9ae', '#e6dccb', '#c69c7c', '#b97a5f', '#ddd3c1', '#cfae8c'],
};

const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

let cached = null;

export function demoCity() {
  if (cached) return cached;
  const rand = rng(20251122);
  const mpd = metersPerDegree(DEMO_CENTER.lat);
  const toLL = (e, n) => [DEMO_CENTER.lng + e / mpd.lon, DEMO_CENTER.lat + n / mpd.lat];
  const R = 2300;
  const BLOCK = 96;
  const STREET = 16;
  const AVE = 34;
  const pitch = BLOCK + STREET;
  const N = Math.ceil(R / pitch);
  // rio sinuoso cruzando a cidade (y = f(x))
  const river = (e) => -650 + 260 * Math.sin(e / 520) + 90 * Math.sin(e / 190);
  const RIVER_W = 130;
  const inRiver = (e, n) => Math.abs(n - river(e)) < RIVER_W / 2 + 12;

  const buildings = [];
  const parks = [];
  let id = 1;
  const isAve = (k) => k % 5 === 0;
  for (let i = -N; i < N; i++) for (let j = -N; j < N; j++) {
    const x0 = i * pitch + (isAve(i) ? AVE / 2 : STREET / 2);
    const x1 = (i + 1) * pitch - (isAve(i + 1) ? AVE / 2 : STREET / 2);
    const y0 = j * pitch + (isAve(j) ? AVE / 2 : STREET / 2);
    const y1 = (j + 1) * pitch - (isAve(j + 1) ? AVE / 2 : STREET / 2);
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    const r = Math.hypot(cx, cy);
    if (r > R) continue;
    if (inRiver(cx, cy) || inRiver(x0, y0) || inRiver(x1, y1) || inRiver(x0, y1) || inRiver(x1, y0)) continue;
    // praça central (o ponto zero padrão fica perto dela) e parques espalhados
    if ((i === 0 && j === 0) || rand() < (r < 600 ? 0.03 : 0.07)) {
      parks.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
      continue;
    }
    const zone = r < 650 ? 'tower' : r < 1450 ? 'mid' : 'house';
    const lots = [];
    if (zone === 'tower') {
      const n = 1 + Math.floor(rand() * 3);
      const w = (x1 - x0) / (n === 1 ? 1 : 2);
      for (let k = 0; k < n; k++) {
        const ox = n === 1 ? x0 : x0 + (k % 2) * w;
        const oy = n <= 2 ? y0 : y0 + Math.floor(k / 2) * ((y1 - y0) / 2);
        const hh = n <= 2 ? y1 - y0 : (y1 - y0) / 2;
        lots.push([ox + 4, oy + 4, ox + w - 4, oy + hh - 4]);
      }
    } else if (zone === 'mid') {
      const nx = 2 + Math.floor(rand() * 2); const ny = 2;
      const w = (x1 - x0) / nx; const h = (y1 - y0) / ny;
      for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
        if (rand() < 0.12) continue;
        lots.push([x0 + a * w + 3, y0 + b * h + 3, x0 + (a + 1) * w - 3, y0 + (b + 1) * h - 3]);
      }
    } else {
      // casas ao longo das bordas do quarteirão
      const s = 15 + rand() * 4;
      for (let x = x0 + 2; x + s <= x1 - 2; x += s) {
        if (rand() < 0.85) lots.push([x + 2, y0 + 3, x + s - 2, y0 + 3 + 11 + rand() * 4]);
        if (rand() < 0.85) lots.push([x + 2, y1 - 3 - 11 - rand() * 4, x + s - 2, y1 - 3]);
      }
    }
    for (const [a0, b0, a1, b1] of lots) {
      if (a1 - a0 < 5 || b1 - b0 < 5) continue;
      // pequena irregularidade nos cantos
      const j1 = (rand() - 0.5) * 2; const j2 = (rand() - 0.5) * 2;
      const ring = [[a0, b0 + j1], [a1, b0], [a1 + j2, b1], [a0, b1], [a0, b0 + j1]];
      let height; let levels; let kind;
      if (zone === 'tower') {
        const f = Math.max(0.15, 1 - r / 650);
        height = 30 + rand() * 60 + f * f * (60 + rand() * 120);
        kind = rand() < 0.6 ? 'office' : 'apartments';
      } else if (zone === 'mid') {
        height = 9 + rand() * 22 + (1 - (r - 650) / 800) * 12;
        kind = rand() < 0.5 ? 'apartments' : 'commercial';
      } else {
        height = 5 + rand() * 4;
        kind = 'house';
      }
      levels = Math.max(1, Math.round(height / 3.2));
      const pal = PAL[zone];
      buildings.push({
        id: id++, kind, category: zone === 'house' ? 'residential' : zone === 'mid' ? 'commercial' : 'commercial',
        name: null, levels, height, minHeight: 0, estimated: false,
        color: hexRgb(pal[Math.floor(rand() * pal.length)]),
        outer: ring.map(([e, n]) => toLL(e, n)), holes: [],
        enu: ring,
      });
    }
  }

  // ruas (linhas) e avenidas
  const roads = [];
  for (let k = -N; k <= N; k++) {
    const p = k * pitch;
    const w = isAve(k) ? AVE : STREET;
    const half = Math.sqrt(Math.max(0, R * R - p * p)) + 60;
    roads.push({ w, coords: [[p, -half], [p, half]] });
    roads.push({ w, coords: [[-half, p], [half, p]] });
  }
  // margem do rio
  const water = [];
  const up = []; const dn = [];
  for (let e = -R - 400; e <= R + 400; e += 40) { up.push([e, river(e) + RIVER_W / 2]); dn.push([e, river(e) - RIVER_W / 2]); }
  water.push([...up, ...dn.reverse(), up[0]]);

  cached = {
    center: DEMO_CENTER, name: DEMO_NAME, radius: R, buildings, parks, water, roads, toLL, river, riverW: RIVER_W,
  };
  return cached;
}

/** Estilo MapLibre "offline" com a cidade-modelo desenhada como um mapa de ruas. */
export function demoStyle() {
  const c = demoCity();
  const poly = (rings) => ({ type: 'FeatureCollection', features: rings.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [r.map(([e, n]) => c.toLL(e, n))] } })) });
  return {
    version: 8,
    sources: {
      parks: { type: 'geojson', data: poly(c.parks) },
      water: { type: 'geojson', data: poly(c.water) },
      roads: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: c.roads.map((r) => ({ type: 'Feature', properties: { w: r.w }, geometry: { type: 'LineString', coordinates: r.coords.map(([e, n]) => c.toLL(e, n)) } })) },
      },
      buildings: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: c.buildings.map((b) => ({ type: 'Feature', properties: { h: b.height }, geometry: { type: 'Polygon', coordinates: [b.outer] } })) },
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e8e3d6' } },
      { id: 'parks', type: 'fill', source: 'parks', paint: { 'fill-color': '#c4d9a9' } },
      { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': '#9fc4de' } },
      {
        id: 'roads-casing', type: 'line', source: 'roads',
        paint: { 'line-color': '#cfc7b6', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, ['*', ['get', 'w'], 0.02], 18, ['*', ['get', 'w'], 6]] },
      },
      {
        id: 'roads', type: 'line', source: 'roads',
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, ['*', ['get', 'w'], 0.015], 18, ['*', ['get', 'w'], 5]] },
      },
      {
        id: 'building', type: 'fill', source: 'buildings', minzoom: 13,
        paint: { 'fill-color': '#d4cbbb', 'fill-outline-color': '#b8ad99' },
      },
    ],
  };
}
