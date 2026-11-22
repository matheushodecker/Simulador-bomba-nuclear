/**
 * Bola de fogo e nuvem em cogumelo VOLUMÉTRICAS (raymarching), no estilo das
 * nuvens de jogos AAA / volumetria do Blender:
 *  - forma por SDF (toroide em rolagem + domo + haste + saia de poeira + bola de fogo)
 *  - erosão por textura 3D Perlin-Worley (couve-flor)
 *  - luz do sol com auto-sombreamento (Beer–Lambert), função de fase Henyey–Greenstein
 *  - emissão de corpo negro na bola de fogo e no núcleo quente (alimenta o bloom)
 *  - luz da bola de fogo iluminando a base da nuvem
 * Renderizado em meia resolução contra o buffer de profundidade da cena e composto por cima.
 */
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { cloudNoiseTexture } from './noise3d.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
#include <packing>
uniform sampler2D tDepth;
uniform sampler3D tNoise;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform mat3 uWorldToENU;
uniform vec3 uCamENU;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform vec4 uCap;    // H, Rt, rt, stemR
uniform vec4 uStem;   // stemTop, stemGrow, skirtR, skirtAmt
uniform vec4 uFire;   // fbZ, fbR, fbTemp, fbAmt
uniform vec4 uMisc;   // heat, alpha, noiseScale, sigma
uniform vec2 uDrift;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uSteps;
uniform float uLightSteps;
uniform float uDust;
uniform float uEmission;
uniform float uCapAmt;
varying vec2 vUv;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

vec3 driftAt(float z) {
  float k = clamp(z / max(uCap.x + uCap.z, 1.0), 0.0, 1.2);
  return vec3(uDrift * k, 0.0);
}

float shapeSDF(vec3 p) {
  vec3 q = p - driftAt(p.z);
  float H = uCap.x; float Rt = uCap.y; float rt = uCap.z;
  float rho = length(q.xy);
  vec2 tq = vec2(rho - Rt, (q.z - H) / 0.78);
  float d = length(tq) - rt;
  vec3 dq = vec3(q.xy / max(Rt * 1.12, 1.0), (q.z - (H + rt * 0.38)) / max(rt * 1.05, 1.0));
  d = smin(d, (length(dq) - 1.0) * min(Rt, rt), rt * 0.5);
  d += (1.0 - uCapAmt) * (rt * 2.5 + 50.0); // o chapéu só aparece quando a bola de fogo sobe
  if (uStem.y > 0.001) {
    float top = uStem.x * uStem.y;
    float zt = clamp(q.z / max(uStem.x, 1.0), 0.0, 1.0);
    float sr = uCap.w * (1.0 + 1.8 * pow(1.0 - zt, 6.0)) * (1.0 + 0.6 * smoothstep(0.75, 1.0, zt));
    float dS = max(rho - sr, max(-q.z, q.z - top));
    d = smin(d, dS, uCap.w * 1.2);
  }
  if (uStem.w > 0.001) {
    vec2 sq = vec2(rho - uStem.z * 0.7, q.z / 0.35);
    float dK = length(sq) - uStem.z * 0.3 + (1.0 - uStem.w) * uStem.z * 0.6;
    d = smin(d, dK, uStem.z * 0.25);
  }
  if (uFire.w > 0.001) {
    float dF = length(p - vec3(0.0, 0.0, uFire.x)) - uFire.y + (1.0 - uFire.w) * uFire.y * 1.5;
    d = smin(d, dF, uFire.y * 0.25);
  }
  return d;
}

float densityAt(vec3 p, out float heat) {
  heat = 0.0;
  float d = shapeSDF(p);
  float sc = uMisc.z;
  if (d > sc * 0.9) return 0.0;
  // coordenadas de ruído que "rolam" com o toroide (sobe por dentro, desce por fora)
  vec3 q = p - driftAt(p.z);
  float rho = length(q.xy);
  vec2 dir = rho > 1e-3 ? q.xy / rho : vec2(1.0, 0.0);
  vec2 rz = vec2(rho - uCap.y, q.z - uCap.x);
  float a = -uTime * 0.16;
  float ca = cos(a); float sa = sin(a);
  vec2 rz2 = vec2(ca * rz.x - sa * rz.y, sa * rz.x + ca * rz.y);
  float capW = smoothstep(uCap.x - uCap.z * 2.6, uCap.x - uCap.z * 0.9, q.z);
  vec3 pStem = q - vec3(0.0, 0.0, uTime * uCap.w * 0.25);
  vec3 pr = mix(pStem, vec3(dir * (uCap.y + rz2.x), uCap.x + rz2.y), capW);
  vec3 uvw = pr / (sc * 3.4);
  float base = texture(tNoise, uvw).r;
  float detail = texture(tNoise, uvw * 3.3 + vec3(0.0, 0.0, uTime * 0.02)).g;
  float disp = (base - 0.5) * sc * 1.4;
  float shape = clamp((-d + disp) / (sc * 0.22), 0.0, 1.0);
  // erosão por detalhe (bordas em "couve-flor"), mais forte na periferia
  float erode = detail * 0.5 * (1.0 - shape * 0.75);
  float dens = clamp((shape - erode) / max(1.0 - erode, 0.05), 0.0, 1.0);
  // calor: bola de fogo + núcleo do chapéu
  float dF = length(p - vec3(0.0, 0.0, uFire.x));
  float hf = uFire.z * uFire.w * (1.0 - smoothstep(uFire.y * 0.2, uFire.y * 1.05, dF + (detail - 0.5) * uFire.y * 0.4));
  float hc = uMisc.x * (1.0 - smoothstep(0.0, uCap.z * 1.3, length(rz) + (base - 0.5) * uCap.z * 0.8)) * capW;
  // variação turbulenta de temperatura (manchas mais frias e mais quentes)
  hf *= 0.55 + 0.9 * detail;
  heat = clamp(max(hf, hc * 0.9), 0.0, 1.0);
  return dens;
}

float lightOD(vec3 p) {
  float stepL = uCap.z * 0.35;
  float od = 0.0;
  vec3 q = p;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uLightSteps) break;
    q += uSunDir * stepL;
    float h;
    od += densityAt(q, h) * stepL;
    stepL *= 1.7;
  }
  return od;
}

vec3 blackbody(float t) {
  vec3 c = mix(vec3(0.5, 0.04, 0.0), vec3(1.0, 0.32, 0.04), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(1.0, 0.72, 0.32), smoothstep(0.3, 0.7, t));
  return mix(c, vec3(1.0, 0.97, 0.92), smoothstep(0.72, 1.0, t));
}

float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

vec2 hitCylinder(vec3 ro, vec3 rd, float R, float z0, float z1) {
  float a = dot(rd.xy, rd.xy);
  float b = dot(ro.xy, rd.xy);
  float c = dot(ro.xy, ro.xy) - R * R;
  float tn = -1e9; float tf = 1e9;
  if (a > 1e-9) {
    float h = b * b - a * c;
    if (h < 0.0) return vec2(1.0, -1.0);
    h = sqrt(h);
    tn = (-b - h) / a; tf = (-b + h) / a;
  } else if (c > 0.0) return vec2(1.0, -1.0);
  float tz0; float tz1;
  if (abs(rd.z) < 1e-9) {
    if (ro.z < z0 || ro.z > z1) return vec2(1.0, -1.0);
    tz0 = -1e9; tz1 = 1e9;
  } else {
    tz0 = (z0 - ro.z) / rd.z; tz1 = (z1 - ro.z) / rd.z;
    if (tz0 > tz1) { float t = tz0; tz0 = tz1; tz1 = t; }
  }
  return vec2(max(max(tn, tz0), 0.0), min(tf, tz1));
}

void main() {
  if (uMisc.y <= 0.001) { gl_FragColor = vec4(0.0); return; }
  vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 vdir = normalize(vp.xyz / vp.w);
  vec3 wdir = normalize(mat3(uCamWorld) * vdir);
  vec3 rd = normalize(uWorldToENU * wdir);
  vec3 ro = uCamENU;

  float depth = texture2D(tDepth, vUv).r;
  float sceneDist = 1e12;
  if (depth < 0.99999) {
    float viewZ = perspectiveDepthToViewZ(depth, uNear, uFar);
    sceneDist = viewZ / vdir.z;
  }

  float drift = length(uDrift) * 1.1;
  float R = max(max(uCap.y + uCap.z * 1.9, uStem.z * 1.2), uFire.y * 1.5) + drift;
  float zTop = max(uCap.x + uCap.z * 2.2, uFire.x + uFire.y * 1.5);
  vec2 tt = hitCylinder(ro, rd, R, -5.0, zTop);
  tt.y = min(tt.y, sceneDist);
  if (tt.x >= tt.y) { gl_FragColor = vec4(0.0); return; }

  float steps = uSteps;
  float dt = (tt.y - tt.x) / steps;
  float minStep = uMisc.z * 0.12;
  if (dt < minStep) { steps = max(8.0, (tt.y - tt.x) / minStep); dt = (tt.y - tt.x) / steps; }
  float jitter = ign(gl_FragCoord.xy + fract(uTime * 7.3) * 113.0);
  float cosT = dot(rd, uSunDir);
  float phase = mix(hg(cosT, 0.55), hg(cosT, -0.25), 0.35) * 12.566 * 0.6 + 0.4;
  float sigma = uMisc.w / max(uMisc.z, 1.0);

  vec3 col = vec3(0.0);
  float T = 1.0;
  float tAcc = 0.0; float wAcc = 0.0;
  for (int i = 0; i < 160; i++) {
    if (float(i) >= steps || T < 0.008) break;
    float t = tt.x + (float(i) + jitter) * dt;
    if (t > tt.y) break;
    vec3 p = ro + rd * t;
    float heat;
    float dns = densityAt(p, heat) * uMisc.y;
    if (dns < 0.004) continue;
    float sig = dns * sigma;
    float od = lightOD(p) * sigma;
    float Tl = exp(-od);
    float powder = 1.0 - exp(-od * 2.0 - 0.05);
    float hz = clamp(0.5 + (p.z - uCap.x) / (2.5 * uCap.z), 0.0, 1.0);
    // luz ambiente atenuada pela própria nuvem (aproximação do espalhamento múltiplo)
    vec3 amb = mix(uGroundColor, uSkyColor, hz) * (0.35 + 0.4 * hz) * (0.35 + 0.65 * exp(-od * 0.25));
    float dF = length(p - vec3(0.0, 0.0, uFire.x));
    vec3 fireGlow = vec3(1.0, 0.45, 0.12) * uFire.z * uFire.w * 9.0 * exp(-dF / max(uFire.y * 1.8, 1.0));
    float dusty = uDust * (1.0 - smoothstep(0.0, uCap.x * 0.8 + 1.0, p.z));
    vec3 albedo = mix(vec3(0.86, 0.85, 0.84), vec3(0.58, 0.48, 0.40), clamp(dusty + 0.25 * uDust, 0.0, 1.0));
    // fuligem: a bola de fogo que esfria vira fumaça marrom-escura
    float soot = (1.0 - uFire.z) * uFire.w * (1.0 - smoothstep(uFire.y * 0.6, uFire.y * 1.6, dF));
    albedo = mix(albedo, vec3(0.16, 0.10, 0.07), clamp(soot * 1.2, 0.0, 0.85));
    vec3 S = albedo * (uSunColor * Tl * phase * (0.45 + 0.55 * powder) + amb + fireGlow)
           + blackbody(heat) * pow(heat, 2.5) * uEmission;
    float Ti = exp(-sig * dt);
    col += T * S * (1.0 - Ti);
    tAcc += t * T * (1.0 - Ti); wAcc += T * (1.0 - Ti);
    T *= Ti;
  }
  float alpha = 1.0 - T;
  float meanT = wAcc > 0.0 ? tAcc / wAcc : tt.x;
  float fog = 1.0 - exp(-meanT * uFogDensity);
  col = mix(col, uFogColor * alpha, fog * 0.85);
  gl_FragColor = vec4(col, alpha);
}
`;

const COMP = /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D tVol;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(tInput, vUv);
  vec4 v = texture2D(tVol, vUv);
  gl_FragColor = vec4(s.rgb * (1.0 - v.a) + v.rgb, s.a);
}
`;

export class VolumetricExplosionPass extends Pass {
  constructor(sceneCamera) {
    super('VolumetricExplosionPass');
    this.needsDepthTexture = true;
    this.needsSwap = true;
    this.sceneCamera = sceneCamera;
    this.resolutionScale = 0.5;
    this.volMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDepth: { value: null },
        tNoise: { value: cloudNoiseTexture() },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uWorldToENU: { value: new THREE.Matrix3() },
        uCamENU: { value: new THREE.Vector3() },
        uNear: { value: 1 },
        uFar: { value: 1000 },
        uTime: { value: 0 },
        uCap: { value: new THREE.Vector4() },
        uStem: { value: new THREE.Vector4() },
        uFire: { value: new THREE.Vector4() },
        uMisc: { value: new THREE.Vector4(0, 0, 100, 4) },
        uDrift: { value: new THREE.Vector2() },
        uSunDir: { value: new THREE.Vector3(0.3, 0.3, 0.9).normalize() },
        uSunColor: { value: new THREE.Color(3, 2.9, 2.7) },
        uSkyColor: { value: new THREE.Color(0.55, 0.7, 1.0) },
        uGroundColor: { value: new THREE.Color(0.25, 0.22, 0.2) },
        uFogColor: { value: new THREE.Color(0.7, 0.78, 0.9) },
        uFogDensity: { value: 0.00003 },
        uSteps: { value: 64 },
        uLightSteps: { value: 4 },
        uDust: { value: 0 },
        uEmission: { value: 40 },
        uCapAmt: { value: 0 },
      },
    });
    this.compMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMP,
      depthTest: false,
      depthWrite: false,
      uniforms: { tInput: { value: null }, tVol: { value: null } },
    });
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rt.texture.generateMipmaps = false;
    this.enabled = false;
  }

  get uniforms() { return this.volMaterial.uniforms; }

  setDepthTexture(depthTexture) {
    this.volMaterial.uniforms.tDepth.value = depthTexture;
  }

  setSize(width, height) {
    this.rt.setSize(Math.max(1, Math.round(width * this.resolutionScale)), Math.max(1, Math.round(height * this.resolutionScale)));
  }

  render(renderer, inputBuffer, outputBuffer) {
    const cam = this.sceneCamera;
    const u = this.volMaterial.uniforms;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    this.fullscreenMaterial = this.volMaterial;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.compMaterial.uniforms.tInput.value = inputBuffer.texture;
    this.compMaterial.uniforms.tVol.value = this.rt.texture;
    this.fullscreenMaterial = this.compMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.rt.dispose();
    this.volMaterial.dispose();
    this.compMaterial.dispose();
    super.dispose();
  }
}
