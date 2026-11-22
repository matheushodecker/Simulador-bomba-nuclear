/**
 * Céu físico (modelo de Preetham, three/examples Sky), sol, hora do dia e as
 * cores usadas pela neblina, pela nuvem volumétrica e pela iluminação.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export const TIME_OF_DAY = {
  dia: { label: 'Dia', elev: 34, azim: 128, turbidity: 3.5, rayleigh: 1.4, ambient: 1.0, sun: [3.2, 3.05, 2.85], sky: [0.42, 0.58, 0.9], ground: [0.3, 0.27, 0.24], fog: [0.5, 0.6, 0.74], sunFog: [0.95, 0.88, 0.75], fogDensity: 0.000025, exposure: 1.0, skyScale: 0.5 },
  tarde: { label: 'Fim de tarde', elev: 7, azim: 290, turbidity: 6, rayleigh: 2.2, ambient: 0.6, sun: [3.0, 1.7, 0.85], sky: [0.35, 0.4, 0.6], ground: [0.28, 0.2, 0.15], fog: [0.6, 0.5, 0.45], sunFog: [1.0, 0.6, 0.3], fogDensity: 0.00004, exposure: 1.1, skyScale: 0.6 },
  noite: { label: 'Noite', elev: -18, azim: 250, turbidity: 2, rayleigh: 0.6, ambient: 0.06, sun: [0.05, 0.06, 0.1], sky: [0.025, 0.035, 0.07], ground: [0.02, 0.02, 0.025], fog: [0.02, 0.025, 0.04], sunFog: [0.03, 0.035, 0.06], fogDensity: 0.00004, exposure: 1.2, skyScale: 1.5 },
};

export class Atmosphere {
  constructor(scene) {
    this.sky = new Sky();
    // a saída do Sky.js já vem "comprimida" para tela: linearizamos e escalamos para o pipeline HDR
    this.sky.material.uniforms.skyScale = { value: 1 };
    this.sky.material.fragmentShader = `uniform float skyScale;\n${this.sky.material.fragmentShader}`
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( pow( retColor, vec3( 2.2 ) ) * skyScale, 1.0 );');
    this.sky.material.needsUpdate = true;
    this.sky.material.depthWrite = false;
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    this.ambient = new THREE.AmbientLight(0xffffff, Math.PI);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(0, 1, 0); // mundo (Y para cima, X oeste, Z norte)
    this.sunDirENU = new THREE.Vector3(0, 0, 1);
    this.set('dia');
  }

  set(mode) {
    const p = TIME_OF_DAY[mode] || TIME_OF_DAY.dia;
    this.mode = mode;
    this.p = p;
    const el = THREE.MathUtils.degToRad(p.elev);
    const az = THREE.MathUtils.degToRad(p.azim);
    // azimute a partir do norte, sentido horário (leste = 90°)
    const e = Math.sin(az) * Math.cos(el);
    const n = Math.cos(az) * Math.cos(el);
    const u = Math.sin(el);
    this.sunDirENU.set(e, n, u).normalize();
    this.sunDir.set(-e, u, n).normalize();
    const su = this.sky.material.uniforms;
    su.turbidity.value = p.turbidity;
    su.rayleigh.value = p.rayleigh;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.8;
    su.sunPosition.value.copy(this.sunDir);
    this.ambient.intensity = Math.PI * p.ambient * 0.62;
    this.sun.color.setRGB(p.sun[0], p.sun[1], p.sun[2]).multiplyScalar(1 / Math.max(...p.sun));
    this.sun.intensity = el > 0 ? Math.PI * 0.55 * p.ambient : 0;
    this.sun.position.copy(this.sunDir).multiplyScalar(10000);
    su.skyScale.value = p.skyScale ?? 1;
  }

  /** Mantém o céu centrado na câmera (caixa grande, mas dentro do plano distante). */
  follow(camera) {
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(camera.far * 0.5);
  }
}
