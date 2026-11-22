/**
 * Onda de choque: sobrepressão de pico em função da distância, potência e altura.
 * Lei de escala cúbica (Glasstone & Dolan §3.60):  R = R1 · W^(1/3)
 */
import { CONFIG } from '../config.js';
import { interpLogLog, clamp } from './math.js';

const B = CONFIG.blast;
// tabela [psi, R1] e tabela invertida [R1, psi]
const TABLE = [...B.table1kt].sort((a, b) => b[0] - a[0]); // psi decrescente
const TABLE_INV = TABLE.map(([p, r]) => [r, p]);           // R1 crescente

/** Raio escalado (km, para 1 kt, altura ótima) onde a sobrepressão vale `psi`. */
export function scaledRadiusForPsi(psi) {
  return interpLogLog(TABLE, psi);
}

/** Sobrepressão (psi) a uma distância escalada r1 (km/kt^1/3), altura ótima. */
export function psiForScaledRadius(r1) {
  return interpLogLog(TABLE_INV, Math.max(r1, 1e-4));
}

export const cbrt = (W) => Math.cbrt(W);

/** Raio na altura ótima para aquela sobrepressão (envoltória das curvas HOB). */
export function optimumRadius(psi, W) {
  return scaledRadiusForPsi(psi) * cbrt(W);
}

/** Altura de explosão (km) que maximiza o raio de `psi`. */
export function optimumHeight(psi, W) {
  return B.optimumHeightRatio * optimumRadius(psi, W);
}

/**
 * Fator de altura de explosão (heurístico, calibrado nas curvas de G&D Fig. 3.73):
 *  - h = 0           → groundFactor (explosão no solo, ~0,75)
 *  - 0 < h < h_ót    → cresce suavemente até 1
 *  - h > h_ót        → decresce; em h ≥ maxHeightRatio·h_ót a pressão não chega ao solo
 */
export function heightFactor(psi, W, hKm) {
  const gf = B.groundFactor;
  if (hKm <= 0) return gf;
  const rho = hKm / optimumHeight(psi, W);
  if (rho <= 1) return gf + (1 - gf) * Math.sin((Math.PI / 2) * rho);
  const x = (rho - 1) / (B.maxHeightRatio - 1);
  return Math.max(0, 1 - x * x);
}

/**
 * Raio no solo (km) para a sobrepressão `psi`.
 * @param {{mode:'surface'|'optimum'|'custom', heightKm?:number}} burst
 */
export function blastRadius(psi, W, burst) {
  if (burst.mode === 'surface') return optimumRadius(psi, W) * B.groundFactor;
  if (burst.mode === 'optimum') return optimumRadius(psi, W);
  return optimumRadius(psi, W) * heightFactor(psi, W, burst.heightKm || 0);
}

/**
 * Cria uma função r(km) → psi para uma detonação, invertendo blastRadius por tabela.
 * Rápida o bastante para classificar dezenas de milhares de prédios.
 */
export function makeOverpressureFn(W, burst) {
  const N = 260;
  const pMin = 0.05;
  const pMax = 5000;
  const samples = [];
  let rPrev = 0;
  // de pressões altas para baixas: o raio deve crescer (força monotonicidade)
  for (let i = 0; i < N; i++) {
    const p = pMax * Math.pow(pMin / pMax, i / (N - 1));
    const r = Math.max(blastRadius(p, W, burst), rPrev + 1e-7);
    samples.push([r, p]);
    rPrev = r;
  }
  return function psiAt(rKm) {
    if (rKm <= samples[0][0]) return pMax;
    if (rKm >= samples[N - 1][0]) {
      // além do último ponto: decaimento ~1/r
      return pMin * (samples[N - 1][0] / rKm);
    }
    // busca binária
    let lo = 0;
    let hi = N - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid][0] < rKm) lo = mid;
      else hi = mid;
    }
    const [r0, p0] = samples[lo];
    const [r1, p1] = samples[hi];
    const t = (Math.log(rKm) - Math.log(r0)) / (Math.log(r1) - Math.log(r0) || 1);
    return Math.exp(Math.log(p0) + t * (Math.log(p1) - Math.log(p0)));
  };
}

/**
 * Velocidade da frente de choque (km/s) para sobrepressão p (psi).
 * Rankine–Hugoniot para ar (γ = 1,4) — G&D eq. 3.55.1:  U = c0 √(1 + 6p/7P0)
 */
export function shockSpeed(psi) {
  return B.soundSpeed_kms * Math.sqrt(1 + B.shockSpeedCoef * (psi / B.ambientPsi));
}

/**
 * Cria a função t(r): tempo (s) de chegada da onda de choque a um ponto no solo a
 * `r` km do ponto zero. Integra dt = ds / U(p(s)) ao longo da distância oblíqua.
 */
export function makeArrivalFn(W, burst) {
  const h = burst.mode === 'surface' ? 0 : burst.mode === 'optimum' ? optimumHeight(5, W) : burst.heightKm || 0;
  const w3 = cbrt(W);
  const factor = burst.mode === 'surface' ? B.groundFactor : 1;
  const sMax = Math.max(scaledRadiusForPsi(0.2) * w3 * 3, h * 2 + 1);
  const N = 500;
  const s0 = 1e-4 * w3;
  const ss = [0];
  const ts = [0];
  let t = 0;
  let sPrev = s0;
  for (let i = 1; i <= N; i++) {
    const s = s0 * Math.pow(sMax / s0, i / N);
    const sm = 0.5 * (s + sPrev);
    const p = psiForScaledRadius(sm / (w3 * factor));
    t += (s - sPrev) / shockSpeed(p);
    ss.push(s);
    ts.push(t);
    sPrev = s;
  }
  const tAt = (s) => {
    if (s <= ss[1]) return 0;
    if (s >= ss[N]) return ts[N] + (s - ss[N]) / B.soundSpeed_kms;
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ss[m] < s) lo = m;
      else hi = m;
    }
    const k = (s - ss[lo]) / (ss[hi] - ss[lo]);
    return ts[lo] + k * (ts[hi] - ts[lo]);
  };
  const arrivalAt = (rKm) => tAt(Math.hypot(rKm, h));
  // inversa: distância oblíqua percorrida pela frente em função do tempo
  const slantAt = (tSec) => {
    let lo = 0;
    let hi = sMax * 4;
    for (let i = 0; i < 50; i++) {
      const m = 0.5 * (lo + hi);
      if (tAt(m) < tSec) lo = m;
      else hi = m;
    }
    return 0.5 * (lo + hi);
  };
  // raio da frente no solo (para a animação)
  const frontAt = (tSec) => {
    const s = slantAt(tSec);
    return s <= h ? 0 : Math.sqrt(s * s - h * h);
  };
  return { arrivalAt, frontAt, slantAt, heightKm: h };
}

/** Nível de dano (0–5) para uma sobrepressão. */
export function damageLevelForPsi(psi) {
  for (const d of CONFIG.damage) if (psi >= d.min) return d.level;
  return 0;
}

export function damageInfo(level) {
  return CONFIG.damage.find((d) => d.level === level) || CONFIG.damage[CONFIG.damage.length - 1];
}

export { clamp };
