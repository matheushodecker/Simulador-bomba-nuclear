/**
 * DESTRUIÇÃO ESTRUTURAL com física de corpo rígido (Rapier, WebAssembly) — modo mapa e cinema.
 *
 * Cada prédio perto da explosão vira uma ESTRUTURA de verdade:
 *   - painéis de parede por andar e por trecho de fachada (com janelas), com a espessura e a
 *     densidade do material (alvenaria, concreto, madeira, fechamento de aço/vidro);
 *   - lajes de piso e de cobertura divididas em placas.
 * Todas as peças começam presas (corpos fixos). Quando a onda chega:
 *   1. CARGA: cada peça sente a pressão no tempo, p(t) = Pₛ(1 − τ)e^(−τ) (forma de Friedlander,
 *      τ = t / fase positiva). Fachadas voltadas para a explosão sentem a pressão REFLETIDA
 *      (2× a 8×, Rankine–Hugoniot); laterais, a pressão incidente; o telhado é empurrado para baixo.
 *   2. RUPTURA: a peça se solta quando a carga passa da resistência do material (os mesmos
 *      limiares do inspetor, com o fator de carga dinâmica da fase positiva e variação de ±30%).
 *   3. MOVIMENTO: solta, recebe a força da pressão (F = p·A) e o arrasto do vento da onda
 *      (F = ½·ρ·C_d·A·u²), cai com a gravidade e colide com o chão, com outras peças e com o que
 *      ainda está de pé — um impacto forte também quebra peças presas.
 *   4. COLAPSO PROGRESSIVO: paredes portantes (alvenaria, madeira) seguram o andar — se mais da
 *      metade das paredes de um andar cai, tudo o que está acima desaba ("panqueca"). Estruturas
 *      em pórtico (concreto armado, aço) perdem a fachada mas o esqueleto fica de pé, a não ser
 *      sob pressões muito altas.
 *   5. FRAGMENTAÇÃO: peças que batem com desaceleração muito alta se partem em duas e soltam poeira.
 *
 * A dinâmica roda em tempo de tela (a queda parece real); as forças são multiplicadas pela
 * aceleração da animação para que o impulso (e portanto as velocidades) seja o físico.
 * Coordenadas: ENU local (x leste, y norte, z para cima), em metros.
 */
import * as THREE from 'three';
import { pointInRing } from '../map/geo.js';
import {
  MATERIALS, materialOf, positivePhaseSeconds, normalReflectionFactor, dynamicLoadFactor,
  peakWindSpeed, isFrameMaterial,
} from '../physics/structures.js';

const PSI = 6894.76;
const BUDGET = { baixa: 700, media: 1800, alta: 3500, ultra: 6000 };
const PER_BUILDING = 260;
const STORY = 3.2;
const DT = 1 / 60;

/** Espessura (m) e densidade efetiva (kg/m³) das paredes por material. */
const WALL = {
  masonry: { t: 0.22, rho: 1800, core: [0.62, 0.36, 0.27] },
  concrete: { t: 0.25, rho: 2400, core: [0.6, 0.59, 0.56] },
  wood: { t: 0.16, rho: 600, core: [0.55, 0.42, 0.28] },
  steel: { t: 0.08, rho: 2700, core: [0.55, 0.57, 0.6] }, // fechamento leve (painel metálico/vidro)
  glass: { t: 0.06, rho: 2500, core: [0.45, 0.55, 0.6] },
};
const SLAB = { t: 0.24, rho: 2400 };

let RAPIER = null;
let rapierPromise = null;
/** Baixa o motor de física (uma vez); pode ser chamado antes para não atrasar a explosão. */
export function loadRapier() {
  if (RAPIER) return Promise.resolve(RAPIER);
  if (!rapierPromise) {
    rapierPromise = import('@dimforge/rapier3d-compat').then(async (mod) => {
      await mod.init();
      RAPIER = mod;
      return mod;
    }).catch((e) => { rapierPromise = null; throw e; });
  }
  return rapierPromise;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Carga numa parede ÷ pressão incidente: refletida na frente, incidente nas laterais, pouca nos fundos. */
function loadFactor(facing, refl) {
  if (facing > 0.25) return 1 + (refl - 1) * Math.min(1, (facing - 0.25) / 0.5);
  if (facing > -0.25) return 1;
  return 0.25;
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]; const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

const PIECE_VERT = /* glsl */ `
attribute vec3 iColor;
attribute vec4 iInfo;   // tipo (0 parede, 1 laje, 2 cobertura), queimadura (0–1), calor, chegada da onda (tela)
attribute vec3 iDims;
attribute vec3 iCore;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vColor;
varying vec3 vCore;
varying vec4 vInfo;
varying vec3 vDims;
varying vec3 vPos;
void main() {
  vec4 wp = instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(instanceMatrix) * normal);
  vLocal = position * iDims;
  vLocalN = normal;
  vColor = iColor;
  vCore = iCore;
  vInfo = iInfo;
  vDims = iDims;
  vPos = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * wp;
}
`;

const PIECE_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uFlash;
uniform float uLightScale;
uniform float uGammaOut;
uniform float uEmissiveBoost;
uniform float uTime;
uniform float uPulse;
uniform vec3 uFirePos;
uniform float uFireLight;
uniform float uFireRange2;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vColor;
varying vec3 vCore;
varying vec4 vInfo;
varying vec3 vDims;
varying vec3 vPos;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 n = normalize(vN);
  float kind = vInfo.x;
  vec3 albedo = vColor;
  float glassF = 0.0;
  // coordenadas da face em metros (para janelas, juntas e manchas)
  vec3 lp = vLocal + vDims * 0.5;
  if (kind < 0.5) {
    // PAREDE: face externa (+y) com fachada e janelas; interna (−y) reboco; bordas = núcleo do material
    if (abs(vLocalN.y) > 0.5) {
      float u = lp.x; float v = lp.z;
      vec2 cell = vec2(u / 2.7, v / ${STORY.toFixed(1)});
      vec2 f = fract(cell);
      float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.32, f.y) * step(f.y, 0.8);
      if (vDims.x < 1.6) win = 0.0;
      if (vLocalN.y < 0.0) albedo = vec3(0.78, 0.76, 0.72); // reboco interno
      float broken = uTime >= vInfo.w ? 1.0 : 0.0;
      vec3 glass = mix(vec3(0.16, 0.22, 0.27) + 0.12 * h21(floor(cell)), vec3(0.025, 0.022, 0.02), broken);
      albedo = mix(albedo, glass, win);
      glassF = win * (1.0 - broken);
      // juntas entre andares
      albedo *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.06, f.y));
    } else {
      albedo = vCore * (0.85 + 0.3 * h21(floor(lp.xz * 3.0)));
    }
  } else {
    // LAJE: concreto; topo da cobertura com a cor do telhado
    vec3 conc = vec3(0.6, 0.59, 0.56) * (0.88 + 0.24 * h21(floor(lp.xy * 1.5)));
    albedo = (kind > 1.5 && vLocalN.z > 0.5) ? vColor * 0.82 : conc;
    if (vLocalN.z < -0.5) albedo = vec3(0.8, 0.79, 0.76);
  }
  // arestas escurecidas (dá volume às peças)
  vec3 e = abs(vLocal) / max(vDims * 0.5, vec3(1e-3));
  float edge = smoothstep(0.86, 1.0, max(max(min(e.x, e.y), min(e.y, e.z)), min(e.x, e.z)));
  albedo *= 1.0 - 0.35 * edge;
  // carbonização pelo pulso térmico
  albedo = mix(albedo, vec3(0.07, 0.05, 0.045), clamp(vInfo.y * uPulse * 1.15, 0.0, 1.0) * 0.6);
  albedo = pow(albedo, vec3(uGammaOut));
  float diff = max(dot(n, uSunDir), 0.0);
  float sky = 0.5 + 0.5 * n.z;
  vec3 col = albedo * (0.38 + 0.72 * diff + 0.22 * sky) * uLightScale;
  // reflexo do céu nos vidros intactos
  col += glassF * vec3(0.10, 0.13, 0.17) * pow(1.0 - abs(n.z), 2.0) * uLightScale;
  // luz da bola de fogo
  vec3 L = uFirePos - vPos;
  float d2 = dot(L, L);
  col += vec3(1.0, 0.78, 0.5) * uFireLight * max(dot(n, normalize(L)), 0.0) / (1.0 + d2 / uFireRange2);
  // incandescência de peças muito perto do ponto zero
  float age = max(uTime - vInfo.w, 0.0);
  col += vec3(1.0, 0.33, 0.06) * vInfo.z * exp(-age * 0.4) * 1.4 * uEmissiveBoost;
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
}
`;

const PUFF_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uRight;
uniform vec3 uUp;
attribute vec3 iPos;
attribute vec4 iT;      // nascimento, tamanho inicial, crescimento, vida
attribute vec3 iVel;
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
  float age = uTime - iT.x;
  if (age < 0.0 || age > iT.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = age / iT.w;
  float s = iT.y + iT.z * sqrt(age);
  vec3 p = iPos + iVel * (1.0 - exp(-age * 0.8)) / 0.8 + vec3(0.0, 0.0, 1.2 * age);
  p += (uRight * position.x + uUp * position.y) * s;
  vUv = position.xy;
  vA = smoothstep(0.0, 0.08, k) * (1.0 - k) * (1.0 - k);
  vSeed = fract(iT.x * 13.7 + iPos.x * 0.11);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const PUFF_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uLightScale;
uniform float uGammaOut;
uniform vec3 uDust;
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
  float r = length(vUv) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vA;
  float n = fract(sin(dot(floor(vUv * 6.0 + vSeed * 9.0), vec2(12.9, 78.2))) * 4375.85);
  a *= 0.75 + 0.25 * n;
  if (a < 0.01) discard;
  vec3 c = pow(uDust, vec3(uGammaOut)) * (0.55 + 0.45 * max(uSunDir.z, 0.0) + 0.2 * (1.0 - r)) * uLightScale;
  gl_FragColor = vec4(c, a * 0.75);
}
`;

/* ------------------------------------------------------------------ */

export class StructuralDestruction {
  /**
   * @param {object} [o]
   * @param {boolean} [o.overlay] true = as peças só aparecem quando se soltam (cidade fotorrealista
   *   continua desenhando o prédio intacto); false = as peças SUBSTITUEM o prédio desde o início.
   */
  constructor({ overlay = false } = {}) {
    this.overlay = overlay;
    this.object3d = new THREE.Group();
    this.object3d.name = 'structural-destruction';
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(-0.45, -0.35, 0.82).normalize() },
      uFlash: { value: 0 },
      uLightScale: { value: 1 },
      uGammaOut: { value: 1 },
      uEmissiveBoost: { value: 1 },
      uTime: { value: -1 },
      uPulse: { value: 0 },
      uFirePos: { value: new THREE.Vector3() },
      uFireLight: { value: 0 },
      uFireRange2: { value: 1e6 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: PIECE_VERT, fragmentShader: PIECE_FRAG });
    this.puffUniforms = {
      uTime: { value: -1 },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 0, 1) },
      uSunDir: this.uniforms.uSunDir,
      uLightScale: this.uniforms.uLightScale,
      uGammaOut: this.uniforms.uGammaOut,
      uDust: { value: new THREE.Color(0.62, 0.58, 0.52) },
    };
    this.puffMaterial = new THREE.ShaderMaterial({
      uniforms: this.puffUniforms, vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
      transparent: true, depthWrite: false,
    });
    this.flash = 0;
    this.pulse = 0;
    this.token = 0;
    this.ready = false;
    this.handled = [];
    this.stats = null;
  }

  dispose() {
    this.token++;
    this.ready = false;
    if (this.world) { this.world.free(); this.world = null; }
    if (this.events) { this.events.free(); this.events = null; }
    for (const m of [this.mesh, this.puffs]) {
      if (m) { this.object3d.remove(m); m.geometry.dispose(); }
    }
    this.mesh = null;
    this.puffs = null;
    this.els = [];
    this.handled = [];
    this.stats = null;
  }

  /**
   * Escolhe os prédios que terão física e os decompõe em peças (síncrono, para que os outros
   * efeitos — destroços simples, poeira — já saibam quais prédios ficam por conta da física).
   * Marca `b.physics = true` nos escolhidos.
   * @param {object} o
   * @param {Array} o.buildings registros ENU {c, outer, holes, base, top, level, psi, dKm, arrival(tela), mat?, burn?, src?.color|color, elev?, ground?}
   * @param {object} o.fx efeitos da detonação
   * @param {number} o.accel aceleração da animação (tempo físico / tempo de tela)
   * @param {[number,number]} o.gz ponto zero (ENU local)
   * @param {[number,number]} o.focus ponto prioritário (centro da vista)
   * @param {string} o.quality
   */
  plan(o) {
    this.dispose();
    const { fx } = o;
    const budget = BUDGET[o.quality] || BUDGET.media;
    const rfb = fx.radius.fireball * 1000;
    const gx = o.gz[0]; const gy = o.gz[1];
    const cand = [];
    o.buildings.forEach((b, i) => {
      b.physics = false;
      if (!(b.level >= 2) || b.vaporized) return;
      const H = b.top - b.base;
      if (H < 2.5 || !b.outer || b.outer.length < 3) return;
      cand.push({ b, i, d: Math.hypot(b.c[0] - o.focus[0], b.c[1] - o.focus[1]) });
    });
    cand.sort((a, b) => a.d - b.d);
    const rand = rng(424242);
    const els = [];
    const blds = [];
    for (const { b, i } of cand) {
      if (els.length >= budget - 8) break;
      const cap = Math.min(PER_BUILDING, budget - els.length);
      const B = this._decompose(b, i, cap, rand, els, { fx, accel: o.accel, gx, gy, rfb });
      if (B) { blds.push(B); b.physics = true; }
    }
    this.els = els;
    this._plan = els.map((e) => ({ ...e }));
    this.blds = blds;
    this.accel = o.accel;
    this.fx = fx;
    this.handled = blds.map((B) => B.index);
    return { buildings: blds.length, pieces: els.length };
  }

  /** Divide um prédio em paredes (por andar e trecho de fachada) e placas de laje. */
  _decompose(b, index, cap, rand, out, ctx) {
    let ring = b.outer.slice();
    const last = ring[ring.length - 1];
    if (last[0] === ring[0][0] && last[1] === ring[0][1]) ring = ring.slice(0, -1);
    if (ring.length < 3) return null;
    const area = Math.abs(signedArea(ring));
    if (area < 12) return null;
    const ccw = signedArea(ring) > 0;
    const mat = b.mat || materialOf({ ...(b.src || {}), height: b.top - b.base });
    const W = WALL[mat] || WALL.masonry;
    const z0 = b.base + (b.elev || 0);
    const H = b.top - b.base;
    // eixo principal (aresta mais longa) para as placas de laje
    let best = 0; let ang = 0; let perim = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]; const q = ring[(i + 1) % ring.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      perim += L;
      if (L > best) { best = L; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
    }
    // tamanho das peças: ~3,5 m, aumentado até caber no orçamento deste prédio
    const nStories = Math.max(1, Math.round(H / STORY));
    let s = 3.5;
    let g = 1;
    const est = () => Math.ceil(nStories / g) * (perim / s + area / (s * s));
    for (let k = 0; k < 14 && est() > cap; k++) {
      if (nStories / g > 8 && k % 2 === 0) g++;
      else s *= 1.22;
    }
    if (est() > cap * 1.15) return null;
    const nE = Math.ceil(nStories / g);
    const hE = H / nE;

    const dx = b.c[0] - ctx.gx; const dy = b.c[1] - ctx.gy;
    const dist = Math.hypot(dx, dy) || 1;
    const dir = [dx / dist, dy / dist];
    const fx = ctx.fx;
    const dKm = dist / 1000;
    const psi = b.psi ?? fx.psiAt(dKm);
    const td = positivePhaseSeconds(Math.hypot(dKm, fx.hKm), fx.yieldKt);
    const M = 2 / Math.max(dynamicLoadFactor(td / (MATERIALS[mat]?.T || 0.1)), 0.05);
    const thr = MATERIALS[mat]?.psi || MATERIALS.masonry.psi;
    const color = b.src?.color || b.color || [0.75, 0.72, 0.68];
    const heat = dist < ctx.rfb * 2.5 ? Math.min(1, (ctx.rfb * 2.5 - dist) / (ctx.rfb * 1.5)) : 0;
    const ground = (b.elev || 0) + (b.ground != null ? b.ground : b.base - (b.src?.minHeight ?? 0));
    const B = {
      index, mat, frame: isFrameMaterial(mat), level: b.level, nE, hE, z0, dir, ground,
      arrV: b.arrival ?? fx.arrivalAt(dKm) / ctx.accel, td, P: psi * PSI, refl: normalReflectionFactor(psi),
      wind: peakWindSpeed(psi), burn: Math.min(1, (b.burn || 0) / 3), heat,
      storyWalls: Array.from({ length: nE }, () => []), storyIntact: new Array(nE).fill(0),
      slabs: Array.from({ length: nE + 1 }, () => []), collapseFrom: Infinity,
    };
    const first = out.length;
    // --- paredes ---
    const wallIdx = []; // [story][edge][seg] → id
    for (let k = 0; k < nE; k++) wallIdx.push([]);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]; const q = ring[(i + 1) % ring.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 0.8) continue;
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const theta = ccw ? a + Math.PI : a; // eixo local +y = normal para FORA
      const nx = ccw ? Math.sin(a) : -Math.sin(a);
      const ny = ccw ? -Math.cos(a) : Math.cos(a);
      const nSeg = Math.max(1, Math.round(L / s));
      const facing = -(nx * dir[0] + ny * dir[1]); // 1 = fachada voltada para a explosão
      // resistência calibrada nos limiares EMPÍRICOS (dados em pressão incidente, que já embutem a
      // reflexão): cada painel rompe quando a pressão incidente passa do limiar do material, mas a
      // força que o arremessa continua sendo a carga real que ele sente (refletida na frente)
      const lf = loadFactor(facing, B.refl);
      for (let k = 0; k < nE; k++) {
        for (let j = 0; j < nSeg; j++) {
          // trechos das pontas recuam a espessura da parede: as quinas não se sobrepõem
          let s0 = (j / nSeg) * L; let s1 = ((j + 1) / nSeg) * L;
          if (j === 0) s0 += W.t;
          if (j === nSeg - 1) s1 -= W.t;
          if (s1 - s0 < 0.3) continue;
          const f = (s0 + s1) / 2 / L;
          const cx = p[0] + (q[0] - p[0]) * f - nx * W.t * 0.5;
          const cy = p[1] + (q[1] - p[1]) * f - ny * W.t * 0.5;
          // a parede vai do topo da laje de baixo até a base da laje de cima
          const wh = hE - SLAB.t - 0.08; // folga: o painel arrancado não "trava" entre as lajes
          const id = out.length;
          out.push({
            kind: 0, B, story: k, cx, cy, cz: z0 + k * hE + 0.04 + wh / 2, theta,
            hx: (s1 - s0) / 2 - 0.01, hy: W.t / 2, hz: wh / 2,
            nx, ny, facing, rho: W.rho,
            cap: thr[2] * PSI * M * lf * (0.7 + 0.6 * rand()),
            color: [color[0] * (0.92 + 0.12 * rand()), color[1] * (0.92 + 0.12 * rand()), color[2] * (0.92 + 0.12 * rand())],
            core: W.core, above: -1, below: wallIdx[k - 1]?.[i]?.[j] ?? -1,
          });
          (wallIdx[k][i] = wallIdx[k][i] || [])[j] = id;
          if (k > 0 && out[id].below >= 0) out[out[id].below].above = id;
          B.storyWalls[k].push(id);
          B.storyIntact[k]++;
        }
      }
    }
    // --- lajes (piso de cada andar acima do térreo + cobertura) ---
    const ca = Math.cos(ang); const sa = Math.sin(ang);
    let minA = Infinity; let maxA = -Infinity; let minB = Infinity; let maxB = -Infinity;
    for (const [x, y] of ring) {
      const u = (x - b.c[0]) * ca + (y - b.c[1]) * sa;
      const v = -(x - b.c[0]) * sa + (y - b.c[1]) * ca;
      minA = Math.min(minA, u); maxA = Math.max(maxA, u); minB = Math.min(minB, v); maxB = Math.max(maxB, v);
    }
    const nA = Math.max(1, Math.round((maxA - minA) / s));
    const nB = Math.max(1, Math.round((maxB - minB) / s));
    const sA = (maxA - minA) / nA; const sB = (maxB - minB) / nB;
    const cells = [];
    for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
      const u = minA + (i + 0.5) * sA; const v = minB + (j + 0.5) * sB;
      const x = b.c[0] + u * ca - v * sa; const y = b.c[1] + u * sa + v * ca;
      if (!pointInRing(x, y, ring) || b.holes?.some((h) => h.length > 2 && pointInRing(x, y, h))) continue;
      // perto da borda? (as placas da borda caem junto com a fachada)
      const edgeCell = i === 0 || j === 0 || i === nA - 1 || j === nB - 1;
      cells.push({ x, y, edgeCell, k: edgeCell ? 0.9 : 0.985 });
    }
    for (let lv = 1; lv <= nE; lv++) {
      const roof = lv === nE;
      for (const c of cells) {
        const id = out.length;
        out.push({
          kind: roof ? 2 : 1, B, story: lv, cx: c.x, cy: c.y, cz: z0 + lv * hE - SLAB.t / 2, theta: ang,
          hx: (sA / 2) * c.k, hy: (sB / 2) * c.k, hz: SLAB.t / 2, nx: 0, ny: 0, facing: 0, rho: SLAB.rho,
          cap: thr[3] * PSI * M * (0.7 + 0.6 * rand()), edgeCell: c.edgeCell,
          color: [color[0] * 0.9, color[1] * 0.88, color[2] * 0.86], core: [0.6, 0.59, 0.56], above: -1, below: -1,
        });
        B.slabs[lv].push(id);
      }
    }
    if (out.length === first) return null;
    return B;
  }

  /** Cria o mundo físico e as malhas (assíncrono: baixa o Rapier na primeira vez). */
  async build(opts = {}) {
    const { groundZ = 0 } = opts;
    this._buildOpts = opts;
    const token = this.token;
    const R = await loadRapier();
    if (token !== this.token || !this.els?.length) return false;
    const world = new R.World({ x: 0, y: 0, z: -9.81 });
    world.timestep = DT;
    // chão: plano global + "calços" sob cada prédio na altura do seu terreno
    world.createCollider(R.ColliderDesc.cuboid(30000, 30000, 5).setTranslation(0, 0, groundZ - 5).setFriction(0.9));
    for (const B of this.blds) {
      const g = B.ground;
      if (Math.abs(g - groundZ) < 0.3) continue;
      const ws = this.els.filter((e) => e.B === B);
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
      for (const e of ws) { x0 = Math.min(x0, e.cx); x1 = Math.max(x1, e.cx); y0 = Math.min(y0, e.cy); y1 = Math.max(y1, e.cy); }
      const hx = (x1 - x0) / 2 + 15; const hy = (y1 - y0) / 2 + 15;
      world.createCollider(R.ColliderDesc.cuboid(hx, hy, 5).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, g - 5).setFriction(0.9));
    }
    const n = this.els.length;
    const cap = Math.ceil(n * 1.8) + 16; // espaço para os fragmentos
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    const aColor = new Float32Array(cap * 3);
    const aInfo = new Float32Array(cap * 4);
    const aDims = new Float32Array(cap * 3);
    const aCore = new Float32Array(cap * 3);
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.setAttribute('iInfo', new THREE.InstancedBufferAttribute(aInfo, 4));
    geo.setAttribute('iDims', new THREE.InstancedBufferAttribute(aDims, 3));
    geo.setAttribute('iCore', new THREE.InstancedBufferAttribute(aCore, 3));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, zero);
    this.free = [];
    for (let i = cap - 1; i >= n; i--) this.free.push(i);
    const colMap = new Map();
    const m = new THREE.Matrix4();
    const qz = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    this.els.forEach((e, i) => {
      e.slot = i;
      e.state = 0;
      e.gen = 0;
      e.releaseAt = Infinity;
      qz.setFromAxisAngle(zAxis, e.theta);
      e.q = qz.clone();
      const desc = R.RigidBodyDesc.fixed().setTranslation(e.cx, e.cy, e.cz).setRotation({ x: e.q.x, y: e.q.y, z: e.q.z, w: e.q.w });
      e.body = world.createRigidBody(desc);
      e.area = e.kind === 0 ? 4 * e.hx * e.hz : 4 * e.hx * e.hy;
      e.col = world.createCollider(
        R.ColliderDesc.cuboid(e.hx, e.hy, e.hz).setDensity(e.rho).setFriction(0.75).setRestitution(0.05)
          .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(e.cap * e.area * this._impactK(e)),
        e.body,
      );
      colMap.set(e.col.handle, e);
      this._writeAttrs(e, aColor, aInfo, aDims, aCore);
      if (!this.overlay) {
        m.compose(new THREE.Vector3(e.cx, e.cy, e.cz), e.q, new THREE.Vector3(e.hx * 2, e.hy * 2, e.hz * 2));
        mesh.setMatrixAt(i, m);
      }
    });
    this.colMap = colMap;
    this.attrs = { aColor, aInfo, aDims, aCore, geo };
    this.object3d.add(mesh);
    this.mesh = mesh;
    this.world = world;
    this.events = new R.EventQueue(true);
    this.R = R;
    this._buildPuffs();
    this.tV = null;
    this.acc = 0;
    this.stats = { released: 0, fragments: 0, collapsed: 0 };
    this.ready = true;
    return true;
  }

  /**
   * Quanto de impacto (× a carga de ruptura) uma peça presa aguenta: lajes de pórtico têm pilares
   * por baixo e resistem bem mais a destroços do que as de paredes portantes.
   */
  _impactK(e) {
    if (e.kind === 0) return 0.8;
    return e.B.frame ? 2.5 : 1.0;
  }

  _writeAttrs(e, aColor, aInfo, aDims, aCore) {
    const s = e.slot;
    aColor.set(e.color, s * 3);
    aInfo.set([e.kind, e.B.burn, e.B.heat, e.B.arrV], s * 4);
    aDims.set([e.hx * 2, e.hy * 2, e.hz * 2], s * 3);
    aCore.set(e.core, s * 3);
  }

  _buildPuffs() {
    const N = 3000;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.puffPos = new Float32Array(N * 3);
    this.puffT = new Float32Array(N * 4).fill(-1e9);
    this.puffVel = new Float32Array(N * 3);
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.puffPos, 3));
    geo.setAttribute('iT', new THREE.InstancedBufferAttribute(this.puffT, 4));
    geo.setAttribute('iVel', new THREE.InstancedBufferAttribute(this.puffVel, 3));
    geo.instanceCount = N;
    this.puffN = N;
    this.puffNext = 0;
    const mesh = new THREE.Mesh(geo, this.puffMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.object3d.add(mesh);
    this.puffs = mesh;
  }

  _puff(x, y, z, size, life, vx = 0, vy = 0) {
    const i = this.puffNext;
    this.puffNext = (i + 1) % this.puffN;
    this.puffPos.set([x, y, z], i * 3);
    this.puffT.set([this.tV, size, size * 0.9, life], i * 4);
    this.puffVel.set([vx, vy, 0], i * 3);
    this._puffDirty = true;
  }

  /* ------------------------------ dinâmica ------------------------------ */

  _release(e, t, vel = null) {
    if (e.state !== 0) return;
    e.state = 1;
    e.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    e.col.setContactForceEventThreshold(e.body.mass() * 9.81 * 30);
    if (vel) e.body.setLinvel(vel, true);
    this.stats.released++;
    const B = e.B;
    // poeira de quando a peça se solta
    if (Math.random() < 0.6) this._puff(e.cx, e.cy, e.cz, Math.max(e.hx, e.hz) * 1.4, 3 + Math.random() * 3, B.dir[0] * 4, B.dir[1] * 4);
    if (e.kind === 0) {
      B.storyIntact[e.story]--;
      // a parede de cima perde o apoio
      if (e.above >= 0) {
        const a = this.els[e.above];
        if (a.state === 0) a.releaseAt = Math.min(a.releaseAt, t + 0.08 + Math.random() * 0.25);
      }
      // telhado/laje junto à parede que caiu
      if (e.story === B.nE - 1 || (!B.frame && Math.random() < 0.5)) {
        for (const id of B.slabs[e.story + 1] || []) {
          const sl = this.els[id];
          if (sl.state === 0 && sl.edgeCell && Math.hypot(sl.cx - e.cx, sl.cy - e.cy) < Math.max(e.hx, sl.hx) * 2.2 && Math.random() < 0.6) {
            sl.releaseAt = Math.min(sl.releaseAt, t + 0.1 + Math.random() * 0.3);
          }
        }
      }
      // paredes portantes: andar sem a maior parte das paredes → tudo o que está acima desaba
      const tot = B.storyWalls[e.story].length;
      if (!B.frame && tot && B.storyIntact[e.story] / tot < 0.5) this._collapse(B, e.story, t);
    }
  }

  /** Colapso progressivo a partir do andar k ("panqueca"). */
  _collapse(B, k, t) {
    if (k >= B.collapseFrom) return;
    B.collapseFrom = k;
    this.stats.collapsed++;
    for (let s = k; s < B.nE; s++) {
      for (const id of B.storyWalls[s]) {
        const w = this.els[id];
        if (w.state === 0) w.releaseAt = Math.min(w.releaseAt, t + 0.04 * (s - k) + Math.random() * 0.12);
      }
      for (const id of B.slabs[s + 1]) {
        const sl = this.els[id];
        if (sl.state === 0) sl.releaseAt = Math.min(sl.releaseAt, t + 0.04 * (s - k) + Math.random() * 0.1);
      }
    }
  }

  /** Divide uma peça em duas ao longo do maior eixo (impacto forte). */
  _split(e) {
    if (e.state !== 1 || e.gen >= 3 || !this.free.length) return;
    const ax = e.hx >= e.hy && e.hx >= e.hz ? 'hx' : e.hy >= e.hz ? 'hy' : 'hz';
    if (e[ax] < 0.75) return;
    const R = this.R;
    const t = e.body.translation();
    const r = e.body.rotation();
    const v = e.body.linvel();
    const w = e.body.angvel();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const half = e[ax] / 2;
    const off = new THREE.Vector3(ax === 'hx' ? 1 : 0, ax === 'hy' ? 1 : 0, ax === 'hz' ? 1 : 0).multiplyScalar(half).applyQuaternion(q);
    const proto = { ...e };
    this.colMap.delete(e.col.handle);
    this.world.removeRigidBody(e.body);
    const mk = (sign, slot, base) => {
      const n = base || { ...proto };
      n[ax] = half;
      n.slot = slot;
      n.gen = e.gen + 1;
      n.state = 1;
      n.body = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
        .setTranslation(t.x + off.x * sign, t.y + off.y * sign, t.z + off.z * sign)
        .setRotation(r)
        .setLinvel(v.x + off.x * sign * 0.6, v.y + off.y * sign * 0.6, v.z + 0.5)
        .setAngvel({ x: w.x + (Math.random() - 0.5) * 2, y: w.y + (Math.random() - 0.5) * 2, z: w.z })
        .setLinearDamping(0.05).setAngularDamping(0.3));
      n.col = this.world.createCollider(R.ColliderDesc.cuboid(n.hx, n.hy, n.hz).setDensity(n.rho).setFriction(0.8).setRestitution(0.08)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS), n.body);
      n.col.setContactForceEventThreshold(n.body.mass() * 9.81 * 30);
      this.colMap.set(n.col.handle, n);
      const A = this.attrs;
      this._writeAttrs(n, A.aColor, A.aInfo, A.aDims, A.aCore);
      return n;
    };
    mk(1, e.slot, e);
    const b = mk(-1, this.free.pop(), null);
    b.synced = false;
    e.synced = false;
    this.els.push(b);
    this.stats.fragments++;
    this._attrDirty = true;
    this._puff(t.x, t.y, t.z, Math.max(e.hx, e.hz) * 1.6, 4 + Math.random() * 3);
  }

  /** Carga da onda (Pa) numa peça no tempo de tela tV. */
  _load(e, tV) {
    const B = e.B;
    const tau = ((tV - B.arrV) * this.accel) / B.td;
    if (tau < 0 || tau >= 1) return 0;
    const p = B.P * (1 - tau) * Math.exp(-tau);
    if (e.kind === 0) return p * loadFactor(e.facing, B.refl);
    if (e.kind === 2) return p; // cobertura: empurrada para baixo
    // lajes internas só sentem a onda depois que a fachada do andar se foi
    const tot = B.storyWalls[e.story - 1]?.length || 1;
    return (B.storyWalls[e.story - 1] ? 1 - B.storyIntact[e.story - 1] / tot : 1) > 0.4 ? p * 0.6 : 0;
  }

  /** Avança a física até o tempo de tela `tau`. */
  update(ctx) {
    const u = this.uniforms;
    u.uTime.value = ctx.tau;
    u.uFlash.value = this.flash;
    u.uPulse.value = this.pulse;
    this.puffUniforms.uTime.value = ctx.tau;
    if (ctx.right) this.puffUniforms.uRight.value.copy(ctx.right);
    if (ctx.up) this.puffUniforms.uUp.value.copy(ctx.up);
    if (!this.ready || ctx.tau < 0) return;
    const tau = ctx.tau;
    if (this.tV !== null && tau < this.tV - 0.25) { this._restart(); }
    if (this.tV === null) { this.tV = tau; return; }
    this.acc = Math.min(this.acc + Math.max(0, tau - this.tV), 0.35);
    let steps = 0;
    while (this.acc >= DT && steps < 6) {
      this._step(this.tV + DT);
      this.tV += DT;
      this.acc -= DT;
      steps++;
    }
    if (steps === 0 && tau > this.tV) this.tV = Math.max(this.tV, tau - this.acc);
    this._sync();
  }

  _restart() {
    // linha do tempo voltou: reconstrói a partir do plano
    this.els = this._plan.map((e) => ({ ...e }));
    for (const B of this.blds) {
      B.storyIntact = B.storyWalls.map((w) => w.length);
      B.collapseFrom = Infinity;
    }
    const opts = this._buildOpts;
    this.ready = false;
    if (this.world) { this.world.free(); this.world = null; }
    if (this.events) { this.events.free(); this.events = null; }
    for (const m of [this.mesh, this.puffs]) if (m) { this.object3d.remove(m); m.geometry.dispose(); }
    this.build(opts);
  }

  _step(tV) {
    const R = this.R;
    const els = this.els;
    const acc = this.accel;
    const rhoAir = 1.4;
    const imp = { x: 0, y: 0, z: 0 };
    // 1) rupturas agendadas (perda de apoio) e por carga da onda
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.state === 0) {
        if (tV >= e.releaseAt) { this._release(e, tV); continue; }
        if (tV < e.B.arrV) continue;
        const p = this._load(e, tV);
        if (p > e.cap) this._release(e, tV);
      }
    }
    // estruturas em pórtico sob pressão muito alta: colapso geral pouco depois da chegada
    for (const B of this.blds) {
      if (B.frame && B.level >= 5 && B.collapseFrom === Infinity && tV > B.arrV + 0.25) this._collapse(B, 0, tV);
    }
    // 2) forças sobre as peças soltas: pressão (só durante a fase positiva) + arrasto do vento
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.state !== 1) continue;
      const B = e.B;
      const tau = ((tV - B.arrV) * acc) / B.td;
      if (tau < 0 || tau >= 1.6) continue;
      const decay = tau < 1 ? (1 - tau) * Math.exp(-tau) : 0;
      let fx = 0; let fy = 0; let fz = 0;
      if (tau < 1 && e.gen === 0) {
        const p = this._load(e, tV);
        const F = p * e.area * acc;
        if (e.kind === 0) { fx += B.dir[0] * F; fy += B.dir[1] * F; } else { fz -= F * 0.5; fx += B.dir[0] * F * 0.3; fy += B.dir[1] * F * 0.3; }
      }
      // arrasto: ½ρ C_d A |u − v|(u − v), com o vento da onda u ao longo da direção radial
      const v = e.body.linvel();
      // vento da onda: para fora na fase positiva, breve retorno (sucção) na negativa
      const uw = tau < 1 ? B.wind * decay : -0.12 * B.wind * Math.sin((Math.PI * (tau - 1)) / 0.6);
      const rx = B.dir[0] * uw - v.x; const ry = B.dir[1] * uw - v.y; const rz = -v.z * 0.3;
      const rel = Math.hypot(rx, ry, rz);
      const Aeff = (4 * e.hx * e.hz + 4 * e.hy * e.hz + 4 * e.hx * e.hy) / 3;
      const D = 0.5 * rhoAir * 1.2 * Aeff * rel * acc;
      fx += D * rx; fy += D * ry; fz += D * rz;
      imp.x = fx * DT; imp.y = fy * DT; imp.z = fz * DT;
      e.body.applyImpulse(imp, true);
    }
    // 3) passo da física + eventos de impacto
    this.world.step(this.events);
    const splits = [];
    this.events.drainContactForceEvents((ev) => {
      const F = ev.totalForceMagnitude();
      for (const h of [ev.collider1(), ev.collider2()]) {
        const e = this.colMap.get(h);
        if (!e) continue;
        if (e.state === 0) {
          // impacto de destroços quebra peças ainda presas
          if (F > e.cap * e.area * this._impactK(e)) e.releaseAt = Math.min(e.releaseAt, tV + 0.02);
        } else if (e.state === 1 && splits.length < 24 && F > e.body.mass() * 9.81 * 30) {
          splits.push(e);
        }
      }
    });
    for (const e of splits) this._split(e);
  }

  _sync() {
    const mesh = this.mesh;
    const m = this._m || (this._m = new THREE.Matrix4());
    const p = this._p || (this._p = new THREE.Vector3());
    const q = this._q || (this._q = new THREE.Quaternion());
    const s = this._s || (this._s = new THREE.Vector3());
    let any = false;
    for (const e of this.els) {
      if (e.state !== 1 || !e.body) continue;
      if (e.body.isSleeping() && e.synced) continue;
      const t = e.body.translation();
      const r = e.body.rotation();
      p.set(t.x, t.y, t.z);
      q.set(r.x, r.y, r.z, r.w);
      s.set(e.hx * 2, e.hy * 2, e.hz * 2);
      m.compose(p, q, s);
      mesh.setMatrixAt(e.slot, m);
      e.synced = e.body.isSleeping();
      any = true;
    }
    if (any) mesh.instanceMatrix.needsUpdate = true;
    if (this._attrDirty) {
      const g = this.attrs.geo;
      for (const k of ['iColor', 'iInfo', 'iDims', 'iCore']) g.getAttribute(k).needsUpdate = true;
      this._attrDirty = false;
    }
    if (this._puffDirty && this.puffs) {
      const g = this.puffs.geometry;
      g.getAttribute('iPos').needsUpdate = true;
      g.getAttribute('iT').needsUpdate = true;
      g.getAttribute('iVel').needsUpdate = true;
      this._puffDirty = false;
    }
  }
}
