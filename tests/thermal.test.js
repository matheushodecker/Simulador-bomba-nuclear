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
