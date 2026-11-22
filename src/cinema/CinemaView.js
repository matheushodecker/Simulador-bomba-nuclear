/**
 * MODO CINEMA — motor 3D próprio (three.js + pós-processamento HDR) para ver a
 * detonação sobre cidades fotorrealistas, com:
 *  - Google Photorealistic 3D Tiles ou Cesium ion (com chave) / satélite + OSM (sem chave)
 *  - céu físico, neblina atmosférica, hora do dia
 *  - bola de fogo e cogumelo volumétricos (raymarching), bloom, tone mapping AgX
 *  - luz da bola de fogo com sombras, flash, refração da onda de choque
 *  - destruição na GPU (colapso/carbonização/incêndios), destroços em voxels, poeira, fumaça
 *  - câmera cinematográfica sincronizada com a simulação física
 */
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  SMAAEffect, VignetteEffect, NoiseEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { EnvironmentControls } from '3d-tiles-renderer';
import { Atmosphere } from './atmosphere.js';
import { VolumetricExplosionPass } from './volumetric.js';
import { AerialPerspectiveEffect, ShockRippleEffect } from './effects.js';
import { createDestructionUniforms, fillLut, buildHeightGrid } from './destruction.js';
import { TilesWorld, FallbackWorld, metersPerDegree } from './worlds.js';
import { PhysicsDebris } from './physicsDebris.js';
import { cloudState } from '../render/cloudModel.js';
import { City } from '../render/city.js';
import { Debris } from '../render/debris.js';
import { ParticleField } from '../render/particles.js';
import { buildDust, buildFires } from '../render/fxgen.js';
import { CONFIG } from '../config.js';
import { emit } from '../util/events.js';
import { smoothstep, clamp, lerp } from '../physics/math.js';
import { damageInfo } from '../physics/blast.js';
import { fmtDist, fmtSig, fmtTime } from '../util/format.js';

const QUALITY = {
  baixa: { pr: 0.75, vol: 0.33, steps: 40, light: 3, ao: false, shadow: 0, err: 24, smaa: false },
  media: { pr: 1, vol: 0.5, steps: 56, light: 4, ao: false, shadow: 1024, err: 16, smaa: true },
  alta: { pr: 1.25, vol: 0.5, steps: 72, light: 5, ao: true, shadow: 2048, err: 10, smaa: true },
  ultra: { pr: 2, vol: 0.75, steps: 96, light: 6, ao: true, shadow: 4096, err: 6, smaa: true },
};

// mundo (Y para cima, X oeste, Z norte) ↔ ENU (leste, norte, cima)
const ENU_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
const WORLD_TO_ENU = new THREE.Matrix3().set(-1, 0, 0, 0, 0, 1, 0, 1, 0);

export class CinemaView {
  constructor({ host, sim, state }) {
    this.host = host;
    this.sim = sim;
    this.state = state;
    this.active = false;
    this.ready = false;
    this.groundY = 0;
    this.groundFound = false;
    this.fx = null;
    this.cine = null;
  }

  /* --------------------------- inicialização --------------------------- */

  init() {
    if (this.ready) return true;
    const canvas = document.createElement('canvas');
    canvas.className = 'cinema-canvas';
    this.host.querySelector('.cinema-stage').appendChild(canvas);
    this.canvas = canvas;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    } catch (e) {
      emit('toast', { type: 'error', text: 'Modo cinema requer WebGL 2 com aceleração de vídeo.' });
      return false;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 200000);
    this.atmo = new Atmosphere(this.scene);
    this.uniforms = createDestructionUniforms();

    // grupo ENU (metros leste/norte/cima a partir do chão do ponto zero)
    this.enu = new THREE.Group();
    this.enu.matrixAutoUpdate = false;
    this.scene.add(this.enu);
    this.debris = new Debris();
    this.dust = new ParticleField();
    this.smoke = new ParticleField();
    this.fire = new ParticleField({ additive: true });
    [this.debris, this.dust, this.smoke, this.fire].forEach((o) => this.enu.add(o.object3d));
    this.city = null;
    this.physics = new PhysicsDebris();
    this.scene.add(this.physics.object3d);

    // luz da bola de fogo
    this.spot = new THREE.SpotLight(0xffd2a0, 0, 0, 1.45, 0.6, 0);
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.normalBias = 0.6;
    this.scene.add(this.spot, this.spot.target);
    this.point = new THREE.PointLight(0xffc890, 0, 0, 0);
    this.scene.add(this.point);

    // pós-processamento HDR
    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.aoPass = new N8AOPostPass(this.scene, this.camera, 1, 1);
    this.aoPass.configuration.aoRadius = 6;
    this.aoPass.configuration.distanceFalloff = 2;
    this.aoPass.configuration.intensity = 2.5;
    this.aoPass.configuration.halfRes = true;
    this.aoPass.configuration.gammaCorrection = false;
    composer.addPass(this.aoPass);
    this.vol = new VolumetricExplosionPass(this.camera);
    composer.addPass(this.vol);
    this.aerial = new AerialPerspectiveEffect();
    composer.addPass(new EffectPass(this.camera, this.aerial));
    this.shockFx = new ShockRippleEffect();
    this.shockPass = new EffectPass(this.camera, this.shockFx);
    composer.addPass(this.shockPass);
    // limiar alto: só o que é realmente incandescente (bola de fogo, chamas) gera brilho
    this.bloom = new BloomEffect({ mipmapBlur: true, intensity: 2.0, luminanceThreshold: 2.4, luminanceSmoothing: 0.6, radius: 0.85 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ darkness: 0.42, offset: 0.32 });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    grain.blendMode.opacity.value = 0.035;
    composer.addPass(new EffectPass(this.camera, this.bloom, this.tone, vignette, grain));
    this.smaaPass = new EffectPass(this.camera, new SMAAEffect());
    composer.addPass(this.smaaPass);
    this.composer = composer;

    // controles de câmera (arrastar = mover, botão direito/ctrl = girar, roda = zoom no cursor)
    this.controls = new EnvironmentControls(this.scene, this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 400000;
    this.controls.useFallbackPlane = true;
    this.controls.adjustHeight = true;

    this.clock = new THREE.Clock();
    this._frame = this._frame.bind(this);
    window.addEventListener('resize', () => this.resize());
    this._bindPointer();
    this.ready = true;
    this.applyQuality();
    return true;
  }

  applyQuality() {
    if (!this.ready) return;
    const q = QUALITY[this.state.quality] || QUALITY.media;
    this.q = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    this.aoPass.enabled = q.ao;
    this.smaaPass.enabled = q.smaa;
    this.vol.resolutionScale = q.vol;
    this.vol.uniforms.uSteps.value = q.steps;
    this.vol.uniforms.uLightSteps.value = q.light;
    this.spot.castShadow = q.shadow > 0;
    if (q.shadow) this.spot.shadow.mapSize.set(q.shadow, q.shadow);
    if (this.world?.tiles) this.world.tiles.errorTarget = q.err;
    this.resize();
  }

  resize() {
    if (!this.ready) return;
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ----------------------------- mundo ----------------------------- */

  /** Escolhe o mundo conforme a chave: Google/Cesium (fotorrealista) ou satélite + OSM. */
  setWorld() {
    const { provider, key } = this.state.cinema;
    const want = !this.forceFallback && provider !== 'none' && key ? `${provider}:${key}` : 'fallback';
    if (this.worldKey === want) return;
    if (this.world) {
      this.scene.remove(this.world.object3d);
      this.world.dispose();
    }
    this.worldKey = want;
    if (want === 'fallback') {
      this.world = new FallbackWorld({ uniforms: this.uniforms });
    } else {
      this.world = new TilesWorld({ provider, key, uniforms: this.uniforms, camera: this.camera, renderer: this.renderer, errorTarget: this.q.err });
    }
    this.scene.add(this.world.object3d);
    this.controls.setScene(this.world.object3d);
    this.origin = null;
    this.setOrigin(this.state.gz, true);
  }

  setOrigin(gz, resetCamera = false) {
    if (!this.world || !gz) return;
    const prev = this.origin;
    this.origin = { ...gz };
    this.world.setOrigin(gz.lat, gz.lng);
    this.groundFound = this.world.kind === 'fallback';
    this.setGroundY(0);
    if (this.city) { this.enu.remove(this.city.object3d); this.city.dispose(); this.city = null; }
    if (this.world.kind === 'fallback' && this.pendingBuildings) this.setBuildings(this.pendingBuildings);
    const far = !prev || Math.hypot(prev.lat - gz.lat, prev.lng - gz.lng) > 0.05;
    if (resetCamera || far) this.resetCamera();
  }

  setGroundY(y) {
    this.groundY = y;
    this.uniforms.uDGroundY.value = y;
    this.enu.matrix.copy(ENU_BASIS).setPosition(0, y, 0);
    this.enu.matrixWorldNeedsUpdate = true;
    this.controls.fallbackPlane?.set(new THREE.Vector3(0, 1, 0), -y);
  }

  /** Prédios do OSM (modo sem chave). */
  setBuildings(list) {
    this.pendingBuildings = list;
    if (this.ready && this.world?.kind === 'tiles' && this.fx) this._preparePhysics();
    if (!this.ready || this.world?.kind !== 'fallback') return;
    if (this.city) { this.enu.remove(this.city.object3d); this.city.dispose(); }
    const city = new City(this.world.projector());
    city.setBuildings(list);
    city.gammaOut = 2.2;
    city.emissiveBoost = 4;
    city.tint = this.state.tint ? 0.85 : 0;
    this.city = city;
    this.enu.add(city.object3d);
    if (this.fx) this._applyFxToBuildings();
  }

  enuToWorld(e, n, u) { return new THREE.Vector3(-e, u + this.groundY, n); }
  worldToENU(v) { return [-v.x, v.z, v.y - this.groundY]; }

  resetCamera() {
    const p = this.enuToWorld(-1100, -1500, 520);
    this.camera.position.copy(p);
    this.camera.lookAt(this.enuToWorld(0, 0, 60));
    this.camera.updateMatrixWorld();
    this.controls.resetState?.();
  }

  /** Procura o chão no ponto zero lançando um raio vertical nos tiles carregados. */
  _detectGround() {
    if (this.groundFound || this.world?.kind !== 'tiles') return;
    const now = performance.now();
    if (this._lastGroundTry && now - this._lastGroundTry < 500) return;
    this._lastGroundTry = now;
    const rc = new THREE.Raycaster(new THREE.Vector3(0, 9000, 0), new THREE.Vector3(0, -1, 0), 0, 20000);
    // amostra uma pequena vizinhança e fica com o ponto mais baixo (rua, não telhado)
    let best = Infinity;
    for (const [dx, dz] of [[0, 0], [25, 0], [-25, 0], [0, 25], [0, -25], [40, 40], [-40, -40], [40, -40], [-40, 40]]) {
      rc.ray.origin.set(dx, 9000, dz);
      const hit = rc.intersectObject(this.world.object3d, true)[0];
      if (hit) best = Math.min(best, hit.point.y);
    }
    if (Number.isFinite(best)) {
      const firstTime = !this.groundFound;
      this.groundFound = true;
      const dy = best - this.groundY;
      this.setGroundY(best);
      if (firstTime && !this.fx) { this.camera.position.y += dy; this.camera.updateMatrixWorld(); }
    }
  }

  /* --------------------------- ativação --------------------------- */

  activate() {
    if (!this.init()) return false;
    this.active = true;
    this.host.hidden = false;
    this.sim.cinemaActive = true;
    this.applyQuality();
    this.atmo.set(this.state.cinema.timeOfDay);
    this.setWorld();
    if (!this.origin || this.origin.lat !== this.state.gz.lat || this.origin.lng !== this.state.gz.lng) this.setOrigin(this.state.gz);
    if (this.sim.fx && !this.fx) this.onDetonate({ fx: this.sim.fx, gz: this.sim.gz, accel: this.sim.accel });
    this.clock.getDelta();
    requestAnimationFrame(this._frame);
    return true;
  }

  deactivate() {
    this.active = false;
    this.host.hidden = true;
    this.sim.cinemaActive = false;
    this.cine = null;
  }

  setTimeOfDay(mode) {
    if (this.ready) this.atmo.set(mode);
  }

  /* ------------------------ detonação ------------------------ */

  /**
   * Prepara a cena antes da detonação: enquadra a câmera e mede a cidade
   * (grade de alturas). Retorna quando o "pré-roll" termina.
   */
  async prepare(fx) {
    if (!this.active) return;
    const R = clamp(Math.max(fx.radius.blast5 * 1.6, 2.0) * 1000, 2000, 80000);
    const az = this._cameraAzimuth();
    const dist = R;
    const camENU = [Math.sin(az) * -dist, Math.cos(az) * -dist, Math.max(dist * 0.16, 160)];
    const look = [0, 0, Math.min(fx.cloud.topKm * 1000 * 0.12, dist * 0.2)];
    if (this.state.cinematic) await this._flyTo(camENU, look, 1400);
    this._measureCity(fx);
  }

  _cameraAzimuth() {
    const [e, n] = this.worldToENU(this.camera.position);
    const len = Math.hypot(e, n);
    return len > 1 ? Math.atan2(-e, -n) : Math.PI * 0.2;
  }

  _flyTo(camENU, lookENU, ms) {
    const fromP = this.camera.position.clone();
    const fromQ = this.camera.quaternion.clone();
    const toP = this.enuToWorld(...camENU);
    const m = new THREE.Matrix4().lookAt(toP, this.enuToWorld(...lookENU), new THREE.Vector3(0, 1, 0));
    const toQ = new THREE.Quaternion().setFromRotationMatrix(m);
    this.controls.enabled = false;
    return new Promise((resolve) => {
      const t0 = performance.now();
      this.fly = (now) => {
        const k = smoothstep(0, 1, (now - t0) / ms);
        this.camera.position.lerpVectors(fromP, toP, k);
        this.camera.quaternion.slerpQuaternions(fromQ, toQ, k);
        if (k >= 1) { this.fly = null; resolve(); }
      };
    });
  }

  _measureCity(fx) {
    if (this.world?.kind !== 'tiles') return;
    const R = clamp(fx.radius.blast3 * 1.15 * 1000, 600, 12000);
    const t0 = performance.now();
    const res = buildHeightGrid(this.uniforms, this.world.object3d, (v) => this.worldToENU(v), R);
    this.grid = res.grid;
    console.info(`[cinema] grade de alturas: ${res.count} vértices em ${Math.round(performance.now() - t0)} ms`);
  }

  /** "Prédios" sintéticos a partir da grade de alturas (para destroços/poeira nos tiles). */
  _syntheticBuildings(fx, accel) {
    const g = this.grid;
    if (!g) return [];
    const out = [];
    const cell = (2 * g.R) / g.N;
    for (let y = 0; y < g.N; y++) for (let x = 0; x < g.N; x++) {
      const k = y * g.N + x;
      const top = g.top[k]; const base = g.ground[k];
      if (!Number.isFinite(top) || top - base < 5) continue;
      const e = ((x + 0.5) / g.N - 0.5) * 2 * g.R;
      const n = ((y + 0.5) / g.N - 0.5) * 2 * g.R;
      const dKm = Math.hypot(e, n) / 1000;
      const h = cell / 2;
      out.push({
        c: [e, n], area: cell * cell * 0.45, top, base, bbox: [e - h, n - h, e + h, n + h],
        outer: [[e - h, n - h], [e + h, n - h], [e + h, n + h], [e - h, n + h]], holes: [],
        dKm, psi: fx.psiAt(dKm), level: fx.damageLevelAt(dKm), arrival: fx.arrivalAt(dKm) / accel, burn: fx.burnDegreeAt(dKm),
        src: { color: [0.62, 0.6, 0.57] },
      });
    }
    return out;
  }

  onDetonate({ fx, gz, accel }) {
    if (!this.ready) return;
    this.fx = fx;
    this.accel = accel;
    if (!this.origin || this.origin.lat !== gz.lat || this.origin.lng !== gz.lng) this.setOrigin(gz);
    fillLut(this.uniforms, fx, accel);
    if (this.world?.kind === 'tiles' && !this.grid) this._measureCity(fx);
    this._applyFxToBuildings();
    this._preparePhysics();
    const down = (((this.sim.params?.wind?.fromDeg ?? 270) + 180) % 360) * (Math.PI / 180);
    const ws = (this.sim.params?.wind?.speedKmh ?? 24) / 3.6;
    this.windENU = [Math.sin(down) * ws * 4, Math.cos(down) * ws * 4];
    this.dust.setWind(this.windENU[0] * 0.3, this.windENU[1] * 0.3);
    this.smoke.setWind(this.windENU[0] * 0.6, this.windENU[1] * 0.6);
    this.shakeDone = false;
    if (this.state.cinematic) this._startCinematic(fx);
  }

  _applyFxToBuildings() {
    const fx = this.fx;
    const q = CONFIG.quality[this.state.quality] || CONFIG.quality.media;
    let blds = [];
    if (this.city?.loaded) {
      this.city.applyDetonation(fx, [0, 0], this.accel);
      blds = this.city.buildings;
    } else if (this.world?.kind === 'tiles') {
      blds = this._syntheticBuildings(fx, this.accel);
    }
    // metade dos voxels "baratos": os pedaços com física rígida cuidam do primeiro plano
    this.debris.generate(blds, [0, 0], Math.round(q.debris * 0.5), fx.radius.fireball);
    buildDust(this.dust, { fx, gz: [0, 0], accel: this.accel, buildings: blds, count: q.dust });
    buildFires(this.fire, this.smoke, { fx, gz: [0, 0], buildings: blds, count: q.fire });
  }

  /** Contornos do OSM convertidos para ENU, com chão/topo ajustados à malha medida. */
  _osmRecords(fx, accel) {
    const list = this.pendingBuildings;
    if (!list?.length || !this.origin) return [];
    const mpd = metersPerDegree(this.origin.lat);
    const toENU = ([lng, lat]) => [(lng - this.origin.lng) * mpd.lon, (lat - this.origin.lat) * mpd.lat];
    const g = this.grid;
    const groundAt = (e, n) => {
      if (!g) return 0;
      const x = Math.floor(((e / g.R) * 0.5 + 0.5) * g.N);
      const y = Math.floor(((n / g.R) * 0.5 + 0.5) * g.N);
      return x >= 0 && y >= 0 && x < g.N && y < g.N ? g.ground[y * g.N + x] : 0;
    };
    return list.map((b) => {
      const outer = b.outer.map(toENU);
      outer.pop();
      let cx = 0; let cy = 0;
      for (const [x, y] of outer) { cx += x; cy += y; }
      cx /= outer.length; cy /= outer.length;
      const base = groundAt(cx, cy) + (b.minHeight || 0);
      const dKm = Math.hypot(cx, cy) / 1000;
      return {
        c: [cx, cy], outer, holes: (b.holes || []).map((h) => h.map(toENU)), base, top: base + b.height,
        dKm, psi: fx.psiAt(dKm), level: fx.damageLevelAt(dKm), arrival: fx.arrivalAt(dKm) / accel, color: b.color,
      };
    });
  }

  async _preparePhysics() {
    const fx = this.fx;
    if (!fx) return;
    let blds;
    if (this.city?.loaded) blds = this.city.buildings.map((b) => ({ ...b, color: b.src.color }));
    else if (this.world?.kind === 'tiles') {
      const osm = this._osmRecords(fx, this.accel);
      blds = osm.length ? osm : this._syntheticBuildings(fx, this.accel).map((b) => ({ ...b, color: b.src.color }));
    } else blds = [];
    // foco: ponto entre a câmera e o ponto zero, dentro da zona de colapso
    const [e, n] = this.worldToENU(this.camera.position);
    const dCam = Math.hypot(e, n) || 1;
    const k = Math.min(0.55, (fx.radius.blast5 * 1000 * 0.7) / dCam);
    try {
      const count = await this.physics.prepare({
        buildings: blds, enuToWorld: (a, b, c) => this.enuToWorld(a, b, c), focus: [e * k, n * k],
        grid: this.grid, groundY: this.groundY, quality: this.state.quality,
      });
      console.info(`[cinema] física: ${count} pedaços de prédios`);
    } catch (err) {
      console.warn('[cinema] física indisponível', err);
    }
  }

  onClear() {
    this.physics?.dispose();
    this.fx = null;
    this.grid = null;
    this.cine = null;
    if (!this.ready) return;
    this.uniforms.uDTime.value = -1;
    this.debris.clear(); this.dust.clear(); this.smoke.clear(); this.fire.clear();
    this.city?.reset();
    this.vol.enabled = false;
    this.spot.intensity = 0; this.point.intensity = 0;
    this.controls.enabled = true;
  }

  /* --------------------- câmera cinematográfica --------------------- */

  _startCinematic(fx) {
    const az = this._cameraAzimuth();
    const d0 = this.camera.position.clone();
    const [e0, n0, u0] = this.worldToENU(d0);
    const dist0 = Math.hypot(e0, n0) || 1500;
    const top = fx.cloud.topKm * 1000;
    const dist1 = clamp(Math.max(top * 1.9, dist0 * 1.2), dist0, 250000);
    this.cine = { t0: null, az, dist0, u0, dist1, top };
    this.controls.enabled = false;
  }

  _updateCinematic(tau) {
    const c = this.cine;
    if (!c || tau < 0) return;
    // 0–8 s: leve dolly-in e órbita; depois recua para enquadrar o cogumelo
    const orbit = c.az + tau * 0.012;
    const pull = smoothstep(1.5, 11, tau);
    const dist = lerp(c.dist0 * (1 - 0.06 * smoothstep(0, 6, tau)), c.dist1, pull);
    const camU = lerp(c.u0, Math.max(dist * 0.1, c.u0), pull);
    const lookU = lerp(Math.min(c.top * 0.12, c.dist0 * 0.2), c.top * 0.5, pull);
    const p = this.enuToWorld(Math.sin(orbit) * -dist, Math.cos(orbit) * -dist, camU);
    this.camera.position.copy(p);
    this.camera.lookAt(this.enuToWorld(0, 0, lookU));
    if (tau > 45) { this.cine = null; this.controls.enabled = true; }
  }

  /* ----------------------------- quadro ----------------------------- */

  _frame() {
    if (!this.active) return;
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.1, this.clock.getDelta());
    const now = performance.now();
    const tau = this.fx && this.sim.fx === this.fx ? this.sim.tau : -1;

    if (this.fly) this.fly(now);
    else if (this.cine) this._updateCinematic(tau);
    else this.controls.update(dt);
    this._applyShake(tau);
    this._updateClip();
    this.camera.updateMatrixWorld();
    this.world?.update(this.camera, this.renderer);
    this._detectGround();
    this._updateEffects(tau, now / 1000);
    this.atmo.follow(this.camera);
    this.aerial.sync(this.camera);
    this.shockFx.sync(this.camera);
    this.composer.render(dt);
    if (!this._lastHud || now - this._lastHud > 700) { this._lastHud = now; this._updateOverlay(); }
  }

  _updateClip() {
    const cam = this.camera;
    const h = Math.max(1, cam.position.y - this.groundY);
    const near = clamp(h * 0.01, 0.5, 60);
    const far = clamp(h * 120 + 40000, 60000, 1200000);
    if (Math.abs(cam.near - near) / near > 0.2 || Math.abs(cam.far - far) / far > 0.2) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  _applyShake(tau) {
    if (!this.fx || tau < 0 || this.shakeDone === true) return;
    const [e, n] = this.worldToENU(this.camera.position);
    const dKm = Math.hypot(e, n) / 1000;
    const arr = this.fx.arrivalAt(dKm) / this.accel;
    if (tau < arr) return;
    const k = tau - arr;
    if (k > 1.6) { this.shakeDone = true; return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const psi = this.fx.psiAt(dKm);
    const amp = clamp(Math.log10(psi + 1), 0.05, 1) * 0.012 * Math.exp(-k * 2.2);
    this.camera.rotateX((Math.random() - 0.5) * amp);
    this.camera.rotateY((Math.random() - 0.5) * amp);
  }

  _updateEffects(tau, now) {
    const atmo = this.atmo;
    const p = atmo.p;
    const u = this.uniforms;
    u.uDTime.value = tau;
    u.uDNow.value = now;
    // neblina e flash
    this.aerial.uniforms.get('uGroundY').value = this.groundY;
    this.aerial.uniforms.get('uDensity').value = p.fogDensity;
    this.aerial.uniforms.get('uFogColor').value.setRGB(...p.fog);
    this.aerial.uniforms.get('uSunFog').value.setRGB(...p.sunFog);
    this.aerial.uniforms.get('uSunDirW').value.copy(atmo.sunDir);
    this.renderer.toneMappingExposure = p.exposure;

    // parâmetros comuns dos objetos ENU
    const rightW = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const upW = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const ctx = {
      tau, now,
      right: new THREE.Vector3(-rightW.x, rightW.z, rightW.y),
      up: new THREE.Vector3(-upW.x, upW.z, upW.y),
      matrix: this.camera.projectionMatrix,
    };
    for (const o of [this.debris, this.dust, this.smoke, this.fire]) {
      if (o.uniforms.uLightScale) {
        o.uniforms.uLightScale.value = Math.max(0.12, p.ambient);
        o.uniforms.uGammaOut.value = 2.2;
        o.uniforms.uEmissiveBoost.value = 4;
      }
      if (o.uniforms.uSunDir) o.uniforms.uSunDir.value.copy(atmo.sunDirENU);
      o.update(ctx);
    }

    const fx = this.fx;
    if (!fx || tau < 0) {
      this.vol.enabled = false;
      this.spot.intensity = 0;
      this.point.intensity = 0;
      this.aerial.uniforms.get('uFlash').value = 0;
      this.shockFx.uniforms.get('uStrength').value = 0;
      this.shockFx.uniforms.get('uWilson').value = 0;
      if (this.city) { this.city.lightScale = Math.max(0.1, p.ambient); this.city.update({ tau: -1, now }); }
      return;
    }
    const cs = cloudState(fx, tau, this.sim.tFb || 1);
    const reduce = this.state.reduceFlash;

    // flash e luz da bola de fogo
    const flash = Math.exp(-tau / 0.12) * (reduce ? 0.25 : 2.2);
    this.aerial.uniforms.get('uFlash').value = flash;
    const L = (2.2 * Math.exp(-tau / 0.6) + 0.9 * Math.exp(-tau / ((this.sim.tFb || 1) * 3 + 2))) * Math.max(cs.fbAmt, 0.15);
    const firePos = this.enuToWorld(0, 0, cs.fbZ + cs.fbR * 0.3);
    const airburst = !cs.surface;
    const I = L * 40 * (reduce ? 0.6 : 1);
    if (airburst) {
      this.spot.intensity = I;
      this.spot.position.copy(firePos);
      this.spot.target.position.copy(this.enuToWorld(0, 0, 0));
      this.spot.target.updateMatrixWorld();
      this.spot.shadow.camera.near = Math.max(10, cs.fbR * 0.5);
      this.spot.shadow.camera.far = Math.max(cs.fbZ * 12, 20000);
      this.renderer.shadowMap.autoUpdate = this.spot.castShadow && I > 0.5;
      this.point.intensity = 0;
    } else {
      this.spot.intensity = 0;
      this.point.intensity = I * 1.2;
      this.point.position.copy(firePos);
      this.renderer.shadowMap.autoUpdate = false;
    }
    u.uDFire.value = 1;

    this.physics.update(tau);

    // nuvem volumétrica
    const vu = this.vol.uniforms;
    this.vol.enabled = true;
    vu.uTime.value = tau;
    vu.uCap.value.set(cs.H, cs.Rt, cs.rt, cs.stemR);
    vu.uStem.value.set(cs.stemTop, cs.stemGrow, cs.skirtR, cs.skirtAmt);
    vu.uFire.value.set(cs.fbZ, Math.max(cs.fbR, 1), cs.fbTemp, cs.fbAmt);
    const alpha = clamp(Math.max(cs.appear, cs.fbAmt), 0, 1) * cs.late;
    vu.uMisc.value.set(cs.heat, alpha, Math.max(cs.rt * 0.5, 12), 4.5);
    const w = this.windENU || [0, 0];
    vu.uDrift.value.set(w[0] * cs.drift, w[1] * cs.drift);
    vu.uCamENU.value.set(...this.worldToENU(this.camera.position));
    vu.uWorldToENU.value.copy(WORLD_TO_ENU);
    vu.uSunDir.value.copy(atmo.sunDirENU);
    vu.uSunColor.value.setRGB(...p.sun);
    vu.uSkyColor.value.setRGB(...p.sky);
    vu.uGroundColor.value.setRGB(...p.ground);
    vu.uFogColor.value.setRGB(...p.fog);
    vu.uFogDensity.value = p.fogDensity * 0.6;
    vu.uDust.value = cs.surface ? 1 : 0.25;
    vu.uCapAmt.value = cs.appear;
    vu.uEmission.value = reduce ? 12 : 42;

    // onda de choque: refração + nuvem de condensação
    const tPhys = tau * this.accel;
    const sKm = fx.slantAt(tPhys);
    const rKm = fx.frontAt(tPhys);
    const end = Math.hypot(fx.radius.blast1 * 1.1, fx.hKm);
    const psi = rKm > 0 ? fx.psiAt(rKm) : 1000;
    const fade = 1 - smoothstep(end * 0.7, end, sKm);
    const su = this.shockFx.uniforms;
    const center = this.enuToWorld(0, 0, fx.hKm * 1000);
    su.get('uCenter').value.copy(center);
    su.get('uRadius').value = sKm * 1000;
    su.get('uWidth').value = Math.max(10, sKm * 1000 * 0.018);
    su.get('uWilsonLight').value = Math.min(1.1, p.ambient + L * 0.4);
    su.get('uStrength').value = sKm < end ? clamp(Math.log10(psi + 1) / 1.1, 0, 1.2) * fade : 0;
    su.get('uWilson').value = sKm < end ? smoothstep(0.7, 2, psi) * (1 - smoothstep(6, 15, psi)) * fade : 0;
    su.get('uGroundY').value = this.groundY;
    const sc = center.clone().project(this.camera);
    su.get('uCenterUv').value.set(sc.x * 0.5 + 0.5, sc.y * 0.5 + 0.5);

    // poeira rasteira: muro que acompanha a frente de choque + camada sobre a área destruída
    const scale = clamp(Math.cbrt(fx.yieldKt) / 2.5, 0.6, 6) * (cs.surface ? 1.3 : 1);
    const frontM = rKm * 1000;
    const wallAmt = rKm > 0 ? clamp(Math.log10(psi + 1) / 0.9, 0, 1) * (1 - smoothstep(fx.radius.blast3, fx.radius.blast1, rKm)) : 0;
    const settleR = Math.min(frontM, fx.radius.blast3 * 1000 * 1.1);
    const settleAmt = 0.45 * smoothstep(0.5, 3, tau) * (1 - smoothstep(90, 240, tau)) * (cs.surface ? 1.3 : 1);
    vu.uDustA.value.set(frontM, Math.max(30, frontM * 0.1), Math.min(400, (20 + 0.02 * frontM) * Math.min(scale, 2.5)), wallAmt);
    vu.uDustB.value.set(settleR, (8 + 55 * (1 - Math.exp(-tau / 15))) * scale, settleR > 10 ? settleAmt : 0, Math.max(frontM * (wallAmt > 0 ? 1.08 : 0), settleR) + 60);

    if (this.city) {
      this.city.lightScale = Math.max(0.1, p.ambient);
      this.city.tint = this.state.tint ? 0.85 : 0;
      this.city.flash = Math.min(1, flash * 0.4);
      this.city.fire.pos.set(0, 0, cs.fbZ);
      this.city.fire.light = L * 1.5;
      this.city.fire.range = Math.max(cs.fbR * 6, 600);
      this.city.update({ tau, now });
    }
  }

  /* --------------------------- interação --------------------------- */

  _bindPointer() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.cine || this.fly) { this.cine = null; this.fly = null; this.controls.enabled = true; }
    });
    this.canvas.addEventListener('wheel', () => {
      if (this.cine) { this.cine = null; this.controls.enabled = true; }
    }, { passive: true });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 400;
      down = null;
      if (moved > 6 || !quick || e.button !== 0) return;
      this._click(e);
    });
  }

  _click(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hit = rc.intersectObject(this.world.object3d, true)[0];
    let point = hit?.point;
    if (!point) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.groundY);
      point = rc.ray.intersectPlane(plane, new THREE.Vector3());
    }
    if (!point) return;
    if (this.state.clickMode === 'inspect') this._inspect(point, e);
    else {
      const ll = this.world.worldToLatLon(point);
      // mantém a câmera no mesmo lugar relativo ao terreno ao recentrar
      this.camera.position.sub(new THREE.Vector3(point.x, 0, point.z));
      this.camera.updateMatrixWorld();
      this.origin = { lat: ll.lat, lng: ll.lng };
      emit('cinema-pick', ll);
    }
  }

  _inspect(point, e) {
    const [ee, nn, uu] = this.worldToENU(point);
    const fx = this.fx || this.previewFx?.();
    const box = this.host.querySelector('.cinema-info');
    if (!fx) return;
    const d = Math.hypot(ee, nn) / 1000;
    const psi = fx.psiAt(d);
    const di = damageInfo(fx.damageLevelAt(d));
    const q = fx.thermalFluenceAt(d);
    const rem = fx.radiationDoseAt(d);
    box.innerHTML = `<button class="icon-btn" aria-label="Fechar">✕</button>
      <b>Ponto inspecionado</b> <span class="muted">${this.fx ? '' : '(prévia)'}</span>
      <table>
        <tr><td>Distância</td><td class="num">${fmtDist(d)}</td></tr>
        <tr><td>Altura local</td><td class="num">${fmtSig(uu, 3)} m</td></tr>
        <tr><td>Sobrepressão</td><td class="num"><b>${psi > 200 ? '> 200' : fmtSig(psi, 3)} psi</b></td></tr>
        <tr><td>Chegada da onda</td><td class="num">${fmtTime(fx.arrivalAt(d))}</td></tr>
        <tr><td>Fluência térmica</td><td class="num">${q > 1000 ? '> 1000' : fmtSig(q, 2)} cal/cm²</td></tr>
        <tr><td>Radiação inicial</td><td class="num">${rem > 1e5 ? '> 100.000' : fmtSig(rem, 2)} rem</td></tr>
      </table>
      <div><span class="lvl" style="background:${di.color}">${di.label}</span> <span class="small">${di.desc}</span></div>`;
    const r = this.host.getBoundingClientRect();
    box.style.left = `${Math.min(r.width - 300, e.clientX - r.left + 12)}px`;
    box.style.top = `${Math.min(r.height - 220, e.clientY - r.top + 12)}px`;
    box.hidden = false;
    box.querySelector('button').onclick = () => { box.hidden = true; };
  }

  _updateOverlay() {
    const attr = this.host.querySelector('.cinema-attrib');
    const status = this.host.querySelector('.cinema-status');
    if (!this.world) return;
    attr.textContent = this.world.kind === 'tiles'
      ? `${this.world.provider === 'google' ? 'Google' : 'Cesium ion · Google'} · ${this.world.attributions()}`
      : this.world.attributions();
    const loading = this.world.loading;
    status.hidden = !loading;
    status.textContent = this.world.kind === 'tiles' ? `Carregando cidade 3D… ${Math.round((this.world.tiles.loadProgress || 0) * 100)}%` : 'Carregando imagens de satélite…';
  }
}

/** Distância horizontal (km) da câmera ao ponto zero — usada para o som. */
CinemaView.prototype.cameraDistKm = function cameraDistKm() {
  if (!this.ready) return 0;
  const [e, n] = this.worldToENU(this.camera.position);
  return Math.hypot(e, n) / 1000;
};

/** Cai para o modo sem chave (ex.: chave inválida). */
CinemaView.prototype.useFallback = function useFallback() {
  if (!this.ready || this.worldKey === 'fallback') return;
  this.forceFallback = true;
  this.setWorld();
};
