/**
 * Radiação térmica: R = R1 · W^0,41 (distância oblíqua).
 * Para explosões aéreas, o raio no solo é √(R² − h²).
 */
import { CONFIG } from '../config.js';
import { fireballRadius } from './fireball.js';

const T = CONFIG.thermal;

/** Potência "efetiva" para efeitos térmicos (superfície entrega menos). */
function effectiveYield(W, burst) {
  if (burst.mode === 'surface') return W * T.surfaceYieldFactor;
  if (burst.mode === 'custom') {
    const h = burst.heightKm || 0;
    const rfb = fireballRadius(W, { mode: 'optimum' });
    if (h <= 0) return W * T.surfaceYieldFactor;
    if (h < rfb) return W * (T.surfaceYieldFactor + (1 - T.surfaceYieldFactor) * (h / rfb));
  }
  return W;
}

/** Raio oblíquo (km) para queimadura de grau `deg` ('first'|'second'|'third'). */
export function thermalSlantRadius(deg, W, burst) {
  return T.R1_km[deg] * Math.pow(effectiveYield(W, burst), T.exponent);
}

/** Raio no solo (km). */
export function thermalRadius(deg, W, burst, hKm) {
  const R = thermalSlantRadius(deg, W, burst);
  return hKm > 0 ? Math.sqrt(Math.max(0, R * R - hKm * hKm)) : R;
}

/** Fluência térmica estimada (cal/cm²) a r km — inverso do quadrado a partir do limiar de 3º grau. */
export function thermalFluenceAt(rKm, W, burst, hKm) {
  const R3 = thermalSlantRadius('third', W, burst);
  const s = Math.max(Math.hypot(rKm, hKm), 1e-3);
  return T.fluenceThird_cal * (R3 / s) ** 2;
}

/** Grau de queimadura esperado (0–3) a r km. */
export function burnDegreeAt(rKm, W, burst, hKm) {
  const s = Math.hypot(rKm, hKm);
  if (s <= thermalSlantRadius('third', W, burst)) return 3;
  if (s <= thermalSlantRadius('second', W, burst)) return 2;
  if (s <= thermalSlantRadius('first', W, burst)) return 1;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Pulso térmico no tempo                                              */
/* ------------------------------------------------------------------ */

/**
 * Tempo do segundo máximo de potência térmica (s): t_máx ≈ 0,0417 · W^0,44
 * (G&D §7.85, explosão no ar; W em kt). Ex.: 15 kt → 0,14 s; 1 Mt → 0,87 s.
 */
export function thermalPulseTmax(W) {
  return 0.0417 * Math.pow(Math.max(W, 1e-4), 0.44);
}

/**
 * Potência térmica normalizada P/P_máx em função de τ = t/t_máx — aproximação
 * 2τ²/(1+τ⁴) da curva universal de G&D (Fig. 7.88): pico em τ = 1, ~20% da energia
 * emitida até t_máx e ~90% até 10·t_máx.
 */
export function thermalPulsePower(tau) {
  if (tau <= 0) return 0;
  const t2 = tau * tau;
  return (2 * t2) / (1 + t2 * t2);
}

const SQ2 = Math.SQRT2;
// primitiva de x²/(1+x⁴)
function primitive(x) {
  const a = Math.log((x * x - SQ2 * x + 1) / (x * x + SQ2 * x + 1)) / (4 * SQ2);
  const b = (Math.atan(SQ2 * x + 1) + Math.atan(SQ2 * x - 1)) / (2 * SQ2);
  return a + b;
}
const TOTAL = Math.PI / (2 * SQ2); // ∫₀^∞ x²/(1+x⁴) dx

/** Fração (0–1) da energia térmica já emitida até τ = t/t_máx (forma fechada da integral). */
export function thermalPulseFraction(tau) {
  if (tau <= 0) return 0;
  return Math.min(1, (primitive(tau) - primitive(0)) / TOTAL);
}
