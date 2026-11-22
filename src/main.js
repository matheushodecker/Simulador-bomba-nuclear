/**
 * Ponto de entrada: monta mapa, cena 3D, simulação, interface e páginas.
 */
import './styles/base.css';
import './styles/sim.css';
import './styles/pages.css';

import { state } from './state.js';
import { on } from './util/events.js';
import { MapView } from './map/mapView.js';
import { EffectLayers } from './map/effectLayers.js';
import { SceneLayer } from './render/SceneLayer.js';
import { City } from './render/city.js';
import { Debris } from './render/debris.js';
import { ParticleField } from './render/particles.js';
import { MushroomCloud } from './render/mushroom.js';
import { Fireball } from './render/fireball.js';
import { ShockDome } from './render/shockwave.js';
import { GroundEffects } from './render/ground.js';
import { StructuralDestruction, loadRapier } from './render/structural.js';
import { Simulation } from './sim/simulation.js';
import { setSoundEnabled } from './sim/audio.js';
import { createApp } from './app.js';
import { CinemaView } from './cinema/CinemaView.js';
import { initCinemaControls } from './ui/cinemaControls.js';
import { computeEffects } from './physics/effects.js';
import { simParams } from './state.js';
import { initControls } from './ui/controls.js';
import { initResults } from './ui/results.js';
import { initToasts } from './ui/toast.js';
import { initViews, registerView, showView } from './ui/views.js';
import { renderArmas } from './pages/armas.js';
import { renderOficina } from './pages/oficina.js';
import { renderDesafios } from './pages/desafios.js';
import { renderConquistas } from './pages/conquistas.js';
import { renderFisica } from './pages/fisica.js';
import { renderValidacao } from './pages/validacao.js';
import { renderFontes } from './pages/fontes.js';
import { unlock } from './game/achievements.js';
import { CONFIG } from './config.js';
import { load, save } from './util/storage.js';
import { OFFLINE } from './env.js';

initToasts();
initViews();

/* ---------- mapa ---------- */
const mapView = new MapView('map', { center: [state.gz.lng, state.gz.lat], zoom: 13.6, basemap: state.basemap });
const map = mapView.map;
const layers = new EffectLayers(map);

/* ---------- cena 3D (three.js dentro do MapLibre) ---------- */
const scene = new SceneLayer(map);
scene.setOrigin(state.gz);
const maxQ = CONFIG.quality.ultra;
const city = new City(scene);
const debris = new Debris();
const dust = new ParticleField();
const smoke = new ParticleField();
const fire = new ParticleField({ additive: true });
const ground = new GroundEffects();
const fireball = new Fireball();
const mushroom = new MushroomCloud(maxQ.cloud);
const shock = new ShockDome();
const structural = new StructuralDestruction();
// a ordem importa para a transparência: chão → prédios → destroços → poeira → fogo → nuvem → choque
[ground, city, structural, debris, smoke, dust, fire, fireball, mushroom, shock].forEach((o) => scene.add(o));
city.tint = state.tint ? 1 : 0;

on('style-ready', () => {
  layers.install();
  if (!map.getLayer(scene.id)) map.addLayer(scene);
});
on('terrain-changed', (onT) => {
  scene.terrain = onT;
  if (city.loaded) map.once('idle', () => city.applyTerrain(onT));
});
on('tint-changed', (t) => { city.tint = t ? 1 : 0; map.triggerRepaint(); });
on('sound-changed', (s) => setSoundEnabled(s));
setSoundEnabled(state.sound);
map.on('pitchend', () => { if (map.getPitch() > 30) unlock('explorador3d'); });

/* ---------- simulação e app ---------- */
const sim = new Simulation({
  map, layers, scene, city, structural, debris, dust, smoke, fire, fireball, mushroom, shock, ground,
  hudEl: document.getElementById('hud'),
  flashEl: document.getElementById('flash'),
  shakeEl: document.getElementById('map-wrap'),
});
const cinema = new CinemaView({ host: document.getElementById('cinema'), sim, state });
sim.cinema = cinema;
cinema.previewFx = () => computeEffects(simParams());
const app = createApp({ mapView, layers, scene, city, sim, cinema });
on('sim:start', (d) => { if (cinema.active) cinema.onDetonate(d); });
on('cleared', () => cinema.onClear());
on('gz-changed', (gz) => { if (cinema.active) cinema.setOrigin(gz); });
on('buildings-loaded', ({ list }) => {
  cinema.setBuildings(list);
  // baixa o motor de física com antecedência (não atrasa a explosão)
  if (list.length) setTimeout(() => loadRapier().catch(() => {}), 1500);
});
on('cinema-pick', (ll) => app.setGZ(ll));
on('tint-changed', () => { if (cinema.city) cinema.city.tint = state.tint ? 0.85 : 0; });
const controls = initControls(app, mapView);
const results = initResults({ layers, city, sim });
results.registerObjects({ city, structural, debris, dust, smoke, fire, fireball, mushroom, shock, ground });
initCinemaControls({ cinema, mapView });

/* ---------- páginas ---------- */
const ctx = { app, controls, showView };
registerView('armas', (el, first) => renderArmas(el, ctx, first));
registerView('oficina', (el, first) => renderOficina(el, ctx, first));
registerView('desafios', (el, first) => renderDesafios(el, ctx, first));
registerView('conquistas', (el) => renderConquistas(el, ctx));
registerView('fisica', (el, first) => { renderFisica(el, ctx, first); unlock('fisico'); });
registerView('validacao', (el, first) => { renderValidacao(el, ctx, first); unlock('cetico'); });
registerView('fontes', (el, first) => renderFontes(el, ctx, first));
on('view', (name) => { if (name === 'sim') setTimeout(() => map.resize(), 30); });

if (OFFLINE) {
  // edição artefato: abre direto na cidade-modelo, já em 3D
  document.querySelector('.brand-text small').textContent = 'Demonstração · Glasstone & Dolan (1977)';
  let started = false;
  on('style-ready', () => {
    if (started) return;
    started = true;
    app.loadBuildings(state.gz, state.buildings.radiusM).then(() => {
      if (window.innerWidth > 900) {
        document.getElementById('vs-cinema').click();
      } else {
        map.easeTo({ pitch: 55, bearing: -25, zoom: 14.2, duration: 1200 });
      }
    });
  });
} else {
  // intercepta os prédios do mapa sozinho quando o alvo muda (e logo ao abrir)
  let tmr = null;
  const autoLoad = () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => {
      if (!state.buildings.auto || !state.gz) return;
      const R = app.buildingRadius();
      if (!app.buildingsCover(state.gz, R) && !(state.buildings.loading && state.buildings.loadingFor
        && Math.hypot(state.buildings.loadingFor.lat - state.gz.lat, state.buildings.loadingFor.lng - state.gz.lng) < 1e-5)) {
        app.loadBuildings(state.gz, R);
      }
    }, 700);
  };
  on('gz-changed', autoLoad);
  on('style-ready', autoLoad);
}
if (!OFFLINE && !load('seenMenu', false)) {
  // menu inicial com os 3 modos de escolha da arma (só na primeira visita)
  save('seenMenu', true);
  showView('armas');
}

// atalho de depuração no console
window.__sim = { state, app, sim, map, city, scene, cinema };
