/**
 * "Mundos" do modo cinema (sistema de coordenadas do three.js: Y para cima,
 * X para oeste, Z para o norte, origem no ponto zero):
 *  - TilesWorld: cidades fotorrealistas (Google Photorealistic 3D Tiles ou Cesium ion)
 *  - FallbackWorld: sem chave — chão com imagem de satélite (Esri) + prédios do OSM
 */
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, CesiumIonAuthPlugin, ReorientationPlugin } from '3d-tiles-renderer/plugins';
import { patchMaterial } from './destruction.js';
import { emit } from '../util/events.js';

const D2R = Math.PI / 180;

import { metersPerDegree } from '../map/geo.js';
import { OFFLINE } from '../env.js';
import { demoCity } from '../data/demoCity.js';

export { metersPerDegree };

/* ======================= Google / Cesium ion ======================= */

export class TilesWorld {
  /**
   * @param {{provider:'google'|'cesium', key:string, uniforms:object, camera:THREE.Camera, renderer:THREE.WebGLRenderer, errorTarget:number}} o
   */
  constructor(o) {
    this.kind = 'tiles';
    this.provider = o.provider;
    const tiles = new TilesRenderer();
    if (o.provider === 'google') {
      tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: o.key, autoRefreshToken: true }));
    } else {
      tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: o.key, assetId: '2275207', autoRefreshToken: true }));
    }
    this.reorient = new ReorientationPlugin({ lat: 0, lon: 0, height: 0, recenter: true });
    tiles.registerPlugin(this.reorient);
    tiles.errorTarget = o.errorTarget ?? 12;
    tiles.setCamera(o.camera);
    tiles.setResolutionFromRenderer(o.camera, o.renderer);
    let errors = 0;
    tiles.addEventListener('load-model', ({ scene }) => {
      scene.traverse((m) => {
        if (!m.isMesh) return;
        const old = m.material;
        m.material = patchMaterial(old, o.uniforms);
        old.dispose?.();
        m.castShadow = true;
        m.receiveShadow = true;
      });
    });
    tiles.addEventListener('load-error', (e) => {
      errors++;
      if (errors === 1) {
        console.warn('[tiles]', e.error);
        emit('cinema-tiles-error', String(e.error?.message || e.error || 'erro'));
      }
    });
    tiles.addEventListener('load-root-tileset', () => emit('cinema-tiles-ready'));
    this.tiles = tiles;
    this.object3d = tiles.group;
  }

  setOrigin(lat, lon) {
    this.lat = lat;
    this.lon = lon;
    this.reorient.lat = lat * D2R;
    this.reorient.lon = lon * D2R;
    this.reorient.height = 0;
    this.reorient.transformLatLonHeightToOrigin(lat * D2R, lon * D2R, 0);
  }

  update(camera, renderer) {
    this.tiles.setResolutionFromRenderer(camera, renderer);
    this.tiles.update();
  }

  get loading() {
    return this.tiles.loadProgress < 1;
  }

  /** Ponto do mundo → latitude/longitude (via elipsoide). */
  worldToLatLon(p) {
    const inv = new THREE.Matrix4().copy(this.tiles.group.matrixWorld).invert();
    const ecef = p.clone().applyMatrix4(inv);
    const c = {};
    this.tiles.ellipsoid.getPositionToCartographic(ecef, c);
    return { lat: c.lat / D2R, lng: c.lon / D2R };
  }

  attributions() {
    try {
      return this.tiles.getAttributions().filter((a) => a.type === 'string').map((a) => a.value).join(' · ');
    } catch {
      return '';
    }
  }

  dispose() {
    this.tiles.dispose();
  }
}

/* ======================= Sem chave: satélite + OSM ======================= */

const ESRI = (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

function lon2tile(lon, z) { return ((lon + 180) / 360) * 2 ** z; }
function lat2tile(lat, z) { const r = lat * D2R; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; }
function tile2lon(x, z) { return (x / 2 ** z) * 360 - 180; }
function tile2lat(y, z) { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return Math.atan(Math.sinh(n)) / D2R; }

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Mosaico de imagens de satélite cobrindo ±halfM metros em torno de (lat, lon). */
async function imageryLevel(lat, lon, z, halfM, signal) {
  const mpd = metersPerDegree(lat);
  const dLat = halfM / mpd.lat;
  const dLon = halfM / mpd.lon;
  const x0 = Math.floor(lon2tile(lon - dLon, z)); const x1 = Math.floor(lon2tile(lon + dLon, z));
  const y0 = Math.floor(lat2tile(lat + dLat, z)); const y1 = Math.floor(lat2tile(lat - dLat, z));
  const nx = x1 - x0 + 1; const ny = y1 - y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = nx * 256; canvas.height = ny * 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#6f7466';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    jobs.push(loadImage(ESRI(z, y, x)).then((img) => { if (img && !signal?.aborted) g.drawImage(img, (x - x0) * 256, (y - y0) * 256); }));
  }
  await Promise.all(jobs);
  const toE = (lo) => (lo - lon) * mpd.lon;
  const toN = (la) => (la - lat) * mpd.lat;
  return {
    canvas,
    west: toE(tile2lon(x0, z)), east: toE(tile2lon(x1 + 1, z)),
    north: toN(tile2lat(y0, z)), south: toN(tile2lat(y1 + 1, z)),
  };
}

function quad(level, y, uniforms) {
  const { west, east, north, south } = level;
  const g = new THREE.BufferGeometry();
  // mundo: x = -leste, z = norte
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -west, y, south, -east, y, south, -east, y, north, -west, y, north,
  ], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const tex = new THREE.CanvasTexture(level.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const base = new THREE.MeshBasicMaterial({ map: tex });
  const mat = patchMaterial(base, uniforms);
  base.dispose();
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Textura do chão da cidade-modelo: asfalto, faixas, calçadas, parques e rio. */
function demoGround(lat, lon) {
  const c = demoCity();
  const mpd = metersPerDegree(lat);
  const off = [(c.center.lng - lon) * mpd.lon, (c.center.lat - lat) * mpd.lat];
  const S = c.radius + 500;
  const W = 4096;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = W;
  const g = cv.getContext('2d');
  const X = (e) => ((e + S) / (2 * S)) * W;
  const Y = (n) => ((S - n) / (2 * S)) * W;
  const k = W / (2 * S);
  g.fillStyle = '#78736a';
  g.fillRect(0, 0, W, W);
  // textura de solo/terrenos
  for (let i = 0; i < 60000; i++) {
    const v = 95 + Math.floor(Math.random() * 40);
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.18)`;
    g.fillRect(Math.random() * W, Math.random() * W, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  const poly = (ring, fill) => {
    g.beginPath();
    ring.forEach(([e, n], i) => (i ? g.lineTo(X(e), Y(n)) : g.moveTo(X(e), Y(n))));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  c.parks.forEach((r) => poly(r, '#56703f'));
  for (let i = 0; i < 25000; i++) {
    const r = c.parks[i % c.parks.length];
    if (!r) break;
    const x = r[0][0] + Math.random() * (r[2][0] - r[0][0]);
    const y = r[0][1] + Math.random() * (r[2][1] - r[0][1]);
    g.fillStyle = Math.random() < 0.5 ? 'rgba(40,70,30,0.5)' : 'rgba(110,140,80,0.35)';
    g.beginPath(); g.arc(X(x), Y(y), 1.5 + Math.random() * 4, 0, Math.PI * 2); g.fill();
  }
  c.water.forEach((r) => poly(r, '#2f4a55'));
  // ruas: calçada clara, asfalto e faixa central nas avenidas
  const line = (coords, width, color, dash) => {
    g.beginPath();
    coords.forEach(([e, n], i) => (i ? g.lineTo(X(e), Y(n)) : g.moveTo(X(e), Y(n))));
    g.strokeStyle = color; g.lineWidth = width * k; g.setLineDash(dash ? dash.map((d) => d * k) : []);
    g.stroke();
  };
  c.roads.forEach((r) => line(r.coords, r.w + 6, '#a39d91'));
  c.roads.forEach((r) => line(r.coords, r.w, '#353638'));
  c.roads.filter((r) => r.w > 20).forEach((r) => line(r.coords, 0.5, '#d8d2b8', [6, 6]));
  g.setLineDash([]);
  return {
    canvas: cv,
    west: -S + off[0], east: S + off[0], south: -S + off[1], north: S + off[1],
  };
}

export class FallbackWorld {
  constructor({ uniforms }) {
    this.kind = 'fallback';
    this.uniforms = uniforms;
    this.object3d = new THREE.Group();
    this.ground = new THREE.Group();
    this.object3d.add(this.ground);
    this.lat = 0; this.lon = 0;
    this.loading = false;
  }

  async setOrigin(lat, lon) {
    this.lat = lat;
    this.lon = lon;
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.loading = true;
    // fundo neutro imediato enquanto as imagens chegam
    this.ground.clear();
    const fallback = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6b6f62 }));
    fallback.position.y = -1.2;
    this.ground.add(fallback);
    if (OFFLINE) {
      this.ground.add(quad(demoGround(lat, lon), 0, this.uniforms));
      this.loading = false;
      return;
    }
    const levels = [[10, 70000, -0.8], [13, 11000, -0.4], [16, 2100, 0]];
    for (const [z, half, y] of levels) {
      const lv = await imageryLevel(lat, lon, z, half, ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.ground.add(quad(lv, y, this.uniforms));
    }
    this.loading = false;
  }

  update() {}

  worldToLatLon(p) {
    const mpd = metersPerDegree(this.lat);
    return { lat: this.lat + p.z / mpd.lat, lng: this.lon - p.x / mpd.lon };
  }

  /** Projeção local usada pela malha de prédios do OSM (metros leste/norte). */
  projector() {
    const mpd = metersPerDegree(this.lat);
    const { lat, lon } = this;
    return {
      toLocal: (lng, la) => [(lng - lon) * mpd.lon, (la - lat) * mpd.lat],
      toLngLat: (x, y) => ({ lng: lon + x / mpd.lon, lat: lat + y / mpd.lat }),
      map: null,
      origin: { lng: lon, lat },
    };
  }

  attributions() {
    return OFFLINE ? 'Cidade-modelo procedural (demonstração)' : 'Imagens © Esri, Maxar, Earthstar Geographics · Prédios © colaboradores do OpenStreetMap';
  }

  dispose() {
    this.ctrl?.abort();
    this.ground.clear();
  }
}
