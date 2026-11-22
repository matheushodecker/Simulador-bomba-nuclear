/**
 * Prédios "interceptados" do próprio mapa: baixa os MESMOS blocos vetoriais (z14) que o
 * mapa-base do OpenFreeMap desenha, separa cada prédio e devolve registros no mesmo
 * formato da Overpass. Assim o simulador troca os prédios do mapa por versões
 * destrutíveis — e esconde os originais pelo id (veja MapView.setHideStyleBuildings).
 *
 * Vantagens sobre a Overpass: rápido (CDN), sem limite de consultas, cobre exatamente o
 * que aparece na tela. Desvantagem: os blocos só trazem altura e cor (sem nome nem tipo).
 */
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { CONFIG } from '../config.js';
import { hash01 } from './overpass.js';

const Z = 14;
let tileTemplate = null;

async function getTemplate(signal) {
  if (tileTemplate) return tileTemplate;
  const res = await fetch(CONFIG.buildings.tileJson, { signal });
  if (!res.ok) throw new Error(`TileJSON HTTP ${res.status}`);
  const j = await res.json();
  if (!j.tiles?.length) throw new Error('TileJSON sem blocos');
  tileTemplate = j.tiles[0];
  return tileTemplate;
}

const lng2x = (lng, n) => ((lng + 180) / 360) * n;
const lat2y = (lat, n) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
};
const x2lng = (x, n) => (x / n) * 360 - 180;
const y2lat = (y, n) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

/** Blocos z14 que cobrem o círculo (centro, raio em m). */
export function tilesForCircle(lat, lng, radiusM) {
  const n = 2 ** Z;
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const x0 = Math.floor(lng2x(lng - dLng, n));
  const x1 = Math.floor(lng2x(lng + dLng, n));
  const y0 = Math.floor(lat2y(lat + dLat, n));
  const y1 = Math.floor(lat2y(lat - dLat, n));
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x: ((x % n) + n) % n, y });
  return out;
}

// área com sinal (mesma convenção da biblioteca vector-tile)
function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[i].y + ring[j].y);
  return s;
}

/** Separa os anéis em polígonos (externo + furos), como no padrão MVT. */
function classifyRings(rings) {
  const polys = [];
  let poly = null;
  let ccw;
  for (const r of rings) {
    const a = signedArea(r);
    if (a === 0) continue;
    if (ccw === undefined) ccw = a < 0;
    if (ccw === a < 0) {
      if (poly) polys.push(poly);
      poly = [r];
    } else if (poly) poly.push(r);
  }
  if (poly) polys.push(poly);
  return polys;
}

/** Recorta um anel no quadrado do bloco (Sutherland–Hodgman): partes vizinhas encostam sem sobrepor. */
function clipRing(ring, E) {
  let pts = ring.map((p) => [p.x, p.y]);
  const edges = [
    (p) => p[0] >= 0, (p) => p[0] <= E, (p) => p[1] >= 0, (p) => p[1] <= E,
  ];
  const cut = [
    (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (E - a[0]) / (b[0] - a[0]); return [E, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; },
    (a, b) => { const t = (E - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), E]; },
  ];
  for (let k = 0; k < 4 && pts.length; k++) {
    const inside = edges[k];
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut[k](prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut[k](prev, cur));
    }
    pts = out;
  }
  return pts;
}

const PALETTE = ['#cfc6b8', '#bdb3a5', '#d9d2c7', '#b0a798', '#c7beb0', '#b8bec4', '#c9ccd0', '#d8c7ad'];
const NAMED = { white: '#f2f2f2', grey: '#9e9e9e', gray: '#9e9e9e', red: '#a63a2b', brown: '#7b5a44', beige: '#d9cbb0', yellow: '#d8c26a' };
function colorOf(c, fid) {
  let hex = null;
  if (c) {
    const s = String(c).trim().toLowerCase();
    if (/^#([0-9a-f]{6})$/.test(s)) hex = s;
    else if (/^#([0-9a-f]{3})$/.test(s)) hex = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    else hex = NAMED[s] || null;
  }
  // o mapa colore os prédios com tons claros parecidos; variamos um pouco para dar textura
  if (!hex) hex = PALETTE[Math.floor(hash01(fid % 1e7) * PALETTE.length)];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Baixa e converte os prédios do mapa num raio.
 * @returns {Promise<{list:object[], fids:number[], tiles:number, truncated:boolean, reachM:number}>}
 *   reachM: até que distância há prédios destrutíveis (menor que o raio se a qualidade limitou)
 */
export async function fetchMapBuildings(lat, lng, radiusM, { signal, onStatus, maxCount = Infinity } = {}) {
  const tpl = await getTemplate(signal);
  const tiles = tilesForCircle(lat, lng, radiusM);
  const n = 2 ** Z;
  const parts = []; // { fid, d, rec }
  let done = 0;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const distM = (p) => Math.hypot((p[0] - lng) * 111320 * cosLat, (p[1] - lat) * 111320);

  const loadTile = async ({ x, y }) => {
    const url = tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url, { signal });
    if (!res.ok) {
      if (res.status === 404 || res.status === 204) return; // bloco vazio (mar, etc.)
      throw new Error(`bloco ${x}/${y}: HTTP ${res.status}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const vt = new VectorTile(new Pbf(buf));
    const L = vt.layers.building;
    done++;
    onStatus?.(`Interceptando os prédios do mapa… ${done}/${tiles.length} blocos`);
    if (!L) return;
    const E = L.extent;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      const p = f.properties;
      if (f.type !== 3 || p.hide_3d != null) continue;
      const fid = typeof f.id === 'number' ? f.id : Math.round(hash01(i + x * 7 + y * 13) * 1e9);
      const minH = Math.max(0, +p.render_min_height || 0);
      const h = Math.max(+p.render_height || 0, minH + 2.5);
      const color = colorOf(p.colour, fid);
      for (const poly of classifyRings(f.loadGeometry())) {
        const rings = poly.map((r) => clipRing(r, E)).filter((r, k) => k > 0 ? r.length >= 3 : true);
        if (rings[0].length < 3) continue;
        const toLL = (pt) => [x2lng(x + pt[0] / E, n), y2lat(y + pt[1] / E, n)];
        const outer = rings[0].map(toLL);
        outer.push([outer[0][0], outer[0][1]]);
        const holes = rings.slice(1).map((r) => { const ll = r.map(toLL); ll.push([ll[0][0], ll[0][1]]); return ll; });
        let cx = 0; let cy = 0;
        for (const q of outer) { cx += q[0]; cy += q[1]; }
        const c = [cx / outer.length, cy / outer.length];
        parts.push({
          fid, d: distM(c),
          rec: {
            id: 0, fid, kind: 'yes', category: 'default', name: null, material: null, levels: null,
            height: h, minHeight: minH, estimated: false, color, outer, holes, fromMap: true,
          },
        });
      }
    }
  };

  // baixa em paralelo (poucos de cada vez)
  const queue = tiles.slice();
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      await loadTile(queue.shift());
    }
  });
  await Promise.all(workers);

  // O mapa funde muitos prédios (mesma altura) num único "feature" que se espalha pelo bloco
  // inteiro, e só dá para esconder pelo id do feature. Para que TODO prédio 3D visível seja
  // destrutível: escondemos todos os features dos blocos baixados e carregamos as nossas cópias
  // do mais próximo ao mais distante, até o limite da qualidade.
  const fids = [...new Set(parts.map((p) => p.fid))];
  parts.sort((a, b) => a.d - b.d);
  const truncated = parts.length > maxCount;
  const kept = truncated ? parts.slice(0, maxCount) : parts;
  const list = kept.map((p, i) => { p.rec.id = i + 1; return p.rec; });
  const reachM = kept.length ? kept[kept.length - 1].d : 0;
  return { list, fids, tiles: tiles.length, truncated, reachM };
}
