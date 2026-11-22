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

/** Metros por grau (elipsoide WGS-84, aproximação usual). */
export function metersPerDegree(latDeg) {
  const p = latDeg * D2R;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}

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
    return 'Imagens © Esri, Maxar, Earthstar Geographics · Prédios © colaboradores do OpenStreetMap';
  }

  dispose() {
    this.ctrl?.abort();
    this.ground.clear();
  }
}
