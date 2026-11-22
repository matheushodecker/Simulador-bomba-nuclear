/**
 * Radiação ionizante inicial (nêutrons + gama no primeiro minuto).
 * R(500 rem) = 0,70 km · W^0,19 — cresce devagar porque o ar absorve a radiação
 * exponencialmente: D(s) ∝ W · e^(−s/λ) / s². Dobrar W só acrescenta ~λ·ln2 ao raio.
 */
import { CONFIG } from '../config.js';

const R = CONFIG.radiation;

export function radiationSlantRadius(W) {
  return R.R1_km_500rem * Math.pow(W, R.exponent);
}

export function radiationRadius(W, hKm) {
  const s = radiationSlantRadius(W);
  return hKm > 0 ? Math.sqrt(Math.max(0, s * s - hKm * hKm)) : s;
}

/** Dose estimada (rem) a r km do ponto zero. */
export function radiationDoseAt(rKm, W, hKm) {
  const R0 = radiationSlantRadius(W);
  const s = Math.max(Math.hypot(rKm, hKm), 0.01);
  return 500 * (R0 / s) ** 2 * Math.exp(-(s - R0) / R.relaxationLength_km);
}
