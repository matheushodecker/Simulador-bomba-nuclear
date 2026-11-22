/**
 * Agregador: calcula todos os efeitos de uma detonação.
 * Entrada:
 *   { yieldKt, burst: {mode:'surface'|'optimum'|'custom', heightM}, fissionFraction,
 *     wind: { speedKmh, fromDeg } }
 */
import { CONFIG, EFFECT_STYLE } from '../config.js';
import {
  blastRadius, makeOverpressureFn, makeArrivalFn, optimumHeight, damageLevelForPsi,
} from './blast.js';
import { fireballRadius, fireballTime, cloudTop, cloudCapRadius } from './fireball.js';
import { thermalRadius, thermalFluenceAt, burnDegreeAt, thermalPulseTmax, thermalPulsePower, thermalPulseFraction } from './thermal.js';
import { radiationRadius, radiationDoseAt } from './radiation.js';
import { falloutHeightFactor, falloutContours } from './fallout.js';

export const RING_DESCRIPTIONS = {
  fireball: 'Bola de fogo: tudo dentro dela é vaporizado. Se tocar o solo, suga detritos e gera fallout intenso.',
  blast20: 'Prédios de concreto armado pesado são destruídos ou seriamente danificados. Mortalidade próxima de 100%.',
  blast10: 'Colapso da maioria dos prédios comerciais e residenciais. Mortes generalizadas.',
  blast5: 'Casas residenciais destruídas; prédios comerciais muito danificados. Muitas mortes e feridos.',
  blast3: 'Danos estruturais graves: paredes e telhados arrancados, destroços voando.',
  blast1: 'Janelas quebradas em toda a área; estilhaços de vidro ferem quem está perto delas.',
  rad500: 'Dose de radiação inicial de 500 rem: sem tratamento, ~50% morrem em semanas. Escala lenta (W^0,19).',
  thermal3: 'Queimaduras de 3º grau na pele exposta (destroem toda a espessura da pele); incêndios se iniciam.',
  thermal2: 'Queimaduras de 2º grau: bolhas, dor intensa, cicatrizes permanentes.',
  thermal1: 'Queimaduras de 1º grau, como uma queimadura solar forte.',
};

export function burstToKm(burst, W) {
  if (burst.mode === 'surface') return { mode: 'surface', heightKm: 0 };
  if (burst.mode === 'optimum') return { mode: 'optimum', heightKm: optimumHeight(5, W) };
  return { mode: 'custom', heightKm: Math.max(0, (burst.heightM || 0) / 1000) };
}

export function computeEffects(params) {
  const W = Math.max(params.yieldKt, 1e-4);
  const burst = burstToKm(params.burst || { mode: 'optimum' }, W);
  const hKm = burst.heightKm;
  const ff = params.fissionFraction ?? 1;
  const wind = params.wind || { speedKmh: 24, fromDeg: 270 };

  const radius = {
    fireball: fireballRadius(W, burst),
    blast20: blastRadius(20, W, burst),
    blast10: blastRadius(10, W, burst),
    blast5: blastRadius(5, W, burst),
    blast3: blastRadius(3, W, burst),
    blast1: blastRadius(1, W, burst),
    rad500: radiationRadius(W, hKm),
    thermal3: thermalRadius('third', W, burst, hKm),
    thermal2: thermalRadius('second', W, burst, hKm),
    thermal1: thermalRadius('first', W, burst, hKm),
  };

  const order = ['fireball', 'blast20', 'blast10', 'rad500', 'blast5', 'thermal3', 'blast3', 'thermal2', 'blast1', 'thermal1'];
  const rings = order
    .map((key) => ({
      key,
      radiusKm: radius[key],
      areaKm2: Math.PI * radius[key] ** 2,
      color: EFFECT_STYLE[key].color,
      label: EFFECT_STYLE[key].label,
      desc: RING_DESCRIPTIONS[key],
    }))
    .filter((r) => r.radiusKm > 0.001);

  const psiAt = makeOverpressureFn(W, burst);
  const arrival = makeArrivalFn(W, burst);

  const ffH = falloutHeightFactor(W, burst, hKm);
  const Wf = W * ff * ffH;
  const fallout = {
    heightFactor: ffH,
    fissionYieldKt: Wf,
    windKmh: wind.speedKmh,
    fromDeg: wind.fromDeg,
    downwindBearing: (wind.fromDeg + 180) % 360,
    contours: Wf > 0 ? falloutContours(Wf, wind.speedKmh, W) : [],
  };

  return {
    yieldKt: W,
    burst,
    hKm,
    fissionFraction: ff,
    radius,
    rings,
    psiAt,
    arrivalAt: arrival.arrivalAt,
    frontAt: arrival.frontAt,
    slantAt: arrival.slantAt,
    damageLevelAt: (r) => damageLevelForPsi(psiAt(r)),
    burnDegreeAt: (r) => burnDegreeAt(r, W, burst, hKm),
    thermalFluenceAt: (r) => thermalFluenceAt(r, W, burst, hKm),
    radiationDoseAt: (r) => radiationDoseAt(r, W, hKm),
    fireballTime: fireballTime(W),
    // pulso térmico: potência normalizada e fração emitida em função do tempo físico (s)
    thermalPulse: (() => {
      const tMax = thermalPulseTmax(W);
      return { tMax, powerAt: (t) => thermalPulsePower(t / tMax), fractionAt: (t) => thermalPulseFraction(t / tMax) };
    })(),
    cloud: { topKm: cloudTop(W), capKm: cloudCapRadius(W) },
    fallout,
    energyJ: W * CONFIG.units.KT_TO_J,
  };
}
