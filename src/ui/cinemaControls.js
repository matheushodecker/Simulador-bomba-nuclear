/** Controles do modo cinema: alternância Mapa/Cinema, chave das cidades 3D e hora do dia. */
import { state, savePrefs, cinemaKeyFor } from '../state.js';
import { save } from '../util/storage.js';
import { on, emit } from '../util/events.js';
import { OFFLINE } from '../env.js';

const $ = (id) => document.getElementById(id);

const HELP = {
  google: 'Chave da <b>Google Maps Platform</b>: em console.cloud.google.com crie um projeto, ative a <b>Map Tiles API</b> e gere uma chave em "Credenciais". Exige conta de faturamento; há uma cota mensal gratuita (confira os valores atuais). A chave fica salva só neste navegador.',
  cesium: 'Token do <b>Cesium ion</b> (conta gratuita em ion.cesium.com → Access Tokens). Adicione o recurso "Google Photorealistic 3D Tiles" (ID 2275207) à sua conta no Asset Depot. O token fica salvo só neste navegador.',
  none: 'Sem chave: chão com imagem de satélite (Esri) e prédios do OpenStreetMap, com a mesma iluminação, nuvem volumétrica e destruição. Para cidades fotorrealistas, escolha Google ou Cesium ion.',
};

export function initCinemaControls({ cinema, mapView }) {
  const setActive = (on) => {
    if (on) {
      if (!cinema.activate()) return;
    } else {
      cinema.deactivate();
      setTimeout(() => mapView.map.resize(), 30);
    }
    state.cinema.active = on;
    $('vs-map').classList.toggle('active', !on);
    $('vs-cinema').classList.toggle('active', on);
    $('cinema-toggle').textContent = on ? '🗺️ Voltar ao mapa' : '🎬 Entrar no modo cinema';
    document.getElementById('map-wrap').style.visibility = on ? 'hidden' : 'visible';
    emit('cinema-mode', on);
  };
  $('vs-map').addEventListener('click', () => setActive(false));
  $('vs-cinema').addEventListener('click', () => setActive(true));
  $('cinema-toggle').addEventListener('click', () => setActive(!state.cinema.active));

  const prov = $('cinema-provider');
  const keyIn = $('cinema-key');
  const render = () => {
    prov.value = state.cinema.provider;
    $('cinema-key-row').style.display = state.cinema.provider === 'none' ? 'none' : 'flex';
    keyIn.value = state.cinema.key ? '••••••••••••' : '';
    keyIn.placeholder = state.cinema.provider === 'google' ? 'Chave da Google Maps Platform' : 'Token do Cesium ion';
    $('cinema-key-help').innerHTML = HELP[state.cinema.provider];
  };
  prov.addEventListener('change', () => {
    state.cinema.provider = prov.value;
    state.cinema.key = cinemaKeyFor(prov.value);
    savePrefs();
    render();
    cinema.forceFallback = false;
    if (state.cinema.active) cinema.setWorld();
  });
  keyIn.addEventListener('focus', () => { if (keyIn.value.startsWith('••')) keyIn.value = ''; });
  $('cinema-key-save').addEventListener('click', () => {
    const v = keyIn.value.trim();
    if (!v || v.startsWith('••')) return;
    state.cinema.key = v;
    save(`cinemaKey:${state.cinema.provider}`, v);
    render();
    cinema.forceFallback = false;
    emit('toast', { type: 'ok', text: 'Chave salva neste navegador. Carregando cidades 3D…' });
    if (state.cinema.active) cinema.setWorld(); else setActive(true);
  });
  const fl = $('cinema-fluid');
  fl.value = state.cinema.fluid;
  fl.addEventListener('change', () => {
    state.cinema.fluid = fl.value;
    savePrefs();
    emit('toast', { type: 'info', text: 'A nova configuração de fluidos vale a partir da próxima detonação.' });
  });
  const rd = $('cinema-radii');
  rd.checked = state.cinema.radii !== false;
  rd.addEventListener('change', () => { state.cinema.radii = rd.checked; savePrefs(); });
  const time = $('cinema-time');
  time.value = state.cinema.timeOfDay;
  time.addEventListener('change', () => {
    state.cinema.timeOfDay = time.value;
    savePrefs();
    cinema.setTimeOfDay(time.value);
  });
  on('cinema-tiles-error', (msg) => {
    emit('toast', {
      type: 'error',
      text: `Não foi possível carregar as cidades 3D (${msg}). Verifique a chave e se a API está ativada. Usando satélite + OSM por enquanto.`,
      timeout: 9000,
    });
    cinema.useFallback();
  });
  $('quality').addEventListener('change', () => cinema.applyQuality());
  render();
  if (OFFLINE) {
    prov.closest('.row').hidden = true;
    $('cinema-key-row').style.display = 'none';
    $('cinema-key-help').textContent = 'Nesta edição de demonstração o modo cinema usa a cidade-modelo. Com a versão completa e uma chave do Google ou do Cesium ion, ele mostra cidades fotorrealistas reais.';
  }
  return { setActive };
}
