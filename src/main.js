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
import { Simulation } from './sim/simulation.js';
import { setSoundEnabled } from './sim/audio.js';
import { createApp } from './app.js';
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
// a ordem importa para a transparência: chão → prédios → destroços → poeira → fogo → nuvem → choque
[ground, city, debris, smoke, dust, fire, fireball, mushroom, shock].forEach((o) => scene.add(o));
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
  map, layers, scene, city, debris, dust, smoke, fire, fireball, mushroom, shock, ground,
  hudEl: document.getElementById('hud'),
  flashEl: document.getElementById('flash'),
  shakeEl: document.getElementById('map-wrap'),
});
const app = createApp({ mapView, layers, scene, city, sim });
const controls = initControls(app, mapView);
const results = initResults({ layers, city, sim });
results.registerObjects({ city, debris, dust, smoke, fire, fireball, mushroom, shock, ground });

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

// menu inicial com os 3 modos de escolha da arma (só na primeira visita)
if (!load('seenMenu', false)) {
  save('seenMenu', true);
  showView('armas');
}

// atalho de depuração no console
window.__sim = { state, app, sim, map, city, scene };
