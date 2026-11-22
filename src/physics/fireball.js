/** Bola de fogo e nuvem em cogumelo. */
import { CONFIG } from '../config.js';

const F = CONFIG.fireball;

/** Raio máximo da bola de fogo (km): R = 0,044 · W^0,4 (× ~1,26 no solo). */
export function fireballRadius(W, burst = { mode: 'optimum' }) {
  const R = F.R1_km * Math.pow(W, F.exponent);
  const atGround = burst.mode === 'surface' || (burst.mode === 'custom' && (burst.heightKm || 0) <= 0);
  return atGround ? R * F.surfaceFactor : R;
}

/** Tempo (s) até a bola de fogo atingir o raio máximo (apenas para animação). */
export function fireballTime(W) {
  return F.tMax_s_1kt * Math.pow(W, F.tMaxExponent);
}

/** A bola de fogo toca o solo? (determina se há fallout local significativo) */
export function fireballTouchesGround(W, heightKm) {
  return heightKm < fireballRadius(W, { mode: 'optimum' });
}

/** Altura do topo da nuvem estabilizada (km). */
export function cloudTop(W) {
  return CONFIG.cloud.topA_km * Math.pow(W, CONFIG.cloud.topExp);
}

/** Raio do "chapéu" da nuvem estabilizada (km). */
export function cloudCapRadius(W) {
  return CONFIG.cloud.capA_km * Math.pow(W, CONFIG.cloud.capExp);
}
