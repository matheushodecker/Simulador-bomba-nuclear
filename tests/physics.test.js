import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { blastRadius, makeOverpressureFn, makeArrivalFn, optimumHeight, shockSpeed } from '../src/physics/blast.js';
import { fireballRadius } from '../src/physics/fireball.js';
import { thermalRadius } from '../src/physics/thermal.js';
import { radiationRadius } from '../src/physics/radiation.js';
import { contourDims, decayFactor, accumulatedDose, doseRateAt } from '../src/physics/fallout.js';
import { computeEffects } from '../src/physics/effects.js';
import { estimateCasualties } from '../src/physics/casualties.js';

const opt = { mode: 'optimum' };
const close = (a, b, tol = 0.01) => expect(Math.abs(a - b) / b).toBeLessThan(tol);

describe('onda de choque', () => {
  it('reproduz os raios de calibração para 1 kt', () => {
    close(blastRadius(20, 1, opt), 0.22);
    close(blastRadius(5, 1, opt), 0.53);
    close(blastRadius(1, 1, opt), 1.4);
  });
  it('obedece à escala cúbica: 8× potência → 2× raio', () => {
    for (const p of [20, 5, 1]) close(blastRadius(p, 8000, opt) / blastRadius(p, 1000, opt), 2);
  });
  it('explosão no solo reduz o raio em 20–30%', () => {
    const f = blastRadius(5, 100, { mode: 'surface' }) / blastRadius(5, 100, opt);
    expect(f).toBeGreaterThanOrEqual(0.7);
    expect(f).toBeLessThanOrEqual(0.8);
  });
  it('a função inversa psi(r) é coerente com o raio', () => {
    const psiAt = makeOverpressureFn(15, opt);
    close(psiAt(blastRadius(5, 15, opt)), 5, 0.02);
    close(psiAt(blastRadius(20, 15, opt)), 20, 0.02);
  });
  it('altura ótima de 5 psi para 15 kt ≈ Hiroshima (~600 m)', () => {
    const h = optimumHeight(5, 15) * 1000;
    expect(h).toBeGreaterThan(500);
    expect(h).toBeLessThan(700);
  });
  it('a frente de choque desacelera até ~340 m/s', () => {
    close(shockSpeed(0.01), 0.34, 0.01);
    const { arrivalAt } = makeArrivalFn(1000, { mode: 'surface', heightKm: 0 });
    const v = (arrivalAt(30) - arrivalAt(20)) > 0 ? 10 / (arrivalAt(30) - arrivalAt(20)) : 0;
    expect(v).toBeGreaterThan(0.33);
    expect(v).toBeLessThan(0.37);
  });
});

describe('bola de fogo, térmica e radiação', () => {
  it('bola de fogo = 0,044·W^0,4', () => close(fireballRadius(1000, opt), 0.044 * 1000 ** 0.4));
  it('3º grau = 0,63 km para 1 kt (superfície do alvo, sem altura)', () =>
    close(thermalRadius('third', 1, opt, 0), 0.63));
  it('graus térmicos em ordem 1º > 2º > 3º', () => {
    const r1 = thermalRadius('first', 100, opt, 0);
    const r2 = thermalRadius('second', 100, opt, 0);
    const r3 = thermalRadius('third', 100, opt, 0);
    expect(r1).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r3);
  });
  it('radiação cresce como W^0,19', () => close(radiationRadius(1000, 0) / radiationRadius(1, 0), 1000 ** 0.19));
});

describe('fallout', () => {
  it('ordem de grandeza: 1 Mt de fissão, 24 km/h → ~360 km para 1 rad/h', () => {
    const d = contourDims(1, 1000, 24, 1000);
    expect(d.L).toBeGreaterThan(300);
    expect(d.L).toBeLessThan(420);
  });
  it('regra 7-10', () => close(decayFactor(7), 0.1, 0.1));
  it('dose acumulada positiva e crescente', () => {
    expect(accumulatedDose(100, 1, 168)).toBeGreaterThan(accumulatedDose(100, 1, 24));
  });
  it('taxa de dose no eixo diminui com a distância', () => {
    expect(doseRateAt(5, 0, 1000, 24, 1000)).toBeGreaterThan(doseRateAt(100, 0, 1000, 24, 1000));
  });
  it('sem fallout local em altura ótima', () => {
    const fx = computeEffects({ yieldKt: 15, burst: { mode: 'optimum' } });
    expect(fx.fallout.contours.length).toBe(0);
  });
});

describe('vítimas', () => {
  it('números finitos e mortos < população', () => {
    const fx = computeEffects({ yieldKt: 15, burst: { mode: 'optimum' } });
    const c = estimateCasualties(fx, CONFIG.casualties.densityProfiles.urbana);
    expect(c.dead).toBeGreaterThan(0);
    expect(c.dead + c.injured).toBeLessThanOrEqual(c.population * 1.0001);
  });
});
