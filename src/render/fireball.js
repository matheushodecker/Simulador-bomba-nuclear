/**
 * Bola de fogo: esfera com turbulência procedural (ruído simplex no shader),
 * rampa de temperatura (branco → amarelo → laranja → vermelho → fumaça) e
 * subida por empuxo até se transformar no chapéu do cogumelo.
 */
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { smoothstep } from '../physics/math.js';

const VERT = /* glsl */ `
uniform vec3 uCenter;
uniform float uRadius;
uniform float uNow;
varying vec3 vN;
varying vec3 vWorld;
${NOISE}
void main() {
  vec3 n = normalize(position);
  float d = snoise(n * 2.5 + vec3(0.0, 0.0, uNow * 0.5)) * 0.07;
  vec3 p = uCenter + n * uRadius * (1.0 + d);
  vN = n;
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTemp;
uniform float uOpacity;
uniform float uNow;
uniform vec3 uViewDir;
uniform float uClipGround;
varying vec3 vN;
varying vec3 vWorld;
${NOISE}
void main() {
  if (uClipGround > 0.5 && vWorld.z < 0.0) discard;
  float facing = clamp(dot(vN, -uViewDir), 0.0, 1.0);
  float limb = 1.0 - facing;
  float f = fbm(vN * 3.5 + vec3(uNow * 0.25, -uNow * 0.18, uNow * 0.3));
  float T = clamp(uTemp * 1.15 - 0.28 * f - limb * 0.25, 0.0, 1.0);
  vec3 c;
  if (T > 0.75) c = mix(vec3(1.0, 0.86, 0.5), vec3(1.0, 0.99, 0.93), (T - 0.75) / 0.25);
  else if (T > 0.45) c = mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 0.86, 0.5), (T - 0.45) / 0.3);
  else if (T > 0.2) c = mix(vec3(0.55, 0.12, 0.03), vec3(1.0, 0.5, 0.1), (T - 0.2) / 0.25);
  else c = mix(vec3(0.13, 0.08, 0.07), vec3(0.55, 0.12, 0.03), T / 0.2);
  // fumaça escura surgindo à medida que esfria
  float smoke = smoothstep(0.1, 0.6, f + (1.0 - uTemp) * 0.6) * (1.0 - uTemp);
  c = mix(c, vec3(0.16, 0.12, 0.1), smoke * 0.7);
  c *= 1.0 + 0.7 * uTemp;
  gl_FragColor = vec4(c, uOpacity);
}
`;

export class Fireball {
  constructor() {
    this.object3d = new THREE.Group();
    this.uniforms = {
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uNow: { value: 0 },
      uTemp: { value: 1 },
      uOpacity: { value: 1 },
      uViewDir: { value: new THREE.Vector3(0, 0, -1) },
      uClipGround: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true,
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
    this.object3d.add(this.mesh);
    this.light = 0;
    this.center = new THREE.Vector3();
  }

  /**
   * @param {number} tVis duração visual do crescimento (s)
   * @param {(tau:number)=>number} capCenterAt altura do centro do chapéu (m)
   */
  start(fx, gz, tVis, capCenterAt) {
    this.R = fx.radius.fireball * 1000;
    this.h0 = fx.hKm * 1000;
    this.gz = gz;
    this.tfb = tVis;
    this.capCenterAt = capCenterAt;
    this.active = true;
  }

  stop() {
    this.active = false;
    this.mesh.visible = false;
    this.light = 0;
  }

  update(ctx) {
    const tau = ctx.tau;
    if (!this.active || tau < 0) { this.mesh.visible = false; this.light = 0; return; }
    const g = Math.min(1, Math.max(0.03, Math.pow(tau / this.tfb, 0.4)));
    const after = Math.max(0, tau - this.tfb);
    const r = this.R * g * (1 + 0.12 * Math.min(after, 4));
    const z = tau < this.tfb ? this.h0 : Math.max(this.h0, this.capCenterAt(tau));
    const temp = Math.exp(-tau / (this.tfb * 1.7));
    const opacity = 1 - smoothstep(this.tfb * 1.1, this.tfb * 1.1 + 3.5, tau);
    this.mesh.visible = opacity > 0.01;
    this.center.set(this.gz[0], this.gz[1], z);
    const u = this.uniforms;
    u.uCenter.value.copy(this.center);
    u.uRadius.value = r;
    u.uNow.value = ctx.now;
    u.uTemp.value = temp;
    u.uOpacity.value = opacity;
    u.uViewDir.value.copy(ctx.viewDir);
    // intensidade da luz projetada nos prédios
    this.light = (2.2 * Math.exp(-tau / 0.6) + 0.9 * Math.exp(-tau / (this.tfb * 3 + 2))) * opacity;
    this.range = Math.max(this.R * 6, 600);
  }
}
