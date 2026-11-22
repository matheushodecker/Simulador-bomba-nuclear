/**
 * Estado global da aplicação (fonte única de verdade para a interface).
 * As preferências visuais são persistidas no localStorage.
 */
import { load, save } from './util/storage.js';
import { emit } from './util/events.js';

const prefs = load('prefs', {});

export const state = {
  gz: { lng: 132.4536, lat: 34.3955 }, // hipocentro de Hiroshima (Hospital Shima)
  yieldKt: 15,
  weapon: { name: 'Little Boy (Hiroshima)', id: 'little-boy', type: 'fissao', fissionFraction: 1 },
  burst: { mode: 'custom', heightM: 600 },
  wind: { speedKmh: 24, fromDeg: 270, source: 'manual' },
  clickMode: 'target',
  basemap: prefs.basemap || 'liberty',
  terrain: false,
  quality: prefs.quality || (matchMedia('(max-width: 900px)').matches ? 'baixa' : 'media'),
  speed: prefs.speed || 'normal',
  tint: prefs.tint ?? true,
  cinematic: prefs.cinematic ?? true,
  sound: prefs.sound ?? true,
  reduceFlash: prefs.reduceFlash ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
  density: 'auto',
  buildings: { radiusM: 1500, auto: true, loading: false, center: null, count: 0 },
  compare: { on: false, weaponId: 'castle-bravo', layout: 'same' },
  lastResult: null,
};

export function savePrefs() {
  save('prefs', {
    basemap: state.basemap, quality: state.quality, speed: state.speed, tint: state.tint,
    cinematic: state.cinematic, sound: state.sound, reduceFlash: state.reduceFlash,
  });
}

/** Atualiza a arma/potência atual e notifica a interface. */
export function setWeapon({ yieldKt, name, id = null, type, fissionFraction, burst }) {
  if (yieldKt != null) state.yieldKt = yieldKt;
  state.weapon = {
    name: name || state.weapon.name,
    id,
    type: type || state.weapon.type,
    fissionFraction: fissionFraction ?? state.weapon.fissionFraction,
  };
  if (burst) state.burst = { ...state.burst, ...burst };
  emit('weapon-changed', state);
}

export function simParams() {
  return {
    yieldKt: state.yieldKt,
    burst: state.burst,
    fissionFraction: state.weapon.fissionFraction,
    wind: state.wind,
  };
}
