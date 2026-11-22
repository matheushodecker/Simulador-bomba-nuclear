/**
 * Liga a simulação de fluidos à linha do tempo da detonação:
 *  - escolhe a resolução do grid pela qualidade,
 *  - converte o tempo da animação em tempo físico (tempo real durante a onda de
 *    choque; acelerado depois, para a nuvem subir em ~20 s de tela),
 *  - calcula as forçantes a partir do modelo de efeitos (bola de fogo de Glasstone,
 *    frente de choque, vento de pico da onda, poeira, vento atmosférico),
 *  - faz o domínio crescer para acompanhar a nuvem,
 *  - entrega o campo ao renderizador volumétrico.
 */
import * as THREE from 'three';
import { FluidSolver, FLUID_PRESETS } from './FluidSolver.js';
import { fireballTime } from '../../physics/fireball.js';
import { CONFIG } from '../../config.js';
import { smoothstep, clamp } from '../../physics/math.js';
import { calibrateThermal, lapseFromN } from '../../physics/thermal_rise.js';

const AUTO = { baixa: 'off', media: 'g64', alta: 'g96', ultra: 'g128' };

/** Vento de fundo na altura z (o mesmo perfil usado na advecção do grid). */
function windAt(w, z) {
  const k = 1 + 1.5 * smoothstep(0, 10000, z);
  return [w[0] * k, w[1] * k];
}

/** Velocidade do vento atrás da frente de choque (G&D eq. 3.55.2), m/s. */
export function peakWind(psi) {
  const P0 = CONFIG.blast.ambientPsi;
  const c0 = CONFIG.blast.soundSpeed_kms * 1000;
  const x = psi / P0;
  return ((5 * x) / 7) * c0 / Math.sqrt(1 + (6 * x) / 7);
}

export class FluidController {
  constructor(renderer) {
    this.renderer = renderer;
    this.solver = null;
    this.key = null;
    this.active = false;
    this.kt = 1;
    this.f = {
      wind: [0, 0], blast: new THREE.Vector4(), fire: new THREE.Vector4(), surfaceDust: 0,
      strat: new THREE.Vector3(), lid: new THREE.Vector2(), cool: new THREE.Vector2(), dustRate: 1, eps: 0.35,
      fireC: new THREE.Vector3(), guide: new THREE.Vector4(0, 0, 0, 1), guideV: new THREE.Vector4(), guideS: new THREE.Vector4(),
      guideShape: new THREE.Vector2(1, 1), dustLift: new THREE.Vector3(),
    };
  }

  resolveKey(state) {
    const k = state.cinema.fluid || 'auto';
    return k === 'auto' ? AUTO[state.quality] || 'g64' : k;
  }

  /** Prepara uma nova detonação. Retorna false se a simulação de fluidos estiver desligada. */
  start(fx, accel, params, key) {
    this.active = false;
    const preset = FLUID_PRESETS[key];
    if (!preset) return false;
    try {
      if (!this.solver || this.key !== key) {
        this.solver?.dispose();
        this.solver = new FluidSolver(this.renderer, preset);
        this.key = key;
      }
    } catch (e) {
      console.warn('[fluido] indisponível', e);
      this.solver = null;
      return false;
    }
    this.fx = fx;
    this.accel = accel;
    this.params = params;
    const W = fx.yieldKt;
    this.rfb = fx.radius.fireball * 1000;
    this.h0 = fx.hKm * 1000;
    this.top = fx.cloud.topKm * 1000;
    this.capR = fx.cloud.capKm * 1000;
    this.surface = this.h0 < this.rfb;
    this.tFb = fireballTime(W);
    this.shockEnd = fx.arrivalAt(fx.radius.blast1) / accel;
    this.Wmax = Math.max(this.capR * 5, this.top * 0.9);
    this.Hmax = this.top * 1.45;
    const down = ((((params?.wind?.fromDeg ?? 270) + 180) % 360) * Math.PI) / 180;
    const ws = (params?.wind?.speedKmh ?? 24) / 3.6;
    this.f.wind = [Math.sin(down) * ws, Math.cos(down) * ws];
    // --- calor deixado no ar: ~35% da energia fica como calor sensível depois do pulso térmico ---
    const E = 0.35 * W * CONFIG.units.KT_TO_J;
    // fase luminosa: a superfície da bola de fogo fica perto de ~7 700 K no segundo máximo,
    // quase independente da potência (G&D §2.110); depois irradia o excesso (∝ T⁴)
    this.T0 = 7700;
    const kr = 1 / (1.2 * this.tFb * (this.T0 / 1000) ** 3);
    this.f.cool.set(kr, 0.0012);
    // --- subida: térmica turbulenta (Morton–Taylor–Turner) calibrada pelas escalas da nuvem ---
    const capThick = Math.min(this.capR, 0.18 * this.top);
    const cal = {
      z0: Math.max(this.h0, this.rfb * 0.6), a0: this.rfb, heatJ: E,
      zTarget: this.top - 0.8 * capThick, aTarget: this.capR, tTarget: 240 * W ** 0.1,
    };
    const calKey = JSON.stringify(cal);
    if (this._calKey !== calKey) {
      this.thermal = calibrateThermal(cal);
      this._calKey = calKey;
    }
    this.th = this.thermal.init();
    this.gxy = [0, 0];
    this.tStab = this.thermal.tPeak || 210 * W ** 0.06;
    this.ktMax = clamp(this.tStab / 18, accel, 60);
    // a mesma estratificação no grid (Γ = N²θ₀/g); bem mais estável acima do topo ("tropopausa")
    const gamma = lapseFromN(this.thermal.N);
    this.f.strat.set(gamma, gamma * 4, this.top * 0.95);
    this.f.lid.set(this.top * 1.05, gamma * 20);
    this.stemAmp = this.surface ? 1 : clamp(1 - this.h0 / (this.top * 0.25), 0.35, 0.8);
    this.f.surfaceDust = this.surface ? 1 : 0;
    // escombros e terra soltos onde a onda passou de ~5 psi (no solo: também a ejeção da cratera)
    this.f.dustLift.set(this.surface ? 0.008 : 0.005, 5, Math.max(fx.radius.blast5 * 1000, this.rfb * 2));
    const W0 = Math.max(this.rfb * 8, 300);
    this.solver.reset({ cx: 0, cy: 0, W: W0, H: Math.max(this.h0 + this.rfb * 4, W0) });
    this.t = 0;
    this.lastTau = null;
    this.lastMeasure = -1;
    this.active = true;
    return true;
  }

  stop() {
    this.active = false;
  }

  /** Avança a física até o tempo visual `tau`. */
  update(tau) {
    if (!this.active || !this.solver || tau < 0) return false;
    if (this.lastTau !== null && tau < this.lastTau - 0.2) {
      // a linha do tempo voltou: recomeça
      this.start(this.fx, this.accel, this.params, this.key);
    }
    const dTau = this.lastTau === null ? 0 : clamp(tau - this.lastTau, 0, 0.1);
    this.lastTau = tau;
    this.kt = this.accel + (this.ktMax - this.accel) * smoothstep(this.shockEnd, this.shockEnd + 5, tau);
    let dtPhys = dTau * this.kt;
    const s = this.solver;
    const hmin = Math.min(s.h.x, s.h.z);
    const vmax = Math.max(s.extent?.vmax || 0, 40);
    const n = clamp(Math.ceil((dtPhys * vmax) / (2.5 * hmin)), 1, s.preset.maxSub);
    const dt = dtPhys / n;
    const fx = this.fx;
    for (let i = 0; i < n && dt > 0; i++) {
      const t = this.t;
      // núcleo da térmica: modelo integral + deriva com o vento na sua altura
      const th = this.th;
      this.thermal.step(th, dt);
      const wv = windAt(this.f.wind, th.z);
      this.gxy[0] += wv[0] * dt;
      this.gxy[1] += wv[1] * dt;
      this._guide(t, s);
      // bola de fogo (fase radiativa): fonte de calor com o raio de Glasstone, subindo com a térmica
      if (t < this.tFb) {
        const R = Math.max(this.rfb * Math.max(0.15, (t / this.tFb) ** 0.4), 1.6 * Math.max(s.h.x, s.h.z));
        this.f.fire.set(this.h0, R, this.T0, 1);
        this.f.fireC.set(this.gxy[0], this.gxy[1], this.h0 + (th.z - this.thermal.z0));
      } else this.f.fire.set(0, 0, 0, 0);
      // onda de choque junto ao chão: vento radial de pico e poeira levantada
      const rKm = fx.frontAt(t);
      const psi = rKm > 0 ? fx.psiAt(rKm) : 0;
      if (rKm > 0 && psi > 0.4 && rKm < fx.radius.blast1 * 1.15) {
        const front = rKm * 1000;
        this.f.blast.set(front, Math.max(2.5 * s.h.x, front * 0.1), Math.min(peakWind(psi), 400), 1);
        this.f.dustRate = clamp(Math.log10(psi + 1) / 1.2, 0, 1.2) * (this.surface ? 3 : 1.5);
      } else this.f.blast.set(0, 0, 0, 0);
      s.step(dt, this.f);
      this.t += dt;
    }
    // o domínio cresce para acompanhar a nuvem (leitura rara da GPU)
    if (tau - this.lastMeasure > 0.3) {
      this.lastMeasure = tau;
      this._grow();
    }
    return true;
  }

  /** Acoplamento do núcleo da térmica ao grid (vórtice de Hill, haste, calor e condensação). */
  _guide(t, s) {
    const th = this.th;
    const cell = Math.max(s.h.x, s.h.z);
    const a = Math.max(th.a, 1.8 * cell);
    // entra depois da fase mais luminosa e sai devagar depois que a térmica para de subir
    const on = smoothstep(this.tFb * 0.3, this.tFb * 1.5, t) * (th.peaked ? Math.exp(-(t - th.tPeak) / 45) : 1);
    const U = Math.max(th.w, 0);
    // a bolha começa quase esférica e achata ao subir (topo empurrado contra o ar mais estável)
    const flat = smoothstep(this.thermal.z0, this.thermal.zTarget, th.z);
    this.f.guideShape.set(1 + 0.55 * flat, 1 - 0.35 * flat);
    this.f.guide.set(this.gxy[0], this.gxy[1], th.z, a);
    if (on < 0.02) {
      this.f.guideV.set(0, 0, 1, 0);
      this.f.guideS.set(0, 0, 1200, 0);
      return;
    }
    const rate = (1.2 * Math.max(U, 3) / a) * on;
    const stemR = Math.max(0.28 * a, 2.5 * s.h.x);
    this.f.guideV.set(U, rate, stemR, Math.max(U * 1.1, 12) * this.stemAmp * on);
    const { dTheta } = this.thermal.buoyancy(th);
    // umidade: condensa no núcleo quando ele passa do nível de condensação (~1,2 km)
    const q = smoothstep(900, 2200, th.z) * 0.9 * on;
    this.f.guideS.set(Math.max(dTheta, 0) * on, q, 1200, 1);
  }

  _grow() {
    const s = this.solver;
    const e = s.measure();
    let { cx, cy, W, H } = s.box;
    if (e) {
      const ahead = e.vmax * 0.35 * this.kt * 1.5; // quanto a nuvem pode subir até a próxima leitura
      H = Math.max(H, e.top * 1.3 + ahead + 3 * s.h.z);
      if (e.xmin !== null) {
        const midx = (e.xmin + e.xmax) / 2;
        const midy = (e.ymin + e.ymax) / 2;
        const half = Math.max(e.xmax - e.xmin, e.ymax - e.ymin) / 2;
        const need = (half * 1.35 + 3 * s.h.x + ahead * 0.5) * 2;
        if (need > W) W = need;
        cx += (midx - cx) * 0.5;
        cy += (midy - cy) * 0.5;
      }
    } else {
      // sem leitura da GPU: cresce por uma estimativa de subida (bolha térmica ~150 m/s no início)
      const t = this.t;
      H = Math.max(H, Math.min(this.Hmax, this.h0 + this.rfb * 4 + 150 * t));
      W = Math.max(W, Math.min(this.Wmax, this.rfb * 8 + 40 * t));
    }
    W = Math.min(W, this.Wmax);
    H = Math.min(H, this.Hmax);
    // a térmica (e a haste até o chão) precisam caber no domínio
    const th = this.th;
    if (th) {
      const aheadT = Math.max(th.w, 0) * 0.35 * this.kt * 1.5;
      H = Math.max(H, th.z + 2.2 * th.a + aheadT);
      const reach = Math.max(Math.abs(this.gxy[0] - cx), Math.abs(this.gxy[1] - cy)) + 2.2 * th.a;
      // o marco zero (base da haste) fica bem dentro do domínio, longe da borda que esmaece
      const reach0 = Math.max(Math.abs(cx), Math.abs(cy)) + Math.max(this.rfb * 4, 0.8 * th.a);
      W = Math.max(W, 2 * reach, 2 * reach0);
      W = Math.max(W, (Math.max(Math.abs(cx), Math.abs(cy)) * 2) / 0.76);
    }
    W = Math.min(W, this.Wmax);
    H = Math.min(H, this.Hmax);
    const b = s.box;
    if (W > b.W * 1.02 || H > b.H * 1.02 || Math.hypot(cx - b.cx, cy - b.cy) > b.W * 0.03) {
      s.setDomain({ cx, cy, W, H });
    }
  }

  /** Liga o campo simulado aos uniforms do passe volumétrico. */
  bind(vu) {
    const on = this.active && this.solver;
    vu.uUseFluid.value = on ? 1 : 0;
    if (!on) return false;
    const s = this.solver;
    vu.tFluid.value = s.scalarTexture;
    vu.uFN.value.copy(s.n);
    vu.uFTiles.value.copy(s.tiles);
    vu.uFAtlas.value.copy(s.atlas);
    vu.uFOrigin.value.copy(s.origin);
    vu.uFH.value.copy(s.h);
    return true;
  }

  info() {
    if (!this.active || !this.solver) return '';
    const b = this.solver.box;
    const th = this.th;
    const dT = this.thermal.buoyancy(th).dTheta;
    return `fluido ${this.solver.preset.label} · domínio ${(b.W / 1000).toFixed(1)} × ${(b.H / 1000).toFixed(1)} km · tempo ×${this.kt.toFixed(0)}`
      + `<br>térmica: ${(th.z / 1000).toFixed(1)} km · sobe ${th.w.toFixed(0)} m/s · raio ${(th.a / 1000).toFixed(2)} km · ΔT ${dT.toFixed(dT < 10 ? 1 : 0)} K`
      + ` · α ${this.thermal.alpha.toFixed(2)} · N ${this.thermal.N.toFixed(3)} s⁻¹`;
  }

  /** Estado da térmica (para o painel de escalas). */
  thermalState() {
    if (!this.active || !this.th) return null;
    return { ...this.th, ...this.thermal.buoyancy(this.th), alpha: this.thermal.alpha, N: this.thermal.N, tPeak: this.thermal.tPeak };
  }
}
