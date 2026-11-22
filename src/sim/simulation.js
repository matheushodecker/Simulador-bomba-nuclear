/**
 * Orquestra a sequência da detonação:
 *  1. clarão  2. bola de fogo  3. onda de choque (velocidade física, acelerada)
 *  4. prédios mudando conforme a onda passa  5. cogumelo 3D  6. pluma de fallout
 */
import { computeEffects } from '../physics/effects.js';
import { CONFIG } from '../config.js';
import { emit } from '../util/events.js';
import { haversineKm } from '../map/geo.js';
import { playBlast, primeAudio } from './audio.js';
import { buildDust, buildFires } from '../render/fxgen.js';
import { smoothstep, clamp } from '../physics/math.js';
import { fmtDist, fmtTime, fmtSig, fmtNum } from '../util/format.js';
import { triplePointHeightKm, groundShockArrival, MACH_ANGLE_DEG } from '../physics/structures.js';

/** duração visual-alvo da passagem da onda até 1 psi (s) */
const SPEED = { lento: 13, normal: 7, rapido: 3.5 };

export class Simulation {
  /**
   * @param {object} d dependências: map, layers, scene, city, debris, dust, smoke, fire,
   *   fireball, mushroom, shock, ground, hudEl, flashEl, shakeEl
   */
  constructor(d) {
    Object.assign(this, d);
    this.tau = -1;
    this.running = false;
    this.fx = null;
    this.scene.clock = () => this.tau;
    this.city.fireSource = this.fireball;
    this.ground.lightSource = this.fireball;
    this._tick = this._tick.bind(this);
  }

  computeAccel(fx, speed) {
    if (speed === 'real') return 1;
    return Math.max(1, fx.arrivalAt(fx.radius.blast1) / (SPEED[speed] || SPEED.normal));
  }

  detonate(params, gz, opts) {
    this.stop();
    if (opts.sound) primeAudio();
    const fx = computeEffects(params);
    this.fx = fx;
    this.params = params;
    this.gz = gz;
    this.opts = opts;
    this.accel = this.computeAccel(fx, opts.speed);
    this.q = CONFIG.quality[opts.quality] || CONFIG.quality.media;
    if (!this.city.loaded) this.scene.setOrigin(gz);
    this.gzLocal = this.scene.toLocal(gz.lng, gz.lat);
    this.tFb = clamp(fx.fireballTime / Math.max(1, this.accel / 4), 0.7, 3);

    this.layers.setRings(fx, gz, false);
    this.layers.reveal('fireball');
    this.layers.setFallout(fx, gz, 0);
    this.falloutStart = fx.arrivalAt(fx.radius.blast1) / this.accel * 0.6;
    this._lastFallout = -1;

    const down = (((params.wind.fromDeg + 180) % 360) * Math.PI) / 180;
    const ws = params.wind.speedKmh / 3.6;
    this.windVis = [Math.sin(down) * ws * 4, Math.cos(down) * ws * 4];
    this.dust.setWind(this.windVis[0] * 0.3, this.windVis[1] * 0.3);
    this.smoke.setWind(this.windVis[0] * 0.6, this.windVis[1] * 0.6);

    this.mushroom.start(fx, this.gzLocal, this.windVis, this.q.cloud, this.tFb);
    this.fireball.start(fx, this.gzLocal, this.tFb, (t) => this.mushroom.capCenterAt(t));
    this.shock.start(fx, this.gzLocal, this.accel);
    this.ground.start(fx, this.gzLocal);
    this.stats = this.applyBuildings();

    this.soundPlayed = false;
    this.t0 = performance.now();
    this.tau = 0;
    this.running = true;
    this.scene.active = true;
    this.hudEl.hidden = false;
    requestAnimationFrame(this._tick);
    emit('sim:start', { fx, stats: this.stats, accel: this.accel, params, gz });
    return fx;
  }

  /** (Re)calcula danos, destroços, poeira e incêndios. */
  applyBuildings() {
    const fx = this.fx;
    if (!fx) return null;
    const blds = this.city.loaded ? this.city.buildings : [];
    let stats = null;
    if (this.city.loaded) {
      stats = this.city.applyDetonation(fx, this.gzLocal, this.accel);
      stats.debris = this.debris.generate(blds, this.gzLocal, this.q.debris, fx.radius.fireball);
    } else {
      this.debris.clear();
    }
    buildDust(this.dust, { fx, gz: this.gzLocal, accel: this.accel, buildings: blds, count: this.q.dust });
    buildFires(this.fire, this.smoke, { fx, gz: this.gzLocal, buildings: blds, count: this.q.fire });
    return stats;
  }

  /** Chamado quando os prédios terminam de carregar durante/depois de uma detonação. */
  onBuildingsLoaded() {
    if (!this.fx) return;
    this.gzLocal = this.scene.toLocal(this.gz.lng, this.gz.lat);
    // reposiciona efeitos na nova origem
    this.mushroom.gz = this.gzLocal;
    this.fireball.gz = this.gzLocal;
    this.shock.gz = this.gzLocal;
    this.ground.start(this.fx, this.gzLocal);
    this.stats = this.applyBuildings();
    emit('sim:stats', this.stats);
  }

  _tick() {
    if (!this.running) return;
    const fx = this.fx;
    // `fixedTau` permite congelar o tempo (depuração/capturas: window.__sim.sim.fixedTau = 2)
    const tau = this.fixedTau ?? (performance.now() - this.t0) / 1000;
    this.tau = tau;
    const tPhys = tau * this.accel;
    const front = fx.frontAt(tPhys);

    for (const r of fx.rings) {
      const due = r.key.startsWith('blast') ? front >= r.radiusKm : tau > (r.key === 'rad500' ? 0.35 : 0.2);
      if (due) this.layers.reveal(r.key);
    }
    const endR = fx.radius.blast1 * 1.12;
    const alpha = front > 0 && front < endR ? 1 - smoothstep(endR * 0.8, endR, front) : 0;
    this.layers.setShock(this.gz, front, alpha);

    if (fx.fallout.contours.length) {
      const p = smoothstep(0, 1, (tau - this.falloutStart) / CONFIG.anim.falloutSeconds);
      if (p > 0 && Math.abs(p - this._lastFallout) > 0.01) {
        this.layers.setFallout(fx, this.gz, Math.max(0.002, p));
        this._lastFallout = p;
        if (p >= 1) emit('sim:fallout-complete', { fx, gz: this.gz });
      }
    }

    const flash = Math.exp(-tau / 0.16) * (this.opts.reduceFlash ? 0.25 : 1);
    this.city.flash = flash * 0.9;
    this.city.pulse = fx.thermalPulse ? fx.thermalPulse.fractionAt(tPhys) : smoothstep(0, 0.6, tau);
    this.debris.flash = flash * 0.9;
    this.dust.flash = flash;
    this.flashEl.style.opacity = this.cinemaActive ? '0' : String(this.opts.reduceFlash ? flash * 0.35 : flash);

    // som e tremor quando a frente alcança a câmera (centro da tela no mapa, ou a câmera do modo cinema)
    const dc = this.cinemaActive && this.cinema ? this.cinema.cameraDistKm() : haversineKm(this.map.getCenter(), this.gz);
    if (!this.soundPlayed && tau >= fx.arrivalAt(dc) / this.accel) {
      this.soundPlayed = true;
      const psiC = fx.psiAt(dc);
      const inten = clamp(Math.log10(psiC + 1) / 1.5, 0.12, 1);
      if (this.opts.sound) playBlast(inten, this.accel > 5 ? 0.7 : 1);
      if (psiC > 0.3 && !this.cinemaActive) this.shake(inten);
    }

    this.updateHud(tau, tPhys, front, dc);
    this.scene.active = !this.cinemaActive;
    if (!this.cinemaActive) this.map.triggerRepaint();
    if (tau > 240) {
      this.running = false;
      this.scene.active = false;
      return;
    }
    requestAnimationFrame(this._tick);
  }

  updateHud(tau, tPhys, front, dc) {
    const fx = this.fx;
    const parts = [];
    parts.push(`<span><b>T+</b> ${fmtTime(tPhys)} <small>(tempo real)</small></span>`);
    if (front > 0 && front < fx.radius.blast1 * 1.1) {
      const psi = fx.psiAt(front);
      parts.push(`<span><b>Frente de choque</b> ${fmtDist(front)} · ${fmtSig(psi, 2)} psi · ${fmtNum(speedAt(psi), 0)} m/s</span>`);
    } else if (front >= fx.radius.blast1 * 1.1) {
      parts.push(`<span><b>Onda de choque</b> passou de 1 psi (${fmtDist(fx.radius.blast1)}) em ${fmtTime(fx.arrivalAt(fx.radius.blast1))}</span>`);
    }
    const tp = fx.thermalPulse;
    if (tp && tPhys < tp.tMax * 25) {
      parts.push(`<span><b>Pulso térmico</b> ${fmtNum(tp.fractionAt(tPhys) * 100, 0)}% da energia emitida · pico em ${fmtTime(tp.tMax)}</span>`);
    }
    // reflexão da onda no solo (explosões no ar): regular perto do marco zero, Mach além de ~40°
    if (fx.hKm > fx.radius.fireball && front > 0 && front < fx.radius.blast1 * 1.1) {
      const sKm = fx.slantAt(tPhys);
      const yT = triplePointHeightKm(sKm, fx.hKm, fx.psiAt(front)) * 1000;
      parts.push(yT > 0
        ? `<span><b>Reflexão no solo</b> tronco de Mach · ponto triplo a ~${fmtNum(yT, 0)} m</span>`
        : `<span><b>Reflexão no solo</b> regular (ângulo < ${MACH_ANGLE_DEG}°)</span>`);
    }
    // explosão no solo: o tremor pelo terreno (onda P) chega antes da onda no ar a partir de certa distância
    if (fx.hKm <= fx.radius.fireball) {
      const tg = groundShockArrival(dc);
      const ta = fx.arrivalAt(dc);
      if (tg < ta && tPhys < tg) parts.push(`<span>🌍 O tremor do solo chega ao centro da tela em ${fmtTime(tg - tPhys)} (antes da onda no ar)</span>`);
    }
    const arrCam = fx.arrivalAt(dc);
    if (tPhys < arrCam && dc < fx.radius.blast1 * 3) parts.push(`<span>🔇 O som chega ao centro da tela em ${fmtTime(arrCam - tPhys)}</span>`);
    parts.push(`<span class="muted">animação ${this.accel <= 1.01 ? 'em tempo real' : `acelerada ×${fmtNum(this.accel, this.accel < 10 ? 1 : 0)}`}</span>`);
    if (this.cinemaActive && this.cinema?.fluid?.active) parts.push(`<span class="muted">${this.cinema.fluid.info()}</span>`);
    this.hudEl.innerHTML = parts.join('');
  }

  shake(intensity) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = this.shakeEl;
    el.style.setProperty('--shake', `${(2 + 10 * intensity).toFixed(1)}px`);
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  /** Limpa tudo e volta os prédios ao estado intacto. */
  stop() {
    this.running = false;
    this.tau = -1;
    this.fx = null;
    this.scene.active = false;
    this.layers.clear();
    this.city.reset();
    this.debris.clear();
    this.dust.clear();
    this.fire.clear();
    this.smoke.clear();
    this.fireball.stop();
    this.mushroom.stop();
    this.shock.stop();
    this.ground.stop();
    this.flashEl.style.opacity = '0';
    this.hudEl.hidden = true;
    this.map.triggerRepaint();
  }
}

function speedAt(psi) {
  const B = CONFIG.blast;
  return 1000 * B.soundSpeed_kms * Math.sqrt(1 + B.shockSpeedCoef * (psi / B.ambientPsi));
}
