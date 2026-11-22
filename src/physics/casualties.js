/**
 * Estimativa GROSSEIRA de vítimas.
 * Integra, em anéis concêntricos, densidade populacional × probabilidade de morte/ferimento.
 * Modelo de sobrepressão do OTA (1979); térmica e radiação combinadas como riscos independentes.
 * Não inclui fallout, incêndios em massa, colapso de serviços de saúde etc.
 */
import { CONFIG } from '../config.js';

const C = CONFIG.casualties;

/** Densidade (hab/km²) a r km do centro para um perfil {D0, rCore, decay}. */
export function densityAt(rKm, profile) {
  const { D0, rCore, decay } = profile;
  const d = rKm <= rCore ? D0 : D0 * Math.pow(rCore / rKm, decay);
  return Math.max(C.floorDensity, d);
}

/** Perfil "automático" medido a partir da área construída dos prédios carregados. */
export function profileFromBuildings(totalFloorAreaM2, loadRadiusKm) {
  const areaKm2 = Math.PI * loadRadiusKm * loadRadiusKm;
  const D0 = totalFloorAreaM2 / C.m2PerPerson / Math.max(areaKm2, 1e-6);
  return { label: 'Automático (área construída)', D0, rCore: Math.max(loadRadiusKm, 0.5), decay: 1.5 };
}

function blastProbabilities(psi) {
  for (const b of C.blast) if (psi >= b.min) return b;
  return { dead: 0, injured: 0 };
}

/**
 * @param {object} fx resultado de computeEffects()
 * @param {{D0:number,rCore:number,decay:number}} profile
 */
export function estimateCasualties(fx, profile) {
  const rMax = Math.max(fx.radius.blast1 || 0, fx.radius.thermal1 || 0, fx.radius.rad500 || 0) * 1.05;
  if (!(rMax > 0)) return { population: 0, dead: 0, injured: 0, rMax: 0 };
  const N = 800;
  let pop = 0;
  let dead = 0;
  let injured = 0;
  const exp = C.exposedFraction;
  for (let i = 0; i < N; i++) {
    // espaçamento quadrático: mais amostras perto do centro
    const r0 = rMax * (i / N) ** 2;
    const r1 = rMax * ((i + 1) / N) ** 2;
    const r = 0.5 * (r0 + r1);
    const area = Math.PI * (r1 * r1 - r0 * r0);
    const people = densityAt(r, profile) * area;
    pop += people;

    if (r <= fx.radius.fireball && fx.hKm < fx.radius.fireball) {
      dead += people;
      continue;
    }
    const b = blastProbabilities(fx.psiAt(r));
    let t = { dead: 0, injured: 0 };
    const deg = fx.burnDegreeAt(r);
    if (deg === 3) t = C.thermalThird;
    else if (deg === 2) t = C.thermalSecond;
    else if (deg === 1) t = C.thermalFirst;
    const tDead = t.dead * exp;
    const tInj = t.injured * exp;
    const rad = r <= fx.radius.rad500 ? C.radiation500 : { dead: 0, injured: 0 };
    const alive = (1 - b.dead) * (1 - tDead) * (1 - rad.dead);
    const pDead = 1 - alive;
    const pInj = Math.min(alive, 1 - (1 - b.injured) * (1 - tInj) * (1 - rad.injured));
    dead += people * pDead;
    injured += people * pInj;
  }
  return { population: pop, dead, injured, rMax };
}
