/**
 * Camada personalizada do MapLibre que desenha a cena three.js no MESMO contexto
 * WebGL do mapa (compartilhando o buffer de profundidade).
 *
 * Coordenadas locais da cena: metros, x = leste, y = norte, z = para cima,
 * com origem num ponto (lng, lat) escolhido — normalmente o centro dos prédios.
 */
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import { emit } from '../util/events.js';

export class SceneLayer {
  constructor(map) {
    this.id = 'sim3d';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.map = map;
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.camera.matrixAutoUpdate = false;
    this.objects = [];
    this.origin = null;
    this.terrain = false;
    this.failed = false;
    this.active = false;
    this.clock = () => -1;
    this._m = new THREE.Matrix4();
    this._l = new THREE.Matrix4();
    this._s = new THREE.Vector3();
    this.ctx = {
      tau: -1,
      now: 0,
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      viewDir: new THREE.Vector3(0, 0, -1),
      matrix: this.camera.projectionMatrix,
      bearing: 0,
      pitch: 0,
    };
  }

  setOrigin(lngLat) {
    this.origin = { lng: lngLat.lng, lat: lngLat.lat };
    this.originMerc = maplibregl.MercatorCoordinate.fromLngLat(this.origin, 0);
    this.scale = this.originMerc.meterInMercatorCoordinateUnits();
  }

  /** (lng, lat) → [x, y] em metros locais */
  toLocal(lng, lat) {
    const m = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0);
    return [(m.x - this.originMerc.x) / this.scale, -(m.y - this.originMerc.y) / this.scale];
  }

  toLngLat(x, y) {
    return new maplibregl.MercatorCoordinate(this.originMerc.x + x * this.scale, this.originMerc.y - y * this.scale, 0).toLngLat();
  }

  add(obj) {
    if (!this.objects.includes(obj)) this.objects.push(obj);
    if (obj.object3d && !obj.object3d.parent) this.scene.add(obj.object3d);
  }

  onAdd(map, gl) {
    if (this.renderer && this._gl === gl) return;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
      this._gl = gl;
    } catch (e) {
      this.failed = true;
      console.error('[3D] three.js indisponível:', e);
      emit('toast', { type: 'error', text: 'Renderização 3D avançada indisponível neste navegador (requer WebGL 2). Os anéis 2D continuam funcionando.' });
    }
  }

  onRemove() { /* o renderer é reaproveitado quando o estilo do mapa muda */ }

  /** Raio (em coordenadas locais) a partir de um ponto da tela (px CSS). */
  screenRay(px, py) {
    const c = this.map.getCanvas();
    const x = (px / c.clientWidth) * 2 - 1;
    const y = 1 - (py / c.clientHeight) * 2;
    const inv = this.camera.projectionMatrixInverse;
    const a = new THREE.Vector4(x, y, -1, 1).applyMatrix4(inv);
    const b = new THREE.Vector4(x, y, 1, 1).applyMatrix4(inv);
    a.divideScalar(a.w);
    b.divideScalar(b.w);
    const origin = new THREE.Vector3(a.x, a.y, a.z);
    const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    return { origin, dir };
  }

  render(gl, matrix) {
    if (this.failed || !this.renderer || !this.origin) return;
    const s = this.scale;
    const o = this.originMerc;
    let zOff = 0;
    if (this.terrain) zOff = this.map.queryTerrainElevation(this.origin) || 0;
    this._m.fromArray(matrix);
    this._l.makeTranslation(o.x, o.y, zOff * s).scale(this._s.set(s, -s, s));
    this.camera.projectionMatrix.multiplyMatrices(this._m, this._l);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    const b = (this.map.getBearing() * Math.PI) / 180;
    const p = (this.map.getPitch() * Math.PI) / 180;
    const ctx = this.ctx;
    ctx.bearing = b;
    ctx.pitch = p;
    ctx.right.set(Math.cos(b), -Math.sin(b), 0);
    ctx.up.set(Math.sin(b) * Math.cos(p), Math.cos(b) * Math.cos(p), Math.sin(p));
    ctx.viewDir.set(Math.sin(b) * Math.sin(p), Math.cos(b) * Math.sin(p), -Math.cos(p));
    ctx.tau = this.clock();
    ctx.now = performance.now() / 1000;
    for (const obj of this.objects) obj.update?.(ctx);

    this.renderer.resetState();
    this.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.renderer.render(this.scene, this.camera);
    if (this.active) this.map.triggerRepaint();
  }
}
