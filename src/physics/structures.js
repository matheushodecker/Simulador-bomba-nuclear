/**
 * Resposta do AMBIENTE à onda de choque: reflexão no solo (regular × Mach),
 * duração da fase positiva, resposta dinâmica de estruturas por material e
 * vibração do solo. Tudo aqui trata de efeitos sobre o ambiente — nada sobre a arma.
 *
 * Referências públicas:
 *  - Glasstone & Dolan (1977), cap. 3 (reflexão, ondas de Mach), cap. 5 (danos a estruturas)
 *  - Kinney & Graham (1985), "Explosive Shocks in Air" — duração da fase positiva
 *  - Biggs (1964), "Introduction to Structural Dynamics" — sistema de 1 grau de liberdade
 *    sob carga triangular (fator de carga dinâmica)
 */
import { CONFIG } from '../config.js';

const P0 = CONFIG.blast.ambientPsi; // 14,7 psi
const PSI_TO_PA = 6894.76;

/* ------------------------------------------------------------------ */
/* Reflexão no solo                                                    */
/* ------------------------------------------------------------------ */

/**
 * Coeficiente de reflexão NORMAL (onda batendo de frente numa parede rígida),
 * Rankine–Hugoniot para ar com γ = 1,4 (G&D eq. 3.56.1):
 *   p_r = 2·p·(7·P₀ + 4·p) / (7·P₀ + p)
 * → 2× para ondas fracas, até 8× para ondas muito fortes.
 */
export function normalReflectionFactor(psi) {
  return (2 * (7 * P0 + 4 * psi)) / (7 * P0 + psi);
}

/** Ângulo de incidência (graus, a partir da vertical) da onda ao chegar ao solo a r km. */
export function incidenceAngleDeg(rKm, hKm) {
  return (Math.atan2(rKm, Math.max(hKm, 1e-6)) * 180) / Math.PI;
}

/** Acima de ~40° de incidência a reflexão deixa de ser regular e forma o tronco de Mach (G&D §3.25). */
export const MACH_ANGLE_DEG = 40;

/**
 * Regime de reflexão no ponto a r km do marco zero.
 * @returns {'superficie'|'regular'|'mach'}
 */
export function reflectionRegime(rKm, hKm, fireballKm) {
  if (hKm <= (fireballKm ?? 0)) return 'superficie';
  return incidenceAngleDeg(rKm, hKm) < MACH_ANGLE_DEG ? 'regular' : 'mach';
}

/** Distância no solo (km) onde começa a reflexão de Mach. */
export function machStartKm(hKm) {
  return hKm * Math.tan((MACH_ANGLE_DEG * Math.PI) / 180);
}

/**
 * Altura do ponto triplo (km) — onde a onda incidente, a refletida e o tronco de Mach se encontram.
 * Modelo geométrico: a onda refletida viaja no ar já comprimido e aquecido pela incidente, por isso
 * anda um pouco mais rápido e alcança a incidente perto do chão. Com a incidente centrada no ponto da
 * explosão (raio s) e a refletida na "imagem" abaixo do solo (raio s + δ):
 *   y_T = ((s + δ)² − s²) / (4h),   δ = k(p)·(s − s_M),   k = 0,3·p/(p + P₀)
 * Ilustrativo (ordem de grandeza): mostra por que o tronco de Mach cresce com a distância.
 * @param {number} sKm raio (oblíquo) da frente incidente
 * @param {number} hKm altura da explosão
 * @param {number} psi sobrepressão incidente na frente
 */
export function triplePointHeightKm(sKm, hKm, psi) {
  if (hKm <= 0) return 0;
  const sM = hKm / Math.cos((MACH_ANGLE_DEG * Math.PI) / 180);
  if (sKm <= sM) return 0;
  const k = (0.3 * psi) / (psi + P0);
  const d = k * (sKm - sM);
  return ((sKm + d) ** 2 - sKm ** 2) / (4 * hKm);
}

/* ------------------------------------------------------------------ */
/* Duração da fase positiva                                            */
/* ------------------------------------------------------------------ */

/**
 * Duração da fase positiva (s) a uma distância r (km) — ajuste de Kinney & Graham para
 * explosões no ar, com equivalência de ~50% da energia nuclear em onda de choque.
 * Ex.: 1 kt a ~1,4 km (≈1 psi) → ~0,3 s; 1 Mt → ×10 (escala com W^⅓).
 */
export function positivePhaseSeconds(rKm, W) {
  const wKg = Math.max(W, 1e-6) * 0.5 * 1e6; // kt nuclear → kg de TNT equivalentes em sopro
  const w3 = Math.cbrt(wKg);
  const Z = Math.max((rKm * 1000) / w3, 0.05);
  const ms = (980 * (1 + (Z / 0.54) ** 10)) / ((1 + (Z / 0.02) ** 3) * (1 + (Z / 0.74) ** 6) * Math.sqrt(1 + (Z / 6.9) ** 2));
  return (ms * w3) / 1000;
}

/* ------------------------------------------------------------------ */
/* Resposta dinâmica (1 grau de liberdade)                             */
/* ------------------------------------------------------------------ */

/**
 * Fator de carga dinâmica máximo (deslocamento máximo / deslocamento estático) de um
 * oscilador elástico sem amortecimento sob carga triangular de duração t_d, em função de
 * t_d/T. Limites: ≈ π·t_d/T (impulsivo, t_d ≪ T) e → 2 (quase estático, t_d ≫ T).
 * Calculado uma vez por integração exata trecho a trecho e guardado numa tabela.
 */
const DLF_TABLE = (() => {
  const n = 160;
  const lo = Math.log(0.005);
  const hi = Math.log(200);
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    const ratio = Math.exp(lo + ((hi - lo) * i) / (n - 1));
    xs.push(ratio);
    ys.push(dlfExact(ratio));
  }
  return { lo, hi, n, ys };
})();

function dlfExact(ratio) {
  // T = 1, ω = 2π; carga F(t) = 1 − t/t_d (0 ≤ t ≤ t_d), depois livre
  const w = 2 * Math.PI;
  const td = ratio;
  // solução analítica durante a carga (x(0)=v(0)=0, k=1):
  //   x(t) = (1 − cos ωt) + (sin ωt/ω − t)/t_d
  const x = (t) => 1 - Math.cos(w * t) + (Math.sin(w * t) / w - t) / td;
  const v = (t) => w * Math.sin(w * t) + (Math.cos(w * t) - 1) / td;
  let best = 0;
  const steps = 400;
  for (let i = 1; i <= steps; i++) best = Math.max(best, Math.abs(x((td * i) / steps)));
  // vibração livre depois da carga: amplitude = √(x² + (v/ω)²)
  const amp = Math.hypot(x(td), v(td) / w);
  return Math.max(best, amp);
}

export function dynamicLoadFactor(tdOverT) {
  const { lo, hi, n, ys } = DLF_TABLE;
  const l = Math.log(Math.min(Math.max(tdOverT, 1e-4), 1e4));
  if (l <= lo) return ys[0] * (tdOverT / Math.exp(lo)); // regime impulsivo: ∝ t_d/T
  if (l >= hi) return ys[n - 1];
  const f = ((l - lo) / (hi - lo)) * (n - 1);
  const i = Math.floor(f);
  return ys[i] + (ys[i + 1] - ys[i]) * (f - i);
}

/* ------------------------------------------------------------------ */
/* Materiais                                                           */
/* ------------------------------------------------------------------ */

/**
 * Propriedades aproximadas. `psi` são as sobrepressões incidentes (carga longa, típica de
 * explosões nucleares) para os níveis de dano 1–5 (vidros → destruído), de tabelas públicas
 * (G&D Tab. 5.139 e similares); `T` é o período natural típico (s) do elemento que governa o dano.
 */
export const MATERIALS = {
  glass: {
    label: 'Vidro (janelas, fachadas)', density: 2500, E_GPa: 70, T: 0.02,
    psi: [0.5, 1.5, 3, 5, 10],
    note: 'Frágil: quebra sem aviso. Estilhaços voam a dezenas de m/s — principal causa de ferimentos a vários km.',
  },
  wood: {
    label: 'Madeira (estrutura leve)', density: 550, E_GPa: 11, T: 0.12,
    psi: [1, 2, 3.5, 5, 8],
    note: 'Leve e flexível: deforma e "cede" antes de quebrar; paredes e telhados são arrancados por volta de 3–5 psi. Inflama com o pulso térmico.',
  },
  masonry: {
    label: 'Alvenaria (tijolo/bloco)', density: 1900, E_GPa: 8, T: 0.08,
    psi: [1, 3, 5.5, 8, 12],
    note: 'Pesada, mas frágil à tração: paredes sem armadura racham e tombam para dentro.',
  },
  concrete: {
    label: 'Concreto armado', density: 2400, E_GPa: 30, T: 0.35,
    psi: [1, 5, 10, 15, 25],
    note: 'Rígido e pesado, com aço que dá ductilidade: resiste muito mais; a estrutura pode ficar de pé mesmo com o interior destruído.',
  },
  steel: {
    label: 'Estrutura de aço', density: 7850, E_GPa: 200, T: 0.6,
    psi: [1, 4, 8, 14, 25],
    note: 'Muito dúctil: o esqueleto entorta sem romper, mas o fechamento (painéis, vidro) é arrancado cedo.',
  },
};

/** Solo (para a vibração do terreno). */
export const SOIL = { label: 'Solo (aluvião típico)', density: 1800, cP: 900, cR: 280 };

/** Material provável de um prédio (tag OSM `building:material`, tipo e altura). */
export function materialOf(b) {
  const tag = (b.material || '').toLowerCase();
  if (/glass/.test(tag)) return 'glass';
  if (/wood|timber/.test(tag)) return 'wood';
  if (/steel|metal/.test(tag)) return 'steel';
  if (/concrete|reinforced/.test(tag)) return 'concrete';
  if (/brick|stone|masonry|block|adobe/.test(tag)) return 'masonry';
  const kind = b.kind || '';
  const h = b.height ?? (b.levels || 1) * 3.2;
  if (['hut', 'cabin', 'shed', 'bungalow'].includes(kind)) return 'wood';
  if (['industrial', 'warehouse', 'factory', 'hangar', 'manufacture'].includes(kind)) return 'steel';
  if (h > 24 || ['office', 'hospital', 'university', 'hotel'].includes(kind)) return 'concrete';
  if (h > 12 || ['apartments', 'commercial', 'retail', 'school', 'civic', 'public'].includes(kind)) return h > 16 ? 'concrete' : 'masonry';
  return 'masonry';
}

/**
 * Resposta de um material à onda no ponto.
 * @param {string} mat chave de MATERIALS
 * @param {number} psi sobrepressão incidente
 * @param {number} tdS duração da fase positiva (s)
 * @returns {{level:number, dlf:number, ratio:number, effPsi:number}}
 *   effPsi é a sobrepressão "equivalente de carga longa": psi · DLF(t_d/T)/2
 */
export function materialResponse(mat, psi, tdS) {
  const m = MATERIALS[mat] || MATERIALS.masonry;
  const ratio = tdS / m.T;
  const dlf = dynamicLoadFactor(ratio);
  const effPsi = (psi * dlf) / 2;
  let level = 0;
  for (let i = 0; i < 5; i++) if (effPsi >= m.psi[i]) level = i + 1;
  return { level, dlf, ratio, effPsi };
}

/* ------------------------------------------------------------------ */
/* Vibração do solo                                                    */
/* ------------------------------------------------------------------ */

/**
 * Velocidade de partícula do solo (m/s) induzida pela onda no ar: relação de impedância
 * 1D v ≈ p / (ρ·c_P). Ex.: 10 psi em aluvião → ~4 cm/s.
 */
export function groundParticleVelocity(psi, soil = SOIL) {
  return (psi * PSI_TO_PA) / (soil.density * soil.cP);
}

/** Chegada (s) do tremor que viaja pelo solo (onda P) — só relevante para explosões no/rente ao solo. */
export function groundShockArrival(rKm, soil = SOIL) {
  return (rKm * 1000) / soil.cP;
}

/**
 * Vento de pico logo atrás da frente de choque (m/s) — G&D eq. 3.55.2:
 *   u = (5p / 7P₀) · c₀ / √(1 + 6p / 7P₀)
 * É esse vento (a pressão dinâmica) que arranca e arremessa os destroços.
 */
export function peakWindSpeed(psi) {
  const x = psi / P0;
  const c0 = CONFIG.blast.soundSpeed_kms * 1000;
  return ((5 * x) / 7) * c0 / Math.sqrt(1 + (6 * x) / 7);
}

/** Paredes portantes (a parede segura o andar) × estrutura em pórtico (pilares e vigas). */
export function isFrameMaterial(mat) {
  return mat === 'concrete' || mat === 'steel';
}
