/**
 * Estado global da aplicação (fonte única de verdade para a interface).
 * As preferências visuais são persistidas no localStorage.
 */
import { load, save } from './util/storage.js';
import { emit } from './util/events.js';
import { OFFLINE } from './env.js';
import { DEMO_CENTER } from './data/demoCity.js';

const prefs = load('prefs', {});
const ENV = import.meta.env || {};
const envProvider = ENV.VITE_GOOGLE_TILES_KEY ? 'google' : ENV.VITE_CESIUM_ION_TOKEN ? 'cesium' : null;
const cinemaProvider = prefs.cinemaProvider || envProvider || 'google';

/** Chave do serviço de cidades 3D: salva só neste navegador (ou vinda do .env local). */
export function cinemaKeyFor(provider) {
  const saved = load(`cinemaKey:${provider}`, '');
  if (saved) return saved;
  if (provider === 'google') return ENV.VITE_GOOGLE_TILES_KEY || '';
  if (provider === 'cesium') return ENV.VITE_CESIUM_ION_TOKEN || '';
  return '';
}

export const state = {
  // hipocentro de Hiroshima (Hospital Shima); na edição artefato, a praça central da cidade-modelo
  gz: OFFLINE ? { ...DEMO_CENTER } : { lng: 132.4536, lat: 34.3955 },
  yieldKt: 15,
  weapon: { name: 'Little Boy (Hiroshima)', id: 'little-boy', type: 'fissao', fissionFraction: 1 },
  burst: { mode: 'custom', heightM: 600 },
  wind: { speedKmh: 24, fromDeg: 270, source: 'manual' },
  clickMode: 'target',
  basemap: OFFLINE ? 'demo' : prefs.basemap || 'liberty',
  terrain: false,
  quality: prefs.quality || (matchMedia('(max-width: 900px)').matches ? 'baixa' : 'media'),
  speed: prefs.speed || 'normal',
  tint: prefs.tint ?? true,
  cinematic: prefs.cinematic ?? true,
  sound: prefs.sound ?? true,
  reduceFlash: prefs.reduceFlash ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
  density: 'auto',
  // radiusM = 0 → automático (pela potência)
  buildings: { radiusM: OFFLINE ? 2000 : 0, auto: true, loading: false, center: null, count: 0 },
  compare: { on: false, weaponId: 'castle-bravo', layout: 'same' },
  cinema: { active: false, provider: OFFLINE ? 'none' : cinemaProvider, key: '', timeOfDay: prefs.timeOfDay || 'dia', fluid: prefs.fluid || 'auto', radii: prefs.radii !== false },
  lastResult: null,
};

state.cinema.key = OFFLINE ? '' : cinemaKeyFor(state.cinema.provider);

export function savePrefs() {
  save('prefs', {
    basemap: state.basemap, quality: state.quality, speed: state.speed, tint: state.tint,
    cinematic: state.cinematic, sound: state.sound, reduceFlash: state.reduceFlash,
    cinemaProvider: state.cinema.provider, timeOfDay: state.cinema.timeOfDay, fluid: state.cinema.fluid, radii: state.cinema.radii,
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
