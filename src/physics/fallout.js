/**
 * Fallout local — modelo simplificado tipo WSEG-10 (ver CONFIG.fallout).
 * Cada contorno de taxa de dose em H+1 é uma elipse alongada a favor do vento.
 * Coordenadas locais: x = a favor do vento (km), y = transversal (km).
 */
import { CONFIG } from '../config.js';
import { clamp } from './math.js';
import { fireballRadius, cloudCapRadius } from './fireball.js';

const FO = CONFIG.fallout;

/** Fator (0–1) de fallout local conforme a altura de explosão. */
export function falloutHeightFactor(W, burst, hKm) {
  if (burst.mode === 'surface') return 1;
  if (burst.mode === 'optimum') return 0;
  const rfb = fireballRadius(W, { mode: 'optimum' });
  if (hKm >= rfb) return 0;
  return Math.pow(1 - hKm / rfb, FO.heightCutoffPower);
}

/** Fator de vento fu = (u/24)^0,5 limitado. */
export function windFactor(windKmh) {
  return clamp(Math.sqrt(Math.max(windKmh, 0.1) / FO.refWind_kmh), FO.windExpMin, FO.windExpMax);
}

/**
 * Dimensões da elipse para a taxa de dose D (rad/h em H+1).
 * @returns {{L:number,B:number,U:number}} comprimento a favor do vento, largura, extensão contra o vento (km)
 */
export function contourDims(D, WfKt, windKmh, Wtotal = WfKt) {
  if (WfKt <= 0) return { L: 0, B: 0, U: 0 };
  const fu = windFactor(windKmh);
  const base = FO.cL * Math.sqrt(WfKt) * Math.pow(D, -FO.beta);
  const L = base * fu;
  // largura mínima ligada ao tamanho da nuvem (nuvens grandes depositam numa faixa larga)
  const capR = cloudCapRadius(Wtotal);
  const minB = 1.2 * capR * Math.pow(D, -0.15) * Math.sqrt(WfKt / Math.max(Wtotal, 1e-6));
  const B = Math.max((FO.aspect * base) / fu, minB);
  const U = Math.max(FO.upwindFrac * L, 0.3 * B);
  return { L, B, U };
}

/** Contornos padrão (1000, 100, 10, 1 rad/h) com áreas aproximadas. */
export function falloutContours(WfKt, windKmh, Wtotal, tHours = 1) {
  return FO.levels.map((level) => {
    // a região com taxa ≥ level no instante t corresponde ao contorno H+1 de level·t^1,2
    const Dref = level * Math.pow(tHours, FO.decayExponent);
    const { L, B, U } = contourDims(Dref, WfKt, windKmh, Wtotal);
    const area = (Math.PI / 4) * (L + U) * B;
    return { level, Dref, L, B, U, area };
  });
}

/** Taxa de dose relativa a H+1 após t horas (regra 7-10: D ∝ t^-1,2). */
export function decayFactor(tHours) {
  return Math.pow(Math.max(tHours, 1e-3), -FO.decayExponent);
}

/** Dose acumulada (rad) entre t1 e t2 (h) para taxa D1 em H+1. ∫ D1 t^-1,2 dt */
export function accumulatedDose(D1, t1, t2) {
  const k = FO.decayExponent - 1; // 0,2
  return (D1 / k) * (Math.pow(t1, -k) - Math.pow(t2, -k));
}

/** O ponto (x a favor do vento, y transversal) está dentro da elipse? */
export function insideEllipse(x, y, dims) {
  const { L, B, U } = dims;
  if (L <= 0) return false;
  const a = (L + U) / 2;
  const xc = (L - U) / 2;
  const b = B / 2;
  return ((x - xc) / a) ** 2 + (y / b) ** 2 <= 1;
}

/** Taxa de dose (rad/h em H+1) estimada num ponto local, por bissecção nos contornos. */
export function doseRateAt(x, y, WfKt, windKmh, Wtotal) {
  if (WfKt <= 0) return 0;
  let lo = Math.log(1e-3);
  let hi = Math.log(1e6);
  if (!insideEllipse(x, y, contourDims(Math.exp(lo), WfKt, windKmh, Wtotal))) return 0;
  for (let i = 0; i < 40; i++) {
    const m = 0.5 * (lo + hi);
    if (insideEllipse(x, y, contourDims(Math.exp(m), WfKt, windKmh, Wtotal))) lo = m;
    else hi = m;
  }
  return Math.exp(lo);
}

/** Pontos (x,y) do contorno da elipse; `xMax` corta a pluma (animação de avanço). */
export function ellipsePoints(dims, steps = 96, xMax = Infinity) {
  const { L, B, U } = dims;
  const a = (L + U) / 2;
  const xc = (L - U) / 2;
  const b = B / 2;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    let x = xc + a * Math.cos(th);
    // leve formato de "gota": mais largo perto do ponto zero
    const taper = 1 - 0.25 * Math.max(0, (x - xc) / a);
    const y = b * Math.sin(th) * taper;
    x = Math.min(x, xMax);
    pts.push([x, y]);
  }
  return pts;
}
