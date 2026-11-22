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
