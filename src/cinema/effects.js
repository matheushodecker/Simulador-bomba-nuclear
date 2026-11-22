/**
 * Efeitos de pós-processamento próprios (postprocessing):
 *  - AerialPerspectiveEffect: neblina de altura com dispersão na direção do sol
 *    (dá profundidade e escala de quilômetros à cidade).
 *  - ShockRippleEffect: refração da frente de choque na tela (distorção do ar
 *    comprimido) + nuvem de condensação (Wilson) e clarão.
 */
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

const AERIAL = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDirW;
uniform vec3 uFogColor;
uniform vec3 uSunFog;
uniform float uDensity;
uniform float uFalloff;
uniform float uGroundY;
uniform float uFlash;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  if (depth < 0.99999) {
    vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    v /= v.w;
    vec3 wp = (uCamWorld * vec4(v.xyz, 1.0)).xyz;
    vec3 rd = wp - uCamPos;
    float dist = length(rd);
    rd /= max(dist, 1e-3);
    float h0 = max(uCamPos.y - uGroundY, 0.0);
    float k = rd.y * uFalloff;
    float f = abs(k * dist) > 1e-4 ? (1.0 - exp(-k * dist)) / k : dist;
    float amt = 1.0 - exp(-uDensity * exp(-h0 * uFalloff) * f);
    float s = pow(max(dot(rd, uSunDirW), 0.0), 8.0);
    col = mix(col, mix(uFogColor, uSunFog, s), clamp(amt, 0.0, 1.0));
  }
  col += vec3(1.0, 0.97, 0.9) * uFlash;
  outputColor = vec4(col, inputColor.a);
}
`;

export class AerialPerspectiveEffect extends Effect {
  constructor() {
    super('AerialPerspectiveEffect', AERIAL, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uSunDirW', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uFogColor', new THREE.Uniform(new THREE.Color(0.7, 0.78, 0.88))],
        ['uSunFog', new THREE.Uniform(new THREE.Color(1.0, 0.9, 0.7))],
        ['uDensity', new THREE.Uniform(0.00004)],
        ['uFalloff', new THREE.Uniform(0.00035)],
        ['uGroundY', new THREE.Uniform(0)],
        ['uFlash', new THREE.Uniform(0)],
      ]),
    });
  }

  sync(camera) {
    this.uniforms.get('uProjInv').value.copy(camera.projectionMatrixInverse);
    this.uniforms.get('uCamWorld').value.copy(camera.matrixWorld);
    this.uniforms.get('uCamPos').value.setFromMatrixPosition(camera.matrixWorld);
  }
}

const SHOCK = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uWidth;
uniform float uStrength;
uniform float uWilson;
uniform float uWilsonLight;
uniform float uGroundY;
uniform vec2 uCenterUv;

float rimAt(vec2 uv, out vec3 hitP) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize((mat3(uCamWorld) * (v.xyz / v.w)));
  vec3 oc = uCenter - uCamPos;
  float tc = dot(oc, rd);
  vec3 closest = uCamPos + rd * tc;
  float dperp = length(closest - uCenter);
  hitP = closest;
  if (tc < 0.0) return 0.0;
  float x = (dperp - uRadius) / uWidth;
  return exp(-x * x);
}

void mainUv(inout vec2 uv) {
  if (uStrength <= 0.0) return;
  vec3 hp;
  float r = rimAt(uv, hp);
  if (r < 0.002 || hp.y < uGroundY - 5.0) return;
  vec2 dir = uv - uCenterUv;
  float len = length(dir);
  if (len > 1e-4) uv -= dir / len * r * uStrength * 0.012;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  if (uWilson > 0.0) {
    vec3 hp;
    float r = rimAt(uv, hp);
    float above = smoothstep(uGroundY - 5.0, uGroundY + uRadius * 0.05, hp.y);
    col = mix(col, vec3(0.92, 0.94, 0.97) * uWilsonLight, r * uWilson * 0.22 * above);
  }
  outputColor = vec4(col, inputColor.a);
}
`;

export class ShockRippleEffect extends Effect {
  constructor() {
    super('ShockRippleEffect', SHOCK, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uCenter', new THREE.Uniform(new THREE.Vector3())],
        ['uRadius', new THREE.Uniform(0)],
        ['uWidth', new THREE.Uniform(30)],
        ['uStrength', new THREE.Uniform(0)],
        ['uWilson', new THREE.Uniform(0)],
        ['uWilsonLight', new THREE.Uniform(1)],
        ['uGroundY', new THREE.Uniform(0)],
        ['uCenterUv', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
      ]),
    });
  }

  sync(camera) {
    this.uniforms.get('uProjInv').value.copy(camera.projectionMatrixInverse);
    this.uniforms.get('uCamWorld').value.copy(camera.matrixWorld);
    this.uniforms.get('uCamPos').value.setFromMatrixPosition(camera.matrixWorld);
  }
}
