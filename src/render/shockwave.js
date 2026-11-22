/**
 * Frente de choque em 3D: casca esférica translúcida centrada no ponto de
 * explosão, com brilho de borda (fresnel) e névoa de condensação (nuvem de Wilson)
 * nas pressões moderadas. O raio segue a física: s(t) = ∫ U(p) dt.
 */
import * as THREE from 'three';
import { smoothstep } from '../physics/math.js';

const VERT = /* glsl */ `
uniform vec3 uCenter;
uniform float uRadius;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(position);
  vec3 p = uCenter + n * uRadius;
  vN = n;
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uViewDir;
uniform float uStrength;
uniform float uWilson;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  if (vWorld.z < 0.0) discard;
  float facing = abs(dot(vN, uViewDir));
  float rim = pow(1.0 - facing, 3.0);
  float a = rim * uStrength + 0.02 * uStrength + uWilson * 0.22 * pow(1.0 - facing, 1.5);
  vec3 c = mix(vec3(0.8, 0.88, 1.0), vec3(1.0), rim);
  gl_FragColor = vec4(c, clamp(a, 0.0, 0.85));
}
`;

export class ShockDome {
  constructor() {
    this.object3d = new THREE.Group();
    this.uniforms = {
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uViewDir: { value: new THREE.Vector3(0, 0, -1) },
      uStrength: { value: 0 },
      uWilson: { value: 0 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 48),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 7;
    this.object3d.add(this.mesh);
  }

  start(fx, gz, accel) {
    this.fx = fx;
    this.gz = gz;
    this.accel = accel;
    this.h = fx.hKm * 1000;
    this.rMaxKm = fx.radius.blast1 * 1.15;
    this.active = true;
  }

  stop() {
    this.active = false;
    this.mesh.visible = false;
  }

  update(ctx) {
    if (!this.active || ctx.tau < 0) { this.mesh.visible = false; return; }
    const tPhys = ctx.tau * this.accel;
    const sKm = this.fx.slantAt(tPhys);
    const rKm = this.fx.frontAt(tPhys);
    const end = Math.hypot(this.rMaxKm, this.fx.hKm);
    if (sKm > end) { this.mesh.visible = false; return; }
    const psi = rKm > 0 ? this.fx.psiAt(rKm) : this.fx.psiAt(0.0001);
    const fade = 1 - smoothstep(end * 0.7, end, sKm);
    const strength = Math.min(0.75, Math.max(0.06, Math.log10(psi + 1) / 1.4)) * fade;
    const wilson = smoothstep(0.8, 2, psi) * (1 - smoothstep(6, 15, psi)) * fade;
    this.mesh.visible = true;
    const u = this.uniforms;
    u.uCenter.value.set(this.gz[0], this.gz[1], this.h);
    u.uRadius.value = sKm * 1000;
    u.uViewDir.value.copy(ctx.viewDir);
    u.uStrength.value = strength;
    u.uWilson.value = wilson;
  }
}
