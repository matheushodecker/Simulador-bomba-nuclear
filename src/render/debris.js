/**
 * Destroços em voxels: blocos instanciados que se soltam dos prédios quando a
 * onda de choque passa. Trajetória balística calculada no shader:
 *   p(t) = p0 + v·t − ½·g·t²   (com pouso, deslize e atrito)
 */
import * as THREE from 'three';
import { pointInRing } from '../map/geo.js';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uG;
attribute vec3 iStart;
attribute vec3 iVel;
attribute vec4 iP;      // chegada, tamanho, semente, calor
attribute vec3 iColor;
varying vec3 vN;
varying vec3 vColor;
varying float vHeat;
varying float vDust;

mat3 rotAxis(vec3 a, float ang) {
  float s = sin(ang); float c = cos(ang); float oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c,     oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c,     oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}

void main() {
  float t = uTime - iP.x;
  if (uTime < 0.0 || t <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = iP.y;
  float seed = iP.z;
  vec3 v = iVel;
  float g = uG;
  float h0 = max(iStart.z - 0.5 * s, 0.0);
  float tl = (v.z + sqrt(v.z * v.z + 2.0 * g * h0)) / g;
  float tt = min(t, tl);
  vec3 pos = iStart + v * tt;
  pos.z -= 0.5 * g * tt * tt;
  if (t > tl) {
    float ts = min(t - tl, 1.2);
    pos.xy += v.xy * 0.22 * ts * (1.0 - 0.4 * ts);
    pos.z = 0.5 * s * 0.7;
  }
  vec3 axis = normalize(vec3(fract(seed * 13.1) - 0.5, fract(seed * 7.7) - 0.5, fract(seed * 3.3) - 0.5) + 1e-3);
  float spin = (1.5 + seed * 7.0) * tt;
  mat3 R = rotAxis(axis, spin);
  vec3 dims = vec3(1.0, 0.7 + fract(seed * 5.1) * 0.7, 0.45 + fract(seed * 9.3) * 0.7);
  vec3 local = R * (position * s * dims);
  vN = R * normal;
  vColor = iColor;
  vHeat = iP.w * exp(-t * 0.5);
  vDust = smoothstep(0.0, 6.0, t);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + local, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uFlash;
uniform float uLightScale;
uniform float uGammaOut;
uniform float uEmissiveBoost;
varying vec3 vN;
varying vec3 vColor;
varying float vHeat;
varying float vDust;
void main() {
  vec3 n = normalize(vN);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 albedo = mix(vColor, vec3(0.55, 0.52, 0.48), 0.35 + 0.35 * vDust); // coberto de poeira de concreto
  albedo = pow(albedo, vec3(uGammaOut));                                       // cor → linear no modo cinema
  vec3 col = albedo * (0.45 + 0.75 * diff + 0.15 * (0.5 + 0.5 * n.z)) * uLightScale;
  col += vec3(1.0, 0.35, 0.05) * vHeat * 1.2 * uEmissiveBoost; // incandescente perto do ponto zero
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
}
`;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class Debris {
  constructor() {
    this.object3d = new THREE.Group();
    this.uniforms = {
      uTime: { value: -1 },
      uG: { value: 15.7 },
      uSunDir: { value: new THREE.Vector3(-0.45, -0.35, 0.82).normalize() },
      uFlash: { value: 0 },
      uLightScale: { value: 1 },
      uGammaOut: { value: 1 },
      uEmissiveBoost: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG });
    this.mesh = null;
    this.flash = 0;
  }

  clear() {
    if (this.mesh) {
      this.object3d.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }

  /**
   * Gera os voxels a partir dos prédios danificados.
   * @param {Array} buildings registros do City (com level, psi, arrival, dKm)
   * @param {[number,number]} gz ponto zero local (m)
   * @param {number} cap número máximo de voxels
   * @param {number} fireballKm raio da bola de fogo (para destroços incandescentes)
   */
  generate(buildings, gz, cap, fireballKm) {
    this.clear();
    const want = [];
    let total = 0;
    for (const r of buildings) {
      if (!(r.level >= 2)) { want.push(0); continue; }
      const vol = r.area * (r.top - r.base);
      const per = r.level === 5 ? 10 + vol / 700 : r.level === 4 ? 6 + vol / 1400 : r.level === 3 ? 3 + vol / 3000 : 1 + vol / 9000;
      const n = Math.min(70, Math.round(per));
      want.push(n);
      total += n;
    }
    if (total === 0) return 0;
    const scale = Math.min(1, cap / total);
    const N = Math.min(cap, Math.round(total * scale) + buildings.length);
    const iStart = new Float32Array(N * 3);
    const iVel = new Float32Array(N * 3);
    const iP = new Float32Array(N * 4);
    const iColor = new Float32Array(N * 3);
    const rand = rng(12345);
    let k = 0;
    buildings.forEach((r, bi) => {
      let n = want[bi] * scale;
      n = Math.floor(n) + (rand() < n - Math.floor(n) ? 1 : 0);
      if (!n) return;
      const H = r.top - r.base;
      const [x0, y0, x1, y1] = r.bbox;
      const ax = r.c[0] - gz[0];
      const ay = r.c[1] - gz[1];
      const ad = Math.hypot(ax, ay) || 1;
      const sizeScale = Math.min(2.2, Math.max(0.6, Math.sqrt(r.area) / 14));
      const speedBase = Math.min(150, 3 + r.psi * 3.2) * (r.level === 2 ? 0.25 : r.level === 3 ? 0.6 : 1);
      const hot = r.dKm < fireballKm * 2.5 ? 1 : 0;
      for (let q = 0; q < n && k < N; q++) {
        let px = r.c[0]; let py = r.c[1];
        for (let tries = 0; tries < 8; tries++) {
          const tx = x0 + rand() * (x1 - x0);
          const ty = y0 + rand() * (y1 - y0);
          if (pointInRing(tx, ty, r.outer)) { px = tx; py = ty; break; }
        }
        const zFrac = r.level >= 4 ? rand() : 0.45 + 0.55 * rand();
        const pz = r.base + H * zFrac;
        const spread = (rand() - 0.5) * 1.2;
        const dx = (ax / ad) * Math.cos(spread) - (ay / ad) * Math.sin(spread);
        const dy = (ax / ad) * Math.sin(spread) + (ay / ad) * Math.cos(spread);
        const sp = speedBase * (0.35 + 0.9 * rand());
        iStart.set([px, py, pz], k * 3);
        iVel.set([dx * sp, dy * sp, 2 + rand() * (4 + sp * 0.35)], k * 3);
        const size = (0.5 + rand() * 2.4) * sizeScale;
        iP.set([r.arrival + rand() * 0.25 + zFrac * 0.12, size, rand(), hot * (0.5 + 0.5 * rand())], k * 4);
        const shade = 0.55 + 0.45 * rand();
        const concrete = rand() < 0.45;
        const c = concrete ? [0.62, 0.61, 0.58] : r.src.color;
        const charred = r.burn >= 3 ? 0.75 : 1;
        iColor.set([c[0] * shade * charred, c[1] * shade * charred, c[2] * shade * charred], k * 3);
        k++;
      }
    });
    const base = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('iStart', new THREE.InstancedBufferAttribute(iStart.subarray(0, k * 3), 3));
    geo.setAttribute('iVel', new THREE.InstancedBufferAttribute(iVel.subarray(0, k * 3), 3));
    geo.setAttribute('iP', new THREE.InstancedBufferAttribute(iP.subarray(0, k * 4), 4));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor.subarray(0, k * 3), 3));
    geo.instanceCount = k;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.object3d.add(this.mesh);
    return k;
  }

  update(ctx) {
    this.uniforms.uTime.value = ctx.tau;
    this.uniforms.uFlash.value = this.flash;
  }
}
