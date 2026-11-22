/**
 * Destroços com FÍSICA DE CORPO RÍGIDO (Rapier, WebAssembly).
 *
 * Os prédios atingidos (contornos reais do OSM ou blocos medidos na malha 3D) são
 * fatiados em pedaços — andares e colunas — que viram corpos rígidos no instante em
 * que a onda de choque chega: são empurrados para longe do ponto zero conforme a
 * sobrepressão, caem com a gravidade, colidem entre si e com o chão e se amontoam.
 *
 * O motor de física só é baixado quando necessário (import dinâmico, ~1,5 MB gz).
 * Coordenadas: mundo do three.js (Y para cima, X oeste, Z norte).
 */
import * as THREE from 'three';
import { pointInRing } from '../map/geo.js';

const BUDGET = { baixa: 350, media: 1100, alta: 2400, ultra: 4200 };

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

let RAPIER = null;
async function loadRapier() {
  if (!RAPIER) {
    const mod = await import('@dimforge/rapier3d-compat');
    await mod.init();
    RAPIER = mod;
  }
  return RAPIER;
}

const CHUNK_FRAG = /* glsl */ `
float chHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
`;

export class PhysicsDebris {
  constructor() {
    this.object3d = new THREE.Group();
    this.object3d.name = 'physics-debris';
    this.mesh = null;
    this.world = null;
    this.chunks = [];
    this.lastTau = -1;
    this.acc = 0;
    this.token = 0;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, color: 0xffffff });
    mat.onBeforeCompile = (shader) => {
      // textura procedural de concreto quebrado (manchas, arestas escuras)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vChLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvChLocal = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vChLocal;\n${CHUNK_FRAG}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float n = chHash(floor(vChLocal * 6.0 + vColor.rgb * 31.0));
            vec3 a = abs(vChLocal) * 2.0;
            float edge = smoothstep(0.82, 1.0, max(max(min(a.x, a.y), min(a.y, a.z)), min(a.x, a.z)));
            diffuseColor.rgb *= (0.78 + 0.32 * n) * (1.0 - 0.45 * edge);
          }`);
    };
    this.material = mat;
  }

  dispose() {
    this.token++;
    if (this.world) { this.world.free(); this.world = null; }
    if (this.mesh) {
      this.object3d.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.chunks = [];
  }

  /**
   * Fatia os prédios e prepara o mundo físico.
   * @param {object} o
   * @param {Array} o.buildings registros ENU: {c, outer, holes, base, top, level, psi, arrival, dKm, color?}
   * @param {(e:number,n:number,u:number)=>THREE.Vector3} o.enuToWorld
   * @param {[number,number]} o.focus ponto ENU prioritário (perto da câmera)
   * @param {{ground:Float32Array, N:number, R:number}|null} o.grid chão medido (ENU, relativo)
   * @param {number} o.groundY altura do chão no ponto zero (mundo)
   * @param {string} o.quality
   */
  async prepare(o) {
    this.dispose();
    const token = this.token;
    const R = await loadRapier();
    if (token !== this.token) return 0;
    const budget = BUDGET[o.quality] || BUDGET.media;
    const cand = o.buildings
      .filter((b) => b.level >= 3 && b.top - b.base > 3)
      .map((b) => ({ b, d: Math.hypot(b.c[0] - o.focus[0], b.c[1] - o.focus[1]) }))
      .sort((a, b) => a.d - b.d);
    const rand = rng(97531);
    const chunks = [];
    for (const { b } of cand) {
      if (chunks.length >= budget) break;
      this._slice(b, Math.min(140, budget - chunks.length), rand, chunks);
    }
    if (!chunks.length) return 0;

    const world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    // chão: blocos estáticos na altura medida (ou um plano, sem grade)
    if (o.grid) {
      const { ground, N, R: gr } = o.grid;
      const B = 4;
      const cell = (2 * gr) / N;
      for (let by = 0; by < N; by += B) for (let bx = 0; bx < N; bx += B) {
        let m = Infinity;
        for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) m = Math.min(m, ground[y * N + x]);
        if (!Number.isFinite(m)) continue;
        const e = ((bx + B / 2) / N - 0.5) * 2 * gr;
        const n = ((by + B / 2) / N - 0.5) * 2 * gr;
        const p = o.enuToWorld(e, n, m - 4);
        world.createCollider(R.ColliderDesc.cuboid((cell * B) / 2, 4, (cell * B) / 2).setTranslation(p.x, p.y, p.z).setFriction(0.9));
      }
    } else {
      world.createCollider(R.ColliderDesc.cuboid(20000, 5, 20000).setTranslation(0, o.groundY - 5, 0).setFriction(0.9));
    }

    // malha instanciada (um cubo unitário escalado por pedaço)
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, this.material, chunks.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color();
    chunks.forEach((c, i) => {
      // posição no mundo
      const wp = o.enuToWorld(c.e, c.n, c.u);
      c.pos = wp;
      // eixo local x do bloco = direção da fachada (ENU) → mundo: rotação de π + ângulo em Y
      c.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + c.angle);
      c.size = new THREE.Vector3(c.hx * 2, c.hz * 2, c.hy * 2);
      mesh.setMatrixAt(i, zero);
      col.setRGB(c.color[0], c.color[1], c.color[2], THREE.SRGBColorSpace);
      mesh.setColorAt(i, col);
    });
    mesh.instanceColor.needsUpdate = true;
    this.object3d.add(mesh);
    this.mesh = mesh;
    this.world = world;
    this.R = R;
    this.chunks = chunks.sort((a, b) => a.t - b.t);
    this.next = 0;
    this.lastTau = -1;
    this.acc = 0;
    this._m = m;
    return chunks.length;
  }

  /** Divide um prédio em colunas × andares alinhados à sua maior fachada. */
  _slice(b, maxN, rand, out) {
    const ring = b.outer;
    // orientação pela aresta mais longa
    let best = 0; let ang = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]; const q = ring[(i + 1) % ring.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L > best) { best = L; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
    }
    const ca = Math.cos(ang); const sa = Math.sin(ang);
    const [cx, cy] = b.c;
    let minA = Infinity; let maxA = -Infinity; let minB = Infinity; let maxB = -Infinity;
    for (const [x, y] of ring) {
      const a = (x - cx) * ca + (y - cy) * sa;
      const bb = -(x - cx) * sa + (y - cy) * ca;
      minA = Math.min(minA, a); maxA = Math.max(maxA, a); minB = Math.min(minB, bb); maxB = Math.max(maxB, bb);
    }
    const H = b.top - b.base;
    const wA = maxA - minA; const wB = maxB - minB;
    let s = Math.min(8, Math.max(2.5, Math.sqrt(wA * wB) / 4));
    let lh = Math.max(3.2, H / 10);
    // ajusta o tamanho para caber no orçamento
    for (let k = 0; k < 6 && (wA / s) * (wB / s) * (H / lh) > maxN * 1.3; k++) { s *= 1.3; lh *= 1.2; }
    const nA = Math.max(1, Math.round(wA / s)); const nB = Math.max(1, Math.round(wB / s)); const nZ = Math.max(1, Math.round(H / lh));
    const sA = wA / nA; const sB = wB / nB; const sZ = H / nZ;
    const away = [cx, cy];
    const ad = Math.hypot(away[0], away[1]) || 1;
    const dir = [away[0] / ad, away[1] / ad];
    const color = b.color || [0.6, 0.58, 0.55];
    const strong = b.level >= 5 ? 1 : b.level === 4 ? 0.55 : 0.22;
    const vmax = Math.min(75, 2 + (b.psi || 5) * 2.2) * strong;
    let n = 0;
    for (let k = 0; k < nZ; k++) for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
      if (n >= maxN) return;
      const a = minA + (i + 0.5) * sA;
      const bb = minB + (j + 0.5) * sB;
      const e = cx + a * ca - bb * sa;
      const nn = cy + a * sa + bb * ca;
      if (!pointInRing(e, nn, ring) || b.holes?.some((h) => pointInRing(e, nn, h))) continue;
      const zRel = (k + 0.5) / nZ;
      const spread = (rand() - 0.5) * 0.9;
      const dx = dir[0] * Math.cos(spread) - dir[1] * Math.sin(spread);
      const dy = dir[0] * Math.sin(spread) + dir[1] * Math.cos(spread);
      const sp = vmax * (0.25 + 0.75 * zRel) * (0.6 + 0.6 * rand());
      const shade = 0.75 + 0.35 * rand();
      out.push({
        e, n: nn, u: b.base + (k + 0.5) * sZ,
        hx: (sA / 2) * (0.9 + 0.08 * rand()), hy: (sB / 2) * (0.9 + 0.08 * rand()), hz: (sZ / 2) * 0.94,
        angle: ang,
        t: b.arrival + zRel * 0.18 + rand() * 0.12,
        v: [dx * sp, (rand() - 0.3) * 3 * strong, dy * sp],
        w: [(rand() - 0.5) * 3, (rand() - 0.5) * 3, (rand() - 0.5) * 3],
        color: [color[0] * shade, color[1] * shade, color[2] * shade],
        body: null,
      });
      n++;
    }
  }

  /** Avança a simulação até o tempo visual `tau`. */
  update(tau) {
    if (!this.world || !this.mesh) return;
    if (tau < 0) return;
    if (this.lastTau >= 0 && tau < this.lastTau - 0.25) {
      // o tempo voltou (nova linha do tempo): recomeça
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      this.chunks.forEach((c, i) => {
        if (c.body) { this.world.removeRigidBody(c.body); c.body = null; }
        this.mesh.setMatrixAt(i, zero);
      });
      this.next = 0;
      this.lastTau = -1;
    }
    const R = this.R;
    // cria os corpos cuja onda já chegou
    while (this.next < this.chunks.length && this.chunks[this.next].t <= tau) {
      const c = this.chunks[this.next++];
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(c.pos.x, c.pos.y, c.pos.z)
        .setRotation({ x: c.quat.x, y: c.quat.y, z: c.quat.z, w: c.quat.w })
        .setLinvel(-c.v[0], c.v[1], c.v[2])
        .setAngvel({ x: c.w[0], y: c.w[1], z: c.w[2] })
        .setLinearDamping(0.04)
        .setAngularDamping(0.25)
        .setCcdEnabled(Math.hypot(c.v[0], c.v[2]) > 35);
      c.body = this.world.createRigidBody(desc);
      this.world.createCollider(R.ColliderDesc.cuboid(c.hx, c.hz, c.hy).setDensity(2.2).setFriction(0.8).setRestitution(0.12), c.body);
    }
    // passos fixos de 1/60 s até alcançar o tempo visual (no máx. 8 por quadro)
    const dt = this.lastTau < 0 ? 0 : Math.max(0, tau - this.lastTau);
    this.lastTau = tau;
    // se o quadro atrasar, a física recupera nos quadros seguintes (até 0,5 s de atraso)
    this.acc = Math.min(this.acc + dt, 0.5);
    let steps = 0;
    while (this.acc >= 1 / 60 && steps < 8) { this.world.step(); this.acc -= 1 / 60; steps++; }
    // sincroniza as instâncias
    const m = this._m;
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    this.chunks.forEach((c, i) => {
      if (!c.body) return;
      const t = c.body.translation();
      const r = c.body.rotation();
      p.set(t.x, t.y, t.z);
      q.set(r.x, r.y, r.z, r.w);
      m.compose(p, q, c.size);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
