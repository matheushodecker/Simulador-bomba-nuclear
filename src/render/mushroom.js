/**
 * Nuvem em cogumelo volumétrica (partículas): toroide em rolagem no topo,
 * coluna (haste) sugando poeira e, em explosões baixas, a saia de poeira na base.
 * Dimensões finais: CONFIG.cloud (altura do topo e raio do chapéu por potência).
 * A subida é COMPRIMIDA no tempo (na realidade leva vários minutos).
 */
import { BillboardCloud } from './particles.js';
import { CONFIG } from '../config.js';
import { smoothstep, lerp } from '../physics/math.js';

const CAP = 0; const DOME = 1; const STEM = 2; const SKIRT = 3;

export class MushroomCloud {
  constructor(maxCount = 3200) {
    this.cloud = new BillboardCloud(maxCount);
    this.object3d = this.cloud.object3d;
    this.active = false;
    this.max = maxCount;
  }

  start(fx, gz, windVec, count, tFireball) {
    const n = Math.min(count, this.max);
    this.n = n;
    this.gz = gz;
    this.top = fx.cloud.topKm * 1000;
    this.capR = fx.cloud.capKm * 1000;
    this.rfb = fx.radius.fireball * 1000;
    this.h0 = fx.hKm * 1000;
    this.surface = this.h0 < this.rfb;
    this.tfb = tFireball;
    this.T = CONFIG.anim.cloudRiseSeconds;
    this.wind = windVec; // m/s visual (x,y)
    this.params = new Float32Array(n * 6);
    this.pos = new Float32Array(n * 3);
    this.d = new Float32Array(n * 4);
    this.col = new Float32Array(n * 3);
    let s = 987654321;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      const f = i / n;
      let region;
      if (f < 0.5) region = CAP;
      else if (f < 0.66) region = DOME;
      else if (f < (this.surface ? 0.88 : 0.96)) region = STEM;
      else region = this.surface ? SKIRT : STEM;
      this.params.set([region, rnd() * Math.PI * 2, rnd() * Math.PI * 2, Math.sqrt(rnd()), rnd(), 0.82 + rnd() * 0.36], i * 6);
    }
    this.active = true;
  }

  /** Altura do centro do chapéu em função do tempo visual (compartilhada com a bola de fogo). */
  capCenterAt(tau) {
    const kk = this.rise(tau);
    const rtF = 0.42 * this.capR;
    const final = Math.max(this.h0 + this.rfb, this.top - rtF * 0.85);
    return lerp(this.h0 + (this.surface ? this.rfb * 0.6 : 0), final, kk);
  }

  rise(tau) {
    const t = Math.max(0, tau - this.tfb * 0.6);
    return 1 - Math.exp(-t / (this.T / 3));
  }

  stop() {
    this.active = false;
    this.cloud.hide();
  }

  update(ctx) {
    const tau = ctx.tau;
    if (!this.active || tau < 0) { this.cloud.hide(); return; }
    const kk = this.rise(tau);
    const H = this.capCenterAt(tau);
    const Rt = lerp(this.rfb * 0.45, this.capR * 0.55, kk);
    const rt = lerp(this.rfb * 0.8, this.capR * 0.42, kk);
    const stemR = lerp(this.rfb * 0.32, this.capR * 0.14, kk);
    const stemTop = Math.max(10, H - rt * 0.55);
    const heat = Math.exp(-tau / (this.tfb * 2.5 + 2.5));
    const appear = smoothstep(this.tfb * 0.5, this.tfb * 1.6 + 0.6, tau);
    const late = 1 - smoothstep(180, 260, tau);
    const stemGrow = this.surface ? smoothstep(0.2, 1.5, tau) : smoothstep(1.5, this.T * 0.7, tau);
    const drift = Math.max(0, tau - this.T * 0.4);
    const [gx, gy] = this.gz;
    const P = this.params;
    const dust = this.surface ? [0.56, 0.48, 0.41] : [0.62, 0.57, 0.52];
    const capBase = this.surface ? [0.66, 0.6, 0.55] : [0.86, 0.84, 0.82];

    for (let i = 0; i < this.n; i++) {
      const region = P[i * 6];
      const th0 = P[i * 6 + 1];
      const ph0 = P[i * 6 + 2];
      const rr = P[i * 6 + 3];
      const sz = P[i * 6 + 4];
      const shade = P[i * 6 + 5];
      let x; let y; let z; let size; let alpha; let glow; let c;
      if (region === CAP) {
        // toroide em rolagem: sobe por dentro, desce por fora
        const ph = ph0 - tau * 0.35;
        const th = th0 + tau * 0.02;
        const rad = Rt + rr * rt * Math.cos(ph);
        z = H + rr * rt * Math.sin(ph) * 0.78;
        x = Math.cos(th) * rad; y = Math.sin(th) * rad;
        size = rt * (0.55 + 0.55 * sz);
        alpha = 0.85 * appear;
        glow = heat * (1.5 * (1 - rr) + 0.25);
        const lit = 0.88 + 0.22 * Math.sin(ph);
        c = [capBase[0] * shade * lit, capBase[1] * shade * lit, capBase[2] * shade * lit];
      } else if (region === DOME) {
        const th = th0 + tau * 0.015;
        const rad = Rt * Math.sqrt(rr) * 0.95;
        z = H + rt * (0.25 + 0.5 * sz) * 0.8 * (1 - 0.5 * (rad / Math.max(Rt, 1)) ** 2);
        x = Math.cos(th) * rad; y = Math.sin(th) * rad;
        size = rt * (0.6 + 0.5 * sz);
        alpha = 0.8 * appear;
        glow = heat * (1.2 * (1 - rr) + 0.2);
        c = [capBase[0] * shade * 1.06, capBase[1] * shade * 1.06, capBase[2] * shade * 1.06];
      } else if (region === STEM) {
        const u = (ph0 / (Math.PI * 2) + tau * 0.012) % 1; // fluxo ascendente
        if (u > stemGrow) { alpha = 0; x = y = z = size = glow = 0; c = dust; } else {
          const flare = 1 + 2.2 * (1 - u) ** 4;
          const th = th0 + tau * 0.15 * (1 + u);
          const rad = stemR * flare * rr * 0.9;
          z = u * stemTop;
          x = Math.cos(th) * rad; y = Math.sin(th) * rad;
          size = stemR * (1.0 + 0.6 * sz) * (1 + 0.6 * (1 - u) ** 3);
          alpha = 0.7 * appear * smoothstep(0, 0.08, stemGrow - u + 0.02);
          glow = heat * 0.35 * u;
          const k = 0.85 + 0.25 * u;
          c = [dust[0] * shade * k, dust[1] * shade * k, dust[2] * shade * k];
        }
      } else {
        // saia de poeira na base (explosões no solo/baixas)
        const th = th0 + tau * 0.01;
        const rad = lerp(this.rfb, this.capR * 1.15, kk) * (0.55 + 0.45 * rr);
        z = this.capR * 0.04 * (0.3 + sz);
        x = Math.cos(th) * rad; y = Math.sin(th) * rad;
        size = this.capR * 0.2 * (0.7 + sz);
        alpha = 0.45 * appear * (1 - smoothstep(this.T, this.T * 4, tau));
        glow = 0;
        c = [dust[0] * shade, dust[1] * shade, dust[2] * shade];
      }
      // deriva com o vento (mais forte em altitude)
      const kz = Math.min(1, z / Math.max(this.top, 1));
      x += gx + this.wind[0] * drift * kz;
      y += gy + this.wind[1] * drift * kz;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.d[i * 4] = size;
      this.d[i * 4 + 1] = alpha * late;
      this.d[i * 4 + 2] = glow;
      this.d[i * 4 + 3] = th0 * 3 + tau * 0.05 * (sz - 0.5);
      this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    }
    this.cloud.write(this.n, this.pos, this.d, this.col, ctx.matrix, ctx);
  }
}
