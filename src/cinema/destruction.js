/**
 * Destruição da malha fotogramétrica (Google 3D Tiles / Cesium) na GPU.
 *
 * A cidade fotografada é uma malha contínua (não há "prédios" separados), então a
 * destruição é feita por vértice, no shader:
 *  - cada vértice consulta a distância ao ponto zero numa tabela (LUT) com o tempo
 *    de chegada da onda de choque, o nível de dano e o grau térmico;
 *  - uma grade de alturas (chão / topo), medida a partir da própria malha, diz onde
 *    fica o chão; tudo que está acima "desaba" em direção a ele conforme o dano;
 *  - fachadas voltadas para a explosão carbonizam, focos de incêndio brilham e o
 *    entulho ganha cor de concreto pulverizado.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const LUT_N = 512;
const GRID_N = 128;

export function createDestructionUniforms() {
  const lut = new THREE.DataTexture(new Float32Array(LUT_N * 4).fill(0), LUT_N, 1, THREE.RGBAFormat, THREE.FloatType);
  lut.minFilter = lut.magFilter = THREE.LinearFilter;
  lut.needsUpdate = true;
  const grid = new THREE.DataTexture(new Float32Array(GRID_N * GRID_N * 4).fill(0), GRID_N, GRID_N, THREE.RGBAFormat, THREE.FloatType);
  grid.minFilter = grid.magFilter = THREE.LinearFilter;
  grid.needsUpdate = true;
  return {
    uDLut: { value: lut },
    uDRmax: { value: 1 },
    uDTime: { value: -1 },
    uDGroundY: { value: 0 },
    uDGrid: { value: grid },
    uDGridR: { value: 1000 },
    uDCollapse: { value: CONFIG.anim.collapseSeconds },
    uDNow: { value: 0 },
    uDFire: { value: 1 },
  };
}

/** Preenche a LUT distância → (chegada visual, nível, grau térmico, psi normalizado). */
export function fillLut(uniforms, fx, accel) {
  const rMax = Math.max(fx.radius.blast1, fx.radius.thermal1) * 1.05;
  const tex = uniforms.uDLut.value;
  const d = tex.image.data;
  for (let i = 0; i < LUT_N; i++) {
    const r = (i / (LUT_N - 1)) * rMax;
    d[i * 4] = fx.arrivalAt(r) / accel;
    d[i * 4 + 1] = fx.damageLevelAt(r);
    d[i * 4 + 2] = fx.burnDegreeAt(r);
    d[i * 4 + 3] = Math.min(1, Math.log10(fx.psiAt(r) + 1) / 2);
  }
  tex.needsUpdate = true;
  uniforms.uDRmax.value = rMax * 1000;
}

/**
 * Mede chão e topo em uma grade, a partir dos vértices dos tiles carregados.
 * @param {THREE.Object3D} root grupo com as malhas
 * @param {(v:THREE.Vector3)=>[number,number,number]} toENU mundo → (leste, norte, cima)
 */
export function buildHeightGrid(uniforms, root, toENU, radiusM) {
  const N = GRID_N;
  const ground = new Float32Array(N * N).fill(Infinity);
  const top = new Float32Array(N * N).fill(-Infinity);
  const v = new THREE.Vector3();
  const R = radiusM;
  let count = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    o.updateMatrixWorld();
    const step = pos.count > 60000 ? 3 : 1;
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const [e, n, u] = toENU(v);
      const gx = Math.floor(((e / R) * 0.5 + 0.5) * N);
      const gy = Math.floor(((n / R) * 0.5 + 0.5) * N);
      if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
      const k = gy * N + gx;
      if (u < ground[k]) ground[k] = u;
      if (u > top[k]) top[k] = u;
      count++;
    }
  });
  // preenche células vazias com o vizinho válido mais próximo e suaviza o chão (mínimo 3×3)
  const g2 = new Float32Array(N * N);
  let fallback = 0;
  let nValid = 0;
  for (let k = 0; k < N * N; k++) if (Number.isFinite(ground[k])) { fallback += ground[k]; nValid++; }
  fallback = nValid ? fallback / nValid : 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let m = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx; const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const gv = ground[yy * N + xx];
      if (gv < m) m = gv;
    }
    g2[y * N + x] = Number.isFinite(m) ? m : fallback;
  }
  const tex = uniforms.uDGrid.value;
  const d = tex.image.data;
  for (let k = 0; k < N * N; k++) {
    d[k * 4] = g2[k];
    d[k * 4 + 1] = Number.isFinite(top[k]) ? top[k] : g2[k];
  }
  tex.needsUpdate = true;
  uniforms.uDGridR.value = R;
  return { count, grid: { ground: g2, top, N, R } };
}

const VERT_HEAD = /* glsl */ `
uniform sampler2D uDLut;
uniform float uDRmax;
uniform float uDTime;
uniform float uDGroundY;
uniform sampler2D uDGrid;
uniform float uDGridR;
uniform float uDCollapse;
varying vec4 vDestr;
varying vec3 vDEnu;
float dHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const VERT_BODY = /* glsl */ `
{
  vec4 dW = modelMatrix * vec4(transformed, 1.0);
  vec3 enu = vec3(-dW.x, dW.z, dW.y - uDGroundY);
  float dR = length(enu.xy);
  vec4 L = texture(uDLut, vec2(clamp(dR / uDRmax, 0.0, 1.0) * (511.0 / 512.0) + 0.5 / 512.0, 0.5));
  float inside = dR < uDRmax ? 1.0 : 0.0;
  float lvl = L.g * inside;
  float dt = uDTime - L.r;
  vec2 guv = enu.xy / (2.0 * uDGridR) + 0.5;
  float ground = (guv.x > 0.0 && guv.y > 0.0 && guv.x < 1.0 && guv.y < 1.0) ? texture(uDGrid, guv).r : 0.0;
  float rel = max(enu.z - ground, 0.0);
  float hsh = dHash(floor(enu.xy / 16.0));
  float prog = 0.0;
  if (uDTime >= 0.0 && dt > 0.0 && lvl > 1.5) prog = smoothstep(0.0, uDCollapse * (0.7 + 0.7 * hsh), dt);
  float hf = lvl > 4.5 ? 0.03 : (lvl > 3.5 ? 0.14 : (lvl > 2.5 ? 0.5 : (lvl > 1.5 ? 0.94 : 1.0)));
  float newRel = rel * mix(1.0, hf, prog * (0.85 + 0.15 * hsh));
  vec2 away = dR > 0.5 ? enu.xy / dR : vec2(1.0, 0.0);
  float lean = lvl > 1.5 ? prog * min(rel, 60.0) * 0.05 * (lvl - 1.0) : 0.0;
  vec2 jit = vec2(dHash(enu.xy * 0.37 + enu.z), dHash(enu.yx * 0.41 - enu.z)) - 0.5;
  float crumble = lvl > 2.5 ? prog * min(rel, 50.0) * 0.18 : 0.0;
  enu.xy += away * lean + jit * crumble;
  enu.z = ground + newRel;
  dW.xyz = vec3(-enu.x, enu.z + uDGroundY, enu.y);
  transformed = (inverse(modelMatrix) * dW).xyz;
  vDestr = vec4(lvl, prog, L.b * inside, dt);
  vDEnu = enu;
}
`;

const FRAG_HEAD = /* glsl */ `
uniform float uDTime;
uniform float uDNow;
uniform float uDFire;
varying vec4 vDestr;
varying vec3 vDEnu;
float dHashF(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const FRAG_COLOR = /* glsl */ `
{
  float burn = vDestr.z;
  if (uDTime > 0.0 && burn > 0.5) {
    float amt = clamp(burn / 3.0, 0.0, 1.0) * smoothstep(0.0, 0.6, uDTime);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.035, 0.03), amt * 0.8);
  }
  if (vDestr.y > 0.05 && vDestr.x > 2.5) {
    float n = dHashF(floor(vDEnu.xy * 0.7));
    vec3 rubble = mix(vec3(0.36, 0.33, 0.30), vec3(0.20, 0.18, 0.16), n);
    diffuseColor.rgb = mix(diffuseColor.rgb, rubble, 0.65 * vDestr.y);
  }
}
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  float burn = vDestr.z;
  if (uDTime > 0.3 && (burn > 1.5 || (vDestr.x > 3.5 && vDestr.w > 0.0))) {
    float cell = dHashF(floor(vDEnu.xy / 9.0));
    if (cell > 0.55) {
      float fl = 0.55 + 0.45 * sin(uDNow * 8.0 + cell * 60.0 + vDEnu.z * 0.5) * sin(uDNow * 4.7 + vDEnu.x * 0.3);
      float low = 1.0 - smoothstep(0.0, 25.0, vDEnu.z);
      float grow = smoothstep(0.3, 4.0, uDTime);
      totalEmissiveRadiance += vec3(1.0, 0.33, 0.06) * fl * grow * (0.3 + 0.7 * low) * 3.0 * uDFire * (cell - 0.55) * 2.2;
    }
  }
}
`;

/**
 * Converte o material de um tile (geralmente "unlit") num Lambert que recebe a luz
 * da bola de fogo (com sombras) e se deforma/carboniza conforme a explosão.
 */
export function patchMaterial(oldMat, uniforms) {
  const m = new THREE.MeshLambertMaterial({
    map: oldMat.map || null,
    color: oldMat.color ? oldMat.color.clone() : new THREE.Color(1, 1, 1),
    flatShading: true,
    transparent: oldMat.transparent,
    opacity: oldMat.opacity ?? 1,
    side: THREE.FrontSide,
  });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_COLOR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  m.customProgramCacheKey = () => 'sen-destr-v1';
  return m;
}
