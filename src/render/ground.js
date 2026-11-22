/**
 * Efeitos no chão: clarão refletido sob a bola de fogo e solo/vegetação
 * chamuscados pelo pulso térmico.
 */
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const VERT = /* glsl */ `
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uIntensity;
varying vec2 vXY;
void main() {
  float r = length(vXY);
  float a = exp(-r * r * 5.0) * uIntensity;
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.4) * a, a);
}
`;

const SCORCH_FRAG = /* glsl */ `
uniform float uAmount;
uniform float uInner;
varying vec2 vXY;
${NOISE}
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float n = fbm(vec3(vXY * 9.0, 1.7));
  float inner = 1.0 - smoothstep(uInner * 0.7, uInner * 1.25 + 0.1 * n, r);
  float outer = (1.0 - smoothstep(0.2 + 0.15 * n, 1.0, r)) * 0.22;
  float a = (inner * 0.78 + outer) * uAmount * (0.8 + 0.3 * n);
  vec3 c = mix(vec3(0.12, 0.08, 0.06), vec3(0.03, 0.02, 0.02), inner);
  gl_FragColor = vec4(c, clamp(a, 0.0, 0.9));
}
`;

export class GroundEffects {
  constructor() {
    this.object3d = new THREE.Group();
    const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
    this.glowU = { uIntensity: { value: 0 } };
    this.glow = new THREE.Mesh(plane, new THREE.ShaderMaterial({
      uniforms: this.glowU, vertexShader: VERT, fragmentShader: GLOW_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scorchU = { uAmount: { value: 0 }, uInner: { value: 0.2 } };
    this.scorch = new THREE.Mesh(plane, new THREE.ShaderMaterial({
      uniforms: this.scorchU, vertexShader: VERT, fragmentShader: SCORCH_FRAG,
      transparent: true, depthWrite: false,
    }));
    [this.glow, this.scorch].forEach((m) => { m.frustumCulled = false; m.visible = false; });
    this.scorch.renderOrder = 1;
    this.glow.renderOrder = 2;
    this.object3d.add(this.scorch, this.glow);
  }

  start(fx, gz) {
    const R3 = Math.max(fx.radius.thermal3, fx.radius.fireball * 2) * 1000;
    this.scorch.position.set(gz[0], gz[1], 0.4);
    this.scorch.scale.set(R3, R3, 1);
    this.scorchU.uInner.value = Math.min(0.9, (fx.radius.fireball * 2.2 * 1000) / R3);
    const Rg = Math.max(fx.radius.fireball * 9 * 1000, 500);
    this.glow.position.set(gz[0], gz[1], 0.8);
    this.glow.scale.set(Rg, Rg, 1);
    this.active = true;
  }

  stop() {
    this.active = false;
    this.glow.visible = false;
    this.scorch.visible = false;
  }

  /** A intensidade vem da bola de fogo (`lightSource.light`, 0–3). */
  update(ctx) {
    const light = this.lightSource ? this.lightSource.light : 0;
    if (!this.active || ctx.tau < 0) { this.glow.visible = false; this.scorch.visible = false; return; }
    this.glowU.uIntensity.value = Math.min(1.2, light * 0.55);
    this.glow.visible = light > 0.01;
    this.scorchU.uAmount.value = Math.min(1, ctx.tau * 2);
    this.scorch.visible = true;
  }
}
