import { describe, it, expect } from 'vitest';
import { calibrateThermal, buoyancyFlux, lapseFromN } from '../src/physics/thermal_rise.js';
import { computeEffects } from '../src/physics/effects.js';

const KT = 4.184e12;

function setup(kt, mode = 'optimum') {
  const fx = computeEffects({ yieldKt: kt, burst: { mode, heightM: 0 }, wind: { fromDeg: 270, speedKmh: 20 }, fissionFrac: 0.5 });
  const rfb = fx.radius.fireball * 1000;
  const top = fx.cloud.topKm * 1000;
  const cap = fx.cloud.capKm * 1000;
  const zTarget = top - 0.8 * Math.min(cap, 0.18 * top);
  const m = calibrateThermal({
    z0: Math.max(fx.hKm * 1000, rfb * 0.6), a0: rfb, heatJ: 0.35 * kt * KT,
    zTarget, aTarget: cap, tTarget: 240 * kt ** 0.1,
  });
  return { m, zTarget, top, cap };
}

describe('térmica (Morton–Taylor–Turner)', () => {
  it('empuxo inicial cresce linearmente com o calor', () => {
    expect(buoyancyFlux(2e13) / buoyancyFlux(1e13)).toBeCloseTo(2, 6);
  });

  it('Γ = N²θ₀/g', () => {
    expect(lapseFromN(0.01)).toBeCloseTo((0.01 ** 2 * 300) / 9.81, 8);
  });

  for (const kt of [1, 15, 1000]) {
    it(`${kt} kt: para na altura-alvo com α e N fisicamente plausíveis`, () => {
      const { m, zTarget } = setup(kt);
      const s = m.init();
      while (s.t < 1200 && !s.peaked) m.step(s, 0.5);
      expect(s.zMax / zTarget).toBeGreaterThan(0.97);
      expect(s.zMax / zTarget).toBeLessThan(1.03);
      expect(m.alpha).toBeGreaterThan(0.03);
      expect(m.alpha).toBeLessThan(0.36);
      expect(m.N).toBeGreaterThan(0.003);
      expect(m.N).toBeLessThan(0.03);
    });
  }

  it('15 kt: sobe a ~100 m/s no início e leva alguns minutos para estabilizar', () => {
    const { m } = setup(15);
    const s = m.init();
    let wmax = 0;
    while (s.t < 30) { m.step(s, 0.25); wmax = Math.max(wmax, s.w); }
    expect(wmax).toBeGreaterThan(60);
    expect(wmax).toBeLessThan(200);
    expect(m.tPeak).toBeGreaterThan(150);
    expect(m.tPeak).toBeLessThan(700);
  });

  it('a bolha esfria ao subir (entranhamento + estratificação)', () => {
    const { m } = setup(15);
    const s = m.init();
    const d0 = m.buoyancy(s).dTheta;
    while (s.t < 60) m.step(s, 0.5);
    expect(m.buoyancy(s).dTheta).toBeLessThan(d0 * 0.1);
  });
});

import { thermalPulseTmax, thermalPulsePower, thermalPulseFraction } from '../src/physics/thermal.js';

describe('pulso térmico no tempo', () => {
  it('t_máx segue 0,0417·W^0,44', () => {
    expect(thermalPulseTmax(1000)).toBeCloseTo(0.0417 * 1000 ** 0.44, 6);
    expect(thermalPulseTmax(15)).toBeGreaterThan(0.1);
    expect(thermalPulseTmax(15)).toBeLessThan(0.2);
  });
  it('potência tem pico 1 em τ = 1', () => {
    expect(thermalPulsePower(1)).toBeCloseTo(1, 9);
    expect(thermalPulsePower(0.5)).toBeLessThan(1);
    expect(thermalPulsePower(2)).toBeLessThan(1);
  });
  it('fração emitida: ~20% até t_máx, ~90% até 10·t_máx, monotônica', () => {
    expect(thermalPulseFraction(1)).toBeGreaterThan(0.18);
    expect(thermalPulseFraction(1)).toBeLessThan(0.26);
    expect(thermalPulseFraction(10)).toBeGreaterThan(0.85);
    expect(thermalPulseFraction(10)).toBeLessThan(0.95);
    let prev = 0;
    for (let t = 0.05; t < 50; t *= 1.3) { const f = thermalPulseFraction(t); expect(f).toBeGreaterThanOrEqual(prev); prev = f; }
    expect(thermalPulseFraction(1e6)).toBeCloseTo(1, 4);
  });
  it('forma fechada confere com integração numérica', () => {
    let acc = 0; const h = 1e-4;
    for (let t = h / 2; t < 3; t += h) acc += thermalPulsePower(t) * h;
    expect(thermalPulseFraction(3)).toBeCloseTo(acc / (Math.PI / Math.SQRT2), 3);
  });
});

import {
  normalReflectionFactor, reflectionRegime, machStartKm, triplePointHeightKm, positivePhaseSeconds,
  dynamicLoadFactor, materialResponse, groundParticleVelocity, materialOf,
} from '../src/physics/structures.js';

describe('onda de choque no ambiente', () => {
  it('reflexão normal: 2× (fraca) até 8× (forte)', () => {
    expect(normalReflectionFactor(0.01)).toBeCloseTo(2, 2);
    expect(normalReflectionFactor(1e6)).toBeGreaterThan(7.9);
    expect(normalReflectionFactor(1e6)).toBeLessThanOrEqual(8);
  });
  it('regime: regular perto do marco zero, Mach além de ~40°', () => {
    expect(reflectionRegime(0.1, 0.6, 0.13)).toBe('regular');
    expect(reflectionRegime(1.0, 0.6, 0.13)).toBe('mach');
    expect(reflectionRegime(1.0, 0.0, 0.13)).toBe('superficie');
    expect(machStartKm(1)).toBeCloseTo(Math.tan((40 * Math.PI) / 180), 6);
  });
  it('ponto triplo nasce no início da reflexão de Mach e sobe com a distância', () => {
    const h = 0.6;
    const sM = h / Math.cos((40 * Math.PI) / 180);
    expect(triplePointHeightKm(sM * 0.99, h, 5)).toBe(0);
    const a = triplePointHeightKm(1.2, h, 5);
    const b = triplePointHeightKm(2.0, h, 5);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });
  it('fase positiva escala com W^⅓ (mesma distância escalada)', () => {
    const t1 = positivePhaseSeconds(1.0, 1);
    const t1000 = positivePhaseSeconds(10.0, 1000);
    expect(t1000 / t1).toBeCloseTo(10, 1);
    expect(t1).toBeGreaterThan(0.1);
    expect(t1).toBeLessThan(0.6);
  });
  it('fator de carga dinâmica: π·t_d/T (impulsivo) → 2 (quase estático)', () => {
    expect(dynamicLoadFactor(0.01) / (Math.PI * 0.01)).toBeCloseTo(1, 1);
    expect(dynamicLoadFactor(1000)).toBeGreaterThan(1.98);
    expect(dynamicLoadFactor(1000)).toBeLessThanOrEqual(2.0001);
  });
  it('ordem dos materiais sob a mesma onda: vidro < madeira ≤ alvenaria < concreto', () => {
    const psi = 6; const td = 0.6;
    const lv = (m) => materialResponse(m, psi, td).level;
    expect(lv('glass')).toBeGreaterThanOrEqual(lv('wood'));
    expect(lv('wood')).toBeGreaterThanOrEqual(lv('masonry'));
    expect(lv('masonry')).toBeGreaterThan(lv('concrete'));
  });
  it('pulso curto (explosão pequena) danifica menos estruturas rígidas e lentas', () => {
    expect(materialResponse('steel', 20, 0.01).level).toBeLessThan(materialResponse('steel', 20, 1).level);
  });
  it('vibração do solo: v = p/(ρc)', () => {
    expect(groundParticleVelocity(10)).toBeCloseTo((10 * 6894.76) / (1800 * 900), 6);
  });
  it('material provável pelo tipo e pela tag', () => {
    expect(materialOf({ material: 'wood' })).toBe('wood');
    expect(materialOf({ kind: 'warehouse', height: 8 })).toBe('steel');
    expect(materialOf({ kind: 'office', height: 80 })).toBe('concrete');
    expect(materialOf({ kind: 'house', height: 6 })).toBe('masonry');
  });
});
