/**
 * Cidade destrutível: todos os prédios reais (OSM) numa única malha na GPU.
 *
 * Cada vértice guarda só posição + id do prédio + coordenada ao longo da fachada.
 * Os dados por prédio ficam em texturas de ponto flutuante (lidas com texelFetch):
 *   texA = (centroX, centroY, topo, base)       — estáticos
 *   texB = (chegada da onda, nível de dano, semente, grau térmico) — por detonação
 *   texC = (r, g, b, altura estimada?)           — cor
 * O colapso, a inclinação, o esfarelamento, as janelas, a carbonização e o fogo
 * são calculados no shader, então dezenas de milhares de prédios animam a 60 fps.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { pointInRing } from '../map/geo.js';
import { hash01 } from '../services/overpass.js';
import { materialOf, materialResponse, positivePhaseSeconds } from '../physics/structures.js';

const TEX_W = 1024;

const DAMAGE_RGB = [0, 1, 2, 3, 4, 5].map((lvl) => {
  const hex = CONFIG.damage.find((d) => d.level === lvl).color;
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
});

const VERT = /* glsl */ `
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform sampler2D uTexC;
uniform float uTime;
uniform float uCollapse;
uniform vec2 uGZ;
attribute float aId;
attribute float aU;
attribute float aElev;
varying vec3 vPos;
varying vec3 vColor;
varying vec2 vCenter;
varying float vU;
varying float vWinZ;
varying float vLevel;
varying float vProg;
varying float vBurn;
varying float vSeed;
varying float vT;
varying float vEst;

ivec2 tc(float id) { int i = int(id + 0.5); return ivec2(i % ${TEX_W}, i / ${TEX_W}); }

void main() {
  ivec2 c = tc(aId);
  vec4 A = texelFetch(uTexA, c, 0);
  vec4 D = texelFetch(uTexB, c, 0);
  vec4 C = texelFetch(uTexC, c, 0);
  vec3 p = position;
  float H = max(A.z - A.w, 0.5);
  float rel = clamp((p.z - A.w) / H, 0.0, 1.0);
  float t = uTime - D.x;
  float lvl = D.y;
  float seed = D.z;
  float prog = 0.0;
  if (uTime >= 0.0 && t > 0.0 && lvl > 1.5) prog = smoothstep(0.0, uCollapse * (0.6 + seed * 0.9), t);
  // fração da altura que sobra após o colapso
  float hf = lvl > 5.5 ? 0.0 : lvl > 4.5 ? 0.035 : (lvl > 3.5 ? 0.17 : (lvl > 2.5 ? 0.52 : (lvl > 1.5 ? 0.94 : 1.0)));
  vec2 away = A.xy - uGZ;
  float dist = length(away);
  away = dist > 0.01 ? away / dist : vec2(1.0, 0.0);
  // queda progressiva de cima para baixo (andares "panquecam")
  float fall = prog * (0.75 + 0.25 * rel);
  float newRel = rel * mix(1.0, hf, fall);
  // inclinação para longe do ponto zero (danos parciais)
  float lean = (lvl > 1.5 && lvl < 4.5) ? prog * rel * H * (0.04 + 0.05 * (lvl - 2.0)) : 0.0;
  // esfarelamento: deslocamento pseudoaleatório dos vértices superiores
  vec2 jit = vec2(sin(seed * 91.7 + p.x * 0.37 + p.y * 0.11), cos(seed * 47.3 + p.y * 0.41 - p.x * 0.13));
  float crumble = lvl > 2.5 ? prog * (0.2 + 0.8 * rel) * min(H, 45.0) * 0.07 : 0.0;
  // entulho espalhado para fora a partir do centro do prédio
  vec2 fromC = p.xy - A.xy;
  float spread = lvl > 3.5 ? prog * (0.18 + 0.12 * seed) : 0.0;
  p.xy += away * lean + jit * crumble + fromC * spread + away * spread * 4.0;
  p.z = A.w + newRel * H;
  vPos = p;
  p.z += aElev;
  vColor = C.rgb;
  vEst = mod(C.a, 2.0);
  // prédio entregue à física estrutural: some daqui (as peças físicas ocupam o lugar)
  if (C.a > 1.5 && uTime >= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vCenter = A.xy;
  vU = aU;
  vWinZ = position.z - A.w;
  vLevel = lvl;
  vProg = prog;
  vBurn = D.w;
  vSeed = seed;
  vT = t;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uNow;
uniform float uTint;
uniform float uFlash;
uniform float uPulse;
uniform vec3 uSunDir;
uniform vec3 uFirePos;
uniform float uFireLight;
uniform float uFireRange2;
uniform vec2 uGZ;
uniform vec3 uDamage[6];
uniform float uLightScale;
uniform float uGammaOut;
uniform float uEmissiveBoost;
varying vec3 vPos;
varying vec3 vColor;
varying vec2 vCenter;
varying float vU;
varying float vWinZ;
varying float vLevel;
varying float vProg;
varying float vBurn;
varying float vSeed;
varying float vT;
varying float vEst;

float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  bool roof = abs(n.z) > 0.6;
  vec3 base = vColor;
  bool hit = uTime >= 0.0 && vT > 0.0;
  base = pow(base, vec3(uGammaOut));

  bool rubble = hit && vLevel > 2.5 && vProg > 0.25;
  if (rubble) {
    // entulho: concreto quebrado, poeira e manchas escuras, sem janelas
    vec2 q = floor(vPos.xy * 0.6 + vPos.z * 0.9);
    float n1 = h21(q + vSeed * 31.0);
    vec3 dustC = mix(vec3(0.46, 0.43, 0.39), vec3(0.30, 0.27, 0.24), n1);
    base = mix(base * 0.7, dustC, 0.55 + 0.35 * vProg);
    base *= 0.75 + 0.35 * h21(floor(vPos.xy * 2.3));
  } else if (!roof) {
    // fachada com janelas procedurais (andares de 3,2 m)
    float fz = fract(vWinZ / 3.2);
    float fu = fract(vU / 3.4);
    vec2 cell = floor(vec2(vU / 3.4, vWinZ / 3.2));
    float win = step(0.30, fz) * step(fz, 0.80) * step(0.20, fu) * step(fu, 0.80) * step(1.4, vWinZ);
    // antisserrilhamento: longe da câmera o padrão vira um tom médio
    float fw = max(fwidth(vU / 3.4), fwidth(vWinZ / 3.2));
    win = mix(win, 0.27, smoothstep(0.25, 0.7, fw));
    float hw = h21(cell + vSeed * 17.0);
    vec3 glass = mix(vec3(0.09, 0.12, 0.16), vec3(0.36, 0.43, 0.52), hw * 0.7);
    if (hit && vLevel > 0.5) glass = mix(vec3(0.02), vec3(0.05, 0.04, 0.04), hw); // vidros estilhaçados
    base = mix(base, glass, win * 0.88);
    base *= 1.0 - 0.10 * (1.0 - smoothstep(0.0, 0.07, fz)); // linha de laje
  } else {
    base *= 0.9 + 0.1 * h21(floor(vPos.xy * 0.25));
  }

  // carbonização pelo pulso térmico (mais forte nas faces voltadas para a explosão)
  if (uTime > 0.0 && vBurn > 0.5) {
    vec2 toGZ = normalize(uGZ - vCenter + 1e-3);
    float facing = roof ? 0.7 : max(dot(n.xy, toGZ), 0.0);
    float amt = clamp(vBurn / 3.0, 0.0, 1.0) * (0.3 + 0.7 * facing) * clamp(uPulse * 1.15, 0.0, 1.0);
    base = mix(base, vec3(0.07, 0.05, 0.045), amt * 0.85);
  }

  float diff = max(dot(n, uSunDir), 0.0);
  float sky = 0.5 + 0.5 * n.z;
  vec3 col = base * (0.36 + 0.55 * diff + 0.18 * sky) * uLightScale;
  col *= mix(0.7, 1.0, smoothstep(0.0, 10.0, vWinZ)); // oclusão perto do chão

  // luz da bola de fogo
  vec3 L = uFirePos - vPos;
  float d2 = dot(L, L);
  float fl = uFireLight * max(dot(n, normalize(L)), 0.0) / (1.0 + d2 / uFireRange2);
  col += vec3(1.0, 0.78, 0.5) * fl;

  // coloração por nível de dano (opcional)
  if (uTint > 0.0 && hit) {
    int li = min(int(vLevel + 0.5), 5);
    vec3 dc = uDamage[li];
    float k = uTint * smoothstep(0.0, 0.35, vT) * (li == 0 ? 0.0 : 0.7);
    col = mix(col, dc * (0.45 + 0.45 * diff + 0.25 * sky) * (rubble ? 0.8 : 1.0), k);
  }

  // incêndios (zona térmica e prédios colapsados)
  if (uTime > 0.0 && uPulse > 0.5 && (vBurn > 1.5 || (hit && vLevel > 3.5)) && vSeed > 0.3) {
    float flick = 0.55 + 0.45 * sin(uNow * 9.0 + vSeed * 50.0 + vWinZ * 0.7) * sin(uNow * 5.3 + vU * 0.5);
    float lowZ = 1.0 - smoothstep(0.0, 22.0, vWinZ * (1.0 - vProg * 0.8));
    float fire = smoothstep(0.2, 3.0, uTime) * flick * (roof ? 0.35 : 1.0) * (0.35 + 0.65 * lowZ);
    col += vec3(1.0, 0.4, 0.07) * fire * 0.6 * uEmissiveBoost;
  }

  col = mix(col, vec3(1.0, 0.98, 0.94), uFlash);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** Remove pontos repetidos/colineares quase nulos e o ponto de fechamento. */
function cleanRing(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) out.pop();
  }
  return out;
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a) / 2;
}

function centroid(r) {
  let x = 0; let y = 0;
  for (const p of r) { x += p[0]; y += p[1]; }
  return [x / r.length, y / r.length];
}

function makeTex(data, h) {
  const t = new THREE.DataTexture(data, TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class City {
  constructor(layer) {
    this.layer = layer;
    this.object3d = new THREE.Group();
    this.object3d.name = 'city';
    this.buildings = [];
    this.mesh = null;
    this.tint = 1;
    this.fire = { pos: new THREE.Vector3(), light: 0, range: 1000 };
    this.gzLocal = [0, 0];
    this.flash = 0;
    this.pulse = 0; // fração do pulso térmico já emitida (0–1)
    // ajustes usados pelo modo cinema (saída linear/HDR e iluminação por hora do dia)
    this.lightScale = 1;
    this.gammaOut = 1;
    this.emissiveBoost = 1;
  }

  get loaded() {
    return this.buildings.length > 0;
  }

  /**
   * Constrói a malha a partir dos prédios do Overpass.
   * @param {Array} list registros de parseBuildings()
   */
  setBuildings(list) {
    this.dispose();
    const L = this.layer;
    const recs = [];
    let nv = 0;
    let ni = 0;
    for (const b of list) {
      const outer = cleanRing(b.outer.map(([lng, lat]) => L.toLocal(lng, lat)));
      if (outer.length < 3) continue;
      const area = ringArea(outer);
      if (area < 4) continue;
      const holes = b.holes.map((h) => cleanRing(h.map(([lng, lat]) => L.toLocal(lng, lat)))).filter((h) => h.length >= 3);
      const rings = [outer, ...holes];
      let tris;
      try {
        tris = THREE.ShapeUtils.triangulateShape(outer.map((p) => new THREE.Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
      } catch {
        continue;
      }
      if (!tris.length) continue;
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (const [x, y] of outer) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const verts = rings.reduce((s, r) => s + 2 * (r.length + 1), 0);
      const idx = rings.reduce((s, r) => s + 6 * r.length, 0) + tris.length * 3;
      recs.push({ src: b, outer, holes, rings, tris, area, c: centroid(outer), bbox: [minX, minY, maxX, maxY], verts, idx });
      nv += verts;
      ni += idx;
    }

    const pos = new Float32Array(nv * 3);
    const aId = new Float32Array(nv);
    const aU = new Float32Array(nv);
    const aElev = new Float32Array(nv);
    const index = new Uint32Array(ni);
    const rows = Math.max(1, Math.ceil(recs.length / TEX_W));
    const A = new Float32Array(TEX_W * rows * 4);
    const Bd = new Float32Array(TEX_W * rows * 4);
    const C = new Float32Array(TEX_W * rows * 4);

    let v = 0;
    let k = 0;
    recs.forEach((r, i) => {
      const b = r.src;
      const top = b.height;
      const base = b.minHeight;
      r.top = top;
      r.base = base;
      r.vStart = v;
      const ringStart = [];
      for (const ring of r.rings) {
        ringStart.push(v);
        let u = 0;
        const n = ring.length;
        for (let q = 0; q <= n; q++) {
          const p = ring[q % n];
          if (q > 0) {
            const pp = ring[q - 1];
            u += Math.hypot(p[0] - pp[0], p[1] - pp[1]);
          }
          // base
          pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = base;
          aId[v] = i; aU[v] = u; v++;
          // topo
          pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = top;
          aId[v] = i; aU[v] = u; v++;
        }
        const s0 = ringStart[ringStart.length - 1];
        for (let q = 0; q < n; q++) {
          const b0 = s0 + 2 * q;
          const t0 = b0 + 1;
          const b1 = s0 + 2 * (q + 1);
          const t1 = b1 + 1;
          index[k++] = b0; index[k++] = b1; index[k++] = t1;
          index[k++] = b0; index[k++] = t1; index[k++] = t0;
        }
      }
      // telhado: índices de triangulação → vértices do topo de cada anel
      const offsets = [];
      let acc = 0;
      for (const ring of r.rings) { offsets.push(acc); acc += ring.length; }
      const topIndex = (gi) => {
        let ringNo = 0;
        while (ringNo + 1 < offsets.length && gi >= offsets[ringNo + 1]) ringNo++;
        return ringStart[ringNo] + 2 * (gi - offsets[ringNo]) + 1;
      };
      for (const tri of r.tris) {
        index[k++] = topIndex(tri[0]);
        index[k++] = topIndex(tri[1]);
        index[k++] = topIndex(tri[2]);
      }
      r.vEnd = v;
      A.set([r.c[0], r.c[1], top, base], i * 4);
      Bd.set([1e9, 0, hash01(b.id), 0], i * 4);
      C.set([b.color[0], b.color[1], b.color[2], b.estimated ? 1 : 0], i * 4);
      r.seed = hash01(b.id);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aId', new THREE.BufferAttribute(aId, 1));
    geo.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
    geo.setAttribute('aElev', new THREE.BufferAttribute(aElev, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();

    this.texA = makeTex(A, rows);
    this.texB = makeTex(Bd, rows);
    this.texC = makeTex(C, rows);
    this.dataB = Bd;
    this.dataC = C;

    this.uniforms = {
      uTexA: { value: this.texA },
      uTexB: { value: this.texB },
      uTexC: { value: this.texC },
      uTime: { value: -1 },
      uNow: { value: 0 },
      uCollapse: { value: CONFIG.anim.collapseSeconds },
      uGZ: { value: new THREE.Vector2() },
      uTint: { value: this.tint },
      uFlash: { value: 0 },
      uPulse: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-0.45, -0.35, 0.82).normalize() },
      uFirePos: { value: new THREE.Vector3() },
      uFireLight: { value: 0 },
      uFireRange2: { value: 1e6 },
      uDamage: { value: DAMAGE_RGB },
      uLightScale: { value: 1 },
      uGammaOut: { value: 1 },
      uEmissiveBoost: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.object3d.add(this.mesh);
    this.buildings = recs;
    this.elevAttr = geo.getAttribute('aElev');
    return recs.length;
  }

  /** Ajusta a base de cada prédio ao relevo (quando o terreno 3D está ativo). */
  applyTerrain(on) {
    if (!this.mesh) return;
    const arr = this.elevAttr.array;
    if (!on) {
      arr.fill(0);
      for (const r of this.buildings) r.elev = 0;
    } else {
      const map = this.layer.map;
      const o = this.layer.origin;
      const e0 = map.queryTerrainElevation(o) || 0;
      for (const r of this.buildings) {
        const ll = this.layer.toLngLat(r.c[0], r.c[1]);
        const e = (map.queryTerrainElevation(ll) ?? e0) - e0;
        arr.fill(e, r.vStart, r.vEnd);
        r.elev = e;
      }
    }
    this.elevAttr.needsUpdate = true;
  }

  /**
   * Calcula dano por prédio para uma detonação.
   * @returns estatísticas por nível
   */
  applyDetonation(fx, gzLocal, accel) {
    this.gzLocal = gzLocal;
    const counts = [0, 0, 0, 0, 0, 0];
    let floorArea = 0;
    let vaporized = 0;
    const rfb = fx.radius.fireball;
    this.buildings.forEach((r, i) => {
      const dKm = Math.hypot(r.c[0] - gzLocal[0], r.c[1] - gzLocal[1]) / 1000;
      const psi = fx.psiAt(dKm);
      // resposta por material: estrutura (1 grau de liberdade sob a fase positiva) + vidros
      r.mat = r.mat || materialOf({ ...r.src, height: r.top - r.base });
      const td = positivePhaseSeconds(Math.hypot(dKm, fx.hKm), fx.yieldKt);
      const resp = materialResponse(r.mat, psi, td);
      const glass = materialResponse('glass', psi, td);
      let lvl = Math.max(resp.level, Math.min(1, glass.level));
      // dentro da bola de fogo que toca o chão: vaporizado (não sobra nem entulho)
      const vap = dKm < rfb && fx.hKm < rfb;
      if (vap) lvl = 5;
      r.vaporized = vap;
      r.resp = { ...resp, td, glassLevel: glass.level };
      const arr = fx.arrivalAt(dKm) / accel;
      const burn = fx.burnDegreeAt(dKm);
      r.dKm = dKm; r.psi = psi; r.level = lvl; r.arrival = arr; r.burn = burn;
      r.arrivalReal = fx.arrivalAt(dKm);
      if (dKm < rfb && fx.hKm < rfb) vaporized++;
      counts[lvl]++;
      const levels = r.src.levels || Math.max(1, Math.round((r.top - r.base) / CONFIG.buildings.levelHeight_m));
      floorArea += r.area * levels;
      this.dataB[i * 4] = arr;
      this.dataB[i * 4 + 1] = r.vaporized ? 5.6 : lvl;
      this.dataB[i * 4 + 3] = burn;
    });
    this.texB.needsUpdate = true;
    return { counts, total: this.buildings.length, vaporized, floorArea };
  }

  /** Esconde (ou mostra de volta) os prédios cuja destruição fica por conta da física estrutural. */
  setPhysicsHidden(indices, hidden = true) {
    if (!this.dataC) return;
    for (const i of indices) {
      const k = i * 4 + 3;
      const est = this.dataC[k] % 2;
      this.dataC[k] = est + (hidden ? 2 : 0);
    }
    this.texC.needsUpdate = true;
  }

  /** Volta todos os prédios ao estado intacto. */
  reset() {
    if (!this.dataB) return;
    if (this.dataC) {
      for (let i = 0; i < this.buildings.length; i++) this.dataC[i * 4 + 3] %= 2;
      this.texC.needsUpdate = true;
    }
    for (let i = 0; i < this.buildings.length; i++) {
      this.dataB[i * 4] = 1e9;
      this.dataB[i * 4 + 1] = 0;
      this.dataB[i * 4 + 3] = 0;
      const r = this.buildings[i];
      r.level = undefined; r.psi = undefined; r.dKm = undefined;
    }
    this.texB.needsUpdate = true;
  }

  /** Área construída total (m²) — usada na estimativa automática de população. */
  totalFloorArea() {
    let s = 0;
    for (const r of this.buildings) {
      const levels = r.src.levels || Math.max(1, Math.round((r.top - r.base) / CONFIG.buildings.levelHeight_m));
      s += r.area * levels;
    }
    return s;
  }

  /** Seleciona o prédio sob um raio (coordenadas locais). */
  pick(ray) {
    const { origin: o, dir: d } = ray;
    const cands = [];
    for (let i = 0; i < this.buildings.length; i++) {
      const r = this.buildings[i];
      const [x0, y0, x1, y1] = r.bbox;
      let tmin = -Infinity; let tmax = Infinity;
      const slab = (oo, dd, lo, hi) => {
        if (Math.abs(dd) < 1e-12) return oo >= lo && oo <= hi;
        let a = (lo - oo) / dd; let b = (hi - oo) / dd;
        if (a > b) [a, b] = [b, a];
        tmin = Math.max(tmin, a); tmax = Math.min(tmax, b);
        return tmax >= tmin;
      };
      if (!slab(o.x, d.x, x0, x1) || !slab(o.y, d.y, y0, y1) || !slab(o.z, d.z, r.base, r.top)) continue;
      if (tmax < 0) continue;
      cands.push([Math.max(tmin, 0), tmax, i]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [t0, t1, i] of cands) {
      const r = this.buildings[i];
      const steps = 30;
      for (let s = 0; s <= steps; s++) {
        const t = t0 + ((t1 - t0) * s) / steps;
        const x = o.x + d.x * t;
        const y = o.y + d.y * t;
        const z = o.z + d.z * t;
        if (z < r.base - 0.5 || z > r.top + 0.5) continue;
        if (pointInRing(x, y, r.outer) && !r.holes.some((h) => pointInRing(x, y, h))) return r;
      }
    }
    return null;
  }

  update(ctx) {
    if (!this.uniforms) return;
    const u = this.uniforms;
    u.uTime.value = ctx.tau;
    u.uNow.value = ctx.now;
    u.uTint.value = this.tint;
    u.uGZ.value.set(this.gzLocal[0], this.gzLocal[1]);
    u.uFlash.value = this.flash;
    u.uPulse.value = ctx.tau < 0 ? 0 : this.pulse;
    if (this.fireSource) {
      this.fire.pos.copy(this.fireSource.center);
      this.fire.light = this.fireSource.light;
      this.fire.range = this.fireSource.range || 1000;
    }
    u.uFirePos.value.copy(this.fire.pos);
    u.uFireLight.value = this.fire.light;
    u.uFireRange2.value = this.fire.range * this.fire.range;
    u.uLightScale.value = this.lightScale;
    u.uGammaOut.value = this.gammaOut;
    u.uEmissiveBoost.value = this.emissiveBoost;
  }

  dispose() {
    if (this.mesh) {
      this.object3d.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.texA?.dispose(); this.texB?.dispose(); this.texC?.dispose();
    }
    this.mesh = null;
    this.uniforms = null;
    this.buildings = [];
  }
}
