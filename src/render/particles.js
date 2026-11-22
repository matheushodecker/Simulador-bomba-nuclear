/**
 * Sistemas de partículas em "billboards" (quadrados sempre virados para a câmera).
 *  - ParticleField: movimento analítico na GPU (poeira, fumaça, chamas).
 *  - BillboardCloud: posições atualizadas na CPU a cada quadro (nuvem em cogumelo).
 */
import * as THREE from 'three';

/** Textura procedural de "baforada" (puff) — gerada em canvas, sem arquivos externos. */
let PUFF = null;
export function puffTexture() {
  if (PUFF) return PUFF;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  // ruído de valor suavizado em algumas oitavas
  const grid = (n, seed) => {
    const a = new Float32Array((n + 1) * (n + 1));
    let s = seed;
    for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647; }
    return (x, y) => {
      const fx = x * n; const fy = y * n;
      const ix = Math.floor(fx); const iy = Math.floor(fy);
      const tx = fx - ix; const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx); const sy = ty * ty * (3 - 2 * ty);
      const v = (i, j) => a[Math.min(n, j) * (n + 1) + Math.min(n, i)];
      return (v(ix, iy) * (1 - sx) + v(ix + 1, iy) * sx) * (1 - sy) + (v(ix, iy + 1) * (1 - sx) + v(ix + 1, iy + 1) * sx) * sy;
    };
  };
  const o1 = grid(4, 7); const o2 = grid(8, 13); const o3 = grid(16, 29);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / (S - 1); const v = y / (S - 1);
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = 0.55 * o1(u, v) + 0.3 * o2(u, v) + 0.15 * o3(u, v);
      let a = Math.max(0, 1 - r * (0.75 + 0.5 * n));
      a = Math.pow(a, 1.6) * (0.55 + 0.6 * n);
      const i = (y * S + x) * 4;
      const l = 200 + 55 * n;
      img.data[i] = l; img.data[i + 1] = l; img.data[i + 2] = l;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  PUFF = new THREE.CanvasTexture(c);
  PUFF.colorSpace = THREE.NoColorSpace;
  return PUFF;
}

/* ===================== Campo de partículas na GPU ===================== */

const FIELD_VERT = /* glsl */ `
uniform float uTime;
uniform float uNow;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uWind;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iA;   // início, vida, tamanho inicial, tamanho final
attribute vec4 iB;   // semente, tipo, repetir, alfa máx
attribute vec3 iColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vK;
varying float vKind;
void main() {
  float t = uTime - iA.x;
  float life = iA.y;
  if (uTime < 0.0 || t < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (iB.z > 0.5) { t = mod(t, life); }
  else if (t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = t / life;
  float tau = 1.5 + iB.x * 2.5;
  vec3 pos = iPos + iVel * tau * (1.0 - exp(-t / tau));
  pos.xy += uWind * t * (0.15 + k);
  float size = mix(iA.z, iA.w, 1.0 - (1.0 - k) * (1.0 - k));
  float ang = iB.x * 6.2831 + t * (iB.x - 0.5) * 0.5;
  vec2 q = position.xy;
  vec2 rq = vec2(q.x * cos(ang) - q.y * sin(ang), q.x * sin(ang) + q.y * cos(ang));
  vec3 world = pos + (uRight * rq.x + uUp * rq.y) * size;
  float a = iB.w * smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(0.45, 1.0, k));
  if (iB.y > 2.5) a *= 0.65 + 0.35 * sin(uNow * 17.0 + iB.x * 40.0);
  vAlpha = a;
  vUv = q + 0.5;
  vColor = iColor;
  vK = k;
  vKind = iB.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const FIELD_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uFlash;
uniform float uLightScale;
uniform float uGammaOut;
uniform float uEmissiveBoost;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vK;
varying float vKind;
void main() {
  vec4 tx = texture2D(uTex, vUv);
  float a = tx.a * vAlpha;
  if (a < 0.003) discard;
  vec3 col = vColor * (0.72 + 0.4 * vUv.y) * (0.8 + 0.25 * tx.r) * uLightScale;
  col = pow(max(col, 0.0), vec3(uGammaOut));
  if (vKind > 2.5) col = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.3, 0.05), vK) * 1.4 * uEmissiveBoost; // chama
  col = mix(col, vec3(1.0), uFlash * 0.7);
  gl_FragColor = vec4(col, a);
}
`;

export class ParticleField {
  /** @param {{additive?:boolean}} opts */
  constructor({ additive = false } = {}) {
    this.object3d = new THREE.Group();
    this.uniforms = {
      uTime: { value: -1 }, uNow: { value: 0 },
      uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 0, 1) },
      uWind: { value: new THREE.Vector2() },
      uTex: { value: puffTexture() }, uFlash: { value: 0 },
      uLightScale: { value: 1 }, uGammaOut: { value: 1 }, uEmissiveBoost: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: FIELD_VERT, fragmentShader: FIELD_FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = null;
    this.flash = 0;
    this.items = [];
  }

  clear() {
    if (this.mesh) {
      this.object3d.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.items = [];
  }

  /** Acumula partículas: {pos:[x,y,z], vel:[...], start, life, s0, s1, seed, kind, loop, alpha, color:[r,g,b]} */
  push(p) { this.items.push(p); }

  build() {
    const N = this.items.length;
    if (this.mesh) { this.object3d.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!N) return;
    const iPos = new Float32Array(N * 3);
    const iVel = new Float32Array(N * 3);
    const iA = new Float32Array(N * 4);
    const iB = new Float32Array(N * 4);
    const iColor = new Float32Array(N * 3);
    this.items.forEach((p, i) => {
      iPos.set(p.pos, i * 3);
      iVel.set(p.vel, i * 3);
      iA.set([p.start, p.life, p.s0, p.s1], i * 4);
      iB.set([p.seed, p.kind, p.loop ? 1 : 0, p.alpha], i * 4);
      iColor.set(p.color, i * 3);
    });
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iVel', new THREE.InstancedBufferAttribute(iVel, 3));
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3));
    geo.instanceCount = N;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.object3d.add(this.mesh);
  }

  setWind(vx, vy) { this.uniforms.uWind.value.set(vx, vy); }

  update(ctx) {
    const u = this.uniforms;
    u.uTime.value = ctx.tau;
    u.uNow.value = ctx.now;
    u.uRight.value.copy(ctx.right);
    u.uUp.value.copy(ctx.up);
    u.uFlash.value = this.flash;
  }
}

/* ===================== Nuvem atualizada na CPU ===================== */

const CLOUD_VERT = /* glsl */ `
uniform vec3 uRight;
uniform vec3 uUp;
attribute vec3 iPos;
attribute vec4 iD;     // tamanho, alfa, brilho (emissão), rotação
attribute vec3 iColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vGlow;
void main() {
  if (iD.y <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float ang = iD.w;
  vec2 q = position.xy;
  vec2 rq = vec2(q.x * cos(ang) - q.y * sin(ang), q.x * sin(ang) + q.y * cos(ang));
  vec3 world = iPos + (uRight * rq.x + uUp * rq.y) * iD.x;
  vUv = q + 0.5;
  vAlpha = iD.y;
  vColor = iColor;
  vGlow = iD.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uFlash;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vGlow;
void main() {
  vec4 tx = texture2D(uTex, vUv);
  float a = tx.a * vAlpha;
  if (a < 0.004) discard;
  float shade = 0.7 + 0.45 * vUv.y;
  vec3 col = vColor * shade;
  col += vec3(1.0, 0.5, 0.15) * vGlow * (0.6 + 0.6 * tx.a);
  col = mix(col, vec3(1.0), uFlash * 0.6);
  gl_FragColor = vec4(col, a);
}
`;

export class BillboardCloud {
  constructor(maxCount) {
    this.max = maxCount;
    this.object3d = new THREE.Group();
    this.uniforms = {
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 0, 1) },
      uTex: { value: puffTexture() },
      uFlash: { value: 0 },
    };
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 3), 3);
    this.aD = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 4), 4);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 3), 3);
    [this.aPos, this.aD, this.aColor].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iD', this.aD);
    geo.setAttribute('iColor', this.aColor);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.object3d.add(this.mesh);
    this._order = new Uint32Array(maxCount);
    this._depth = new Float32Array(maxCount);
  }

  /**
   * Escreve as partículas ordenadas de trás para frente.
   * @param {Float32Array} pos (n*3) @param {Float32Array} d (n*4) @param {Float32Array} col (n*3)
   */
  write(n, pos, d, col, matrix, ctx) {
    const e = matrix.elements;
    for (let i = 0; i < n; i++) {
      // profundidade ~ componente w do espaço de recorte
      this._depth[i] = e[3] * pos[i * 3] + e[7] * pos[i * 3 + 1] + e[11] * pos[i * 3 + 2] + e[15];
      this._order[i] = i;
    }
    const ord = Array.from(this._order.subarray(0, n)).sort((a, b) => this._depth[b] - this._depth[a]);
    const P = this.aPos.array; const D = this.aD.array; const C = this.aColor.array;
    ord.forEach((src, dst) => {
      P[dst * 3] = pos[src * 3]; P[dst * 3 + 1] = pos[src * 3 + 1]; P[dst * 3 + 2] = pos[src * 3 + 2];
      D[dst * 4] = d[src * 4]; D[dst * 4 + 1] = d[src * 4 + 1]; D[dst * 4 + 2] = d[src * 4 + 2]; D[dst * 4 + 3] = d[src * 4 + 3];
      C[dst * 3] = col[src * 3]; C[dst * 3 + 1] = col[src * 3 + 1]; C[dst * 3 + 2] = col[src * 3 + 2];
    });
    this.aPos.needsUpdate = true; this.aD.needsUpdate = true; this.aColor.needsUpdate = true;
    this.geo.instanceCount = n;
    this.uniforms.uRight.value.copy(ctx.right);
    this.uniforms.uUp.value.copy(ctx.up);
  }

  hide() { this.geo.instanceCount = 0; }
}
