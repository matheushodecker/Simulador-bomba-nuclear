/**
 * Painel de controles do simulador (lado esquerdo).
 */
import { state, setWeapon, savePrefs, simParams } from '../state.js';
import { CONFIG } from '../config.js';
import { on, emit } from '../util/events.js';
import { BASEMAPS } from '../map/basemaps.js';
import { QUICK_PRESETS, HISTORIC_WEAPONS } from '../data/weapons.js';
import { yieldComparisons } from '../data/comparisons.js';
import { searchPlaces } from '../services/nominatim.js';
import { fetchWind } from '../services/openmeteo.js';
import { optimumHeight } from '../physics/blast.js';
import { fireballRadius } from '../physics/fireball.js';
import { loadArsenal } from '../game/arsenal.js';
import { unlock, trackHistoric } from '../game/achievements.js';
import { fmtCoord, fmtYield, fmtInt, fmtNum, escapeHtml } from '../util/format.js';
import { drawCompass, cardinal } from './compass.js';
import { showView } from './views.js';

const $ = (id) => document.getElementById(id);
const LOG_MIN = Math.log10(CONFIG.yield.minKt);
const LOG_MAX = Math.log10(CONFIG.yield.maxKt);
const sliderToKt = (v) => 10 ** (LOG_MIN + (v / 1000) * (LOG_MAX - LOG_MIN));
const ktToSlider = (kt) => Math.round(((Math.log10(kt) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000);

export function initControls(app, mapView) {
  const map = mapView.map;

  /* ---------------- busca ---------------- */
  const results = $('search-results');
  $('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('search-input').value.trim();
    if (!q) return;
    results.innerHTML = '<li class="muted">Buscando…</li>';
    try {
      const list = await searchPlaces(q);
      results.innerHTML = list.length ? '' : '<li class="muted">Nada encontrado.</li>';
      list.forEach((r) => {
        const li = document.createElement('li');
        li.textContent = r.name;
        li.addEventListener('click', () => {
          results.innerHTML = '';
          app.setGZ({ lng: r.lng, lat: r.lat }, { fly: true, zoom: 14 });
        });
        results.appendChild(li);
      });
    } catch {
      results.innerHTML = '<li class="muted">Falha na busca (Nominatim indisponível?).</li>';
    }
  });

  /* ---------------- ponto zero ---------------- */
  const showGZ = () => {
    $('gz-coords').textContent = state.gz ? `📍 ${fmtCoord(state.gz.lat, state.gz.lng)}` : 'Clique no mapa para escolher o ponto de detonação.';
  };
  on('gz-changed', showGZ);
  showGZ();

  const setMode = (mode) => {
    $('mode-target').classList.toggle('active', mode === 'target');
    $('mode-inspect').classList.toggle('active', mode === 'inspect');
    $('click-hint').textContent = mode === 'inspect' ? '🔎 Clique num prédio para ver distância, sobrepressão e dano' : '🎯 Clique no mapa para escolher o ponto de detonação';
    map.getCanvas().style.cursor = mode === 'inspect' ? 'help' : 'crosshair';
  };
  $('mode-target').addEventListener('click', () => app.setClickMode('target'));
  $('mode-inspect').addEventListener('click', () => app.setClickMode('inspect'));
  on('click-mode', setMode);
  setMode(state.clickMode);

  map.on('click', (e) => {
    if (state.clickMode === 'inspect') {
      if (!app.inspectAt(e.point) && !document.querySelector('.maplibregl-popup')) {
        emit('toast', { type: 'info', text: 'Nenhum prédio aqui. Use o modo 🎯 Alvo para mover o ponto zero.', timeout: 2500 });
      }
    } else {
      app.setGZ(e.lngLat);
    }
  });

  /* ---------------- prédios ---------------- */
  $('bld-radius').value = String(state.buildings.radiusM);
  $('bld-radius').addEventListener('change', (e) => { state.buildings.radiusM = Number(e.target.value); });
  $('bld-auto').checked = state.buildings.auto;
  $('bld-auto').addEventListener('change', (e) => { state.buildings.auto = e.target.checked; });
  $('bld-load').addEventListener('click', () => app.loadBuildings(state.gz, state.buildings.radiusM));
  on('buildings-status', ({ text, kind }) => {
    const el = $('bld-status');
    el.textContent = text;
    el.className = `status ${kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'muted'}`;
  });

  /* ---------------- potência ---------------- */
  const presets = $('yield-presets');
  QUICK_PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = `${p.label} · ${fmtYield(p.kt)}`;
    b.addEventListener('click', () => {
      const w = HISTORIC_WEAPONS.find((x) => x.id === p.id);
      setWeapon({
        yieldKt: w.yieldKt, name: `${w.name}`, id: w.id, type: w.type,
        fissionFraction: w.fissionFraction ?? CONFIG.fallout.fissionFraction[w.type], burst: w.burst,
      });
      trackHistoric(w.id);
    });
    presets.appendChild(b);
  });

  const renderYield = () => {
    const kt = state.yieldKt;
    $('yield-slider').value = String(ktToSlider(kt));
    const unit = kt < 1 ? 't' : kt < 1000 ? 'kt' : 'Mt';
    $('yield-unit').value = unit;
    $('yield-number').value = String(Number((unit === 't' ? kt * 1000 : unit === 'Mt' ? kt / 1000 : kt).toPrecision(4)));
    $('yield-compare').innerHTML = yieldComparisons(kt).map((s) => `<div>${escapeHtml(s)}</div>`).join('');
    $('weapon-name').textContent = state.weapon.name;
    $('weapon-type').value = state.weapon.type;
    presets.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('active', QUICK_PRESETS[i].id === state.weapon.id));
  };
  const customYield = (kt) => {
    kt = Math.min(CONFIG.yield.maxKt, Math.max(CONFIG.yield.minKt, kt));
    setWeapon({ yieldKt: kt, name: `Personalizada · ${fmtYield(kt)}`, id: null });
  };
  $('yield-slider').addEventListener('input', (e) => customYield(Number(sliderToKt(Number(e.target.value)).toPrecision(3))));
  const fromNumber = () => {
    const v = parseFloat(String($('yield-number').value).replace(',', '.'));
    if (!(v > 0)) return;
    const u = $('yield-unit').value;
    customYield(u === 't' ? v / 1000 : u === 'Mt' ? v * 1000 : v);
  };
  $('yield-number').addEventListener('change', fromNumber);
  $('yield-unit').addEventListener('change', fromNumber);
  $('weapon-type').addEventListener('change', (e) => {
    const type = e.target.value;
    setWeapon({ type, fissionFraction: CONFIG.fallout.fissionFraction[type], id: state.weapon.id, name: state.weapon.name });
  });
  $('open-arsenal').addEventListener('click', () => showView('armas'));

  /* ---------------- tipo de explosão ---------------- */
  const renderBurst = () => {
    document.querySelectorAll('input[name="burst"]').forEach((r) => { r.checked = r.value === state.burst.mode; });
    $('burst-custom-row').style.display = state.burst.mode === 'custom' ? 'flex' : 'none';
    $('burst-height').value = String(state.burst.heightM ?? 0);
    const W = state.yieldKt;
    const hOpt = optimumHeight(5, W) * 1000;
    const rfb = fireballRadius(W) * 1000;
    let info = `Altura ótima para 5 psi: <b>${fmtInt(hOpt)} m</b>. Raio da bola de fogo: ${fmtInt(rfb)} m.`;
    const h = state.burst.mode === 'surface' ? 0 : state.burst.mode === 'optimum' ? hOpt : state.burst.heightM;
    info += h < rfb ? ' <span style="color:#ffb74d">A bola de fogo toca o solo → fallout local.</span>' : ' Bola de fogo não toca o solo → pouco fallout local.';
    $('burst-info').innerHTML = info;
  };
  document.querySelectorAll('input[name="burst"]').forEach((r) => r.addEventListener('change', () => {
    state.burst = { ...state.burst, mode: r.value };
    renderBurst();
    emit('params-changed');
  }));
  $('burst-height').addEventListener('change', (e) => {
    state.burst = { ...state.burst, heightM: Math.max(0, Number(e.target.value) || 0) };
    renderBurst();
    emit('params-changed');
  });

  on('weapon-changed', () => { renderYield(); renderBurst(); app.updateCompare(); });
  renderYield();
  renderBurst();

  /* ---------------- vento ---------------- */
  const renderWind = () => {
    $('wind-speed').value = String(Math.round(state.wind.speedKmh));
    $('wind-dir').value = String(Math.round(state.wind.fromDeg));
    $('wind-speed-out').textContent = `${fmtNum(state.wind.speedKmh, 0)} km/h`;
    $('wind-dir-out').textContent = `${Math.round(state.wind.fromDeg)}° (${cardinal(state.wind.fromDeg)})`;
    drawCompass($('wind-compass'), state.wind.fromDeg, state.wind.speedKmh);
  };
  $('wind-speed').addEventListener('input', (e) => { state.wind = { ...state.wind, speedKmh: Number(e.target.value), source: 'manual' }; renderWind(); });
  $('wind-dir').addEventListener('input', (e) => { state.wind = { ...state.wind, fromDeg: Number(e.target.value), source: 'manual' }; renderWind(); });
  $('wind-fetch').addEventListener('click', async () => {
    const st = $('wind-status');
    st.textContent = 'Consultando Open-Meteo…';
    try {
      const w = await fetchWind(state.gz.lat, state.gz.lng);
      state.wind = { speedKmh: Math.round(w.effective.speed), fromDeg: Math.round(w.effective.dir), source: 'open-meteo' };
      renderWind();
      st.innerHTML = `Superfície (10 m): ${fmtNum(w.surface.speed, 0)} km/h de ${Math.round(w.surface.dir)}°.`
        + (w.aloft ? ` <b>Altitude (média 850/500 hPa): ${fmtNum(w.aloft.speed, 0)} km/h de ${Math.round(w.aloft.dir)}°</b> — usado no fallout.` : '');
      unlock('meteorologista');
    } catch {
      st.textContent = 'Não foi possível obter o vento agora. Use os controles manuais.';
    }
  });
  renderWind();

  /* ---------------- visual ---------------- */
  const bm = $('basemap');
  Object.entries(BASEMAPS).forEach(([k, v]) => bm.add(new Option(v.label, k)));
  bm.value = state.basemap;
  bm.addEventListener('change', () => { state.basemap = bm.value; savePrefs(); mapView.setBasemap(bm.value); });
  on('basemap-changed', (k) => { state.basemap = k; bm.value = k; });

  $('toggle-3d').addEventListener('click', () => mapView.set3D(map.getPitch() < 20));
  $('terrain').addEventListener('change', (e) => { state.terrain = e.target.checked; mapView.setTerrain(state.terrain); });

  const bindSel = (id, key, after) => {
    const el = $(id);
    el.value = state[key];
    el.addEventListener('change', () => { state[key] = el.value; savePrefs(); after?.(); });
  };
  const bindChk = (id, key, after) => {
    const el = $(id);
    el.checked = state[key];
    el.addEventListener('change', () => { state[key] = el.checked; savePrefs(); after?.(); });
  };
  bindSel('quality', 'quality');
  bindSel('anim-speed', 'speed');
  bindChk('tint-damage', 'tint', () => emit('tint-changed', state.tint));
  bindChk('cinematic', 'cinematic');
  bindChk('sound', 'sound', () => emit('sound-changed', state.sound));
  bindChk('reduce-flash', 'reduceFlash');

  /* ---------------- comparação ---------------- */
  const cw = $('compare-weapon');
  const fillCompare = () => {
    cw.innerHTML = '';
    const g1 = document.createElement('optgroup');
    g1.label = 'Arsenal histórico';
    HISTORIC_WEAPONS.forEach((w) => g1.appendChild(new Option(`${w.name} — ${fmtYield(w.yieldKt)}`, w.id)));
    cw.appendChild(g1);
    const mine = loadArsenal();
    if (mine.length) {
      const g2 = document.createElement('optgroup');
      g2.label = 'Meu Arsenal';
      mine.forEach((w) => g2.appendChild(new Option(`${w.name} — ${fmtYield(w.yieldKt)}`, w.id)));
      cw.appendChild(g2);
    }
    cw.value = state.compare.weaponId;
  };
  fillCompare();
  on('arsenal-changed', fillCompare);
  cw.addEventListener('change', () => { state.compare.weaponId = cw.value; app.updateCompare(); });
  $('compare-on').addEventListener('change', (e) => { state.compare.on = e.target.checked; app.updateCompare(); });
  const setLayout = (l) => {
    state.compare.layout = l;
    $('compare-same').classList.toggle('active', l === 'same');
    $('compare-side').classList.toggle('active', l === 'side');
    app.updateCompare();
  };
  $('compare-same').addEventListener('click', () => setLayout('same'));
  $('compare-side').addEventListener('click', () => setLayout('side'));

  /* ---------------- densidade ---------------- */
  const dens = $('density');
  dens.add(new Option('Automático (prédios carregados)', 'auto'));
  Object.entries(CONFIG.casualties.densityProfiles).forEach(([k, p]) => dens.add(new Option(`${p.label} — ${fmtInt(p.D0)} hab/km² no centro`, k)));
  dens.value = state.density;
  dens.addEventListener('change', () => { state.density = dens.value; emit('density-changed'); });

  /* ---------------- ações ---------------- */
  const detonate = () => {
    document.querySelectorAll('.panel.open').forEach((p) => p.classList.remove('open'));
    app.detonate();
  };
  $('btn-detonate').addEventListener('click', detonate);
  $('btn-detonate-m').addEventListener('click', detonate);
  $('btn-clear').addEventListener('click', () => app.clear());

  /* ---------------- painéis ---------------- */
  document.querySelectorAll('.panel-toggle').forEach((b) => b.addEventListener('click', () => {
    const p = $(b.dataset.panel);
    if (matchMedia('(max-width: 900px)').matches) p.classList.remove('open');
    else p.classList.toggle('collapsed');
  }));
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const p = $(b.dataset.open);
    const wasOpen = p.classList.contains('open');
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('open'));
    if (!wasOpen) p.classList.add('open');
  }));

  // exposto para outras telas (ex.: "Potência livre" no menu inicial)
  return {
    focusYield() {
      showView('sim');
      const sec = $('sec-yield');
      sec.open = true;
      if (matchMedia('(max-width: 900px)').matches) $('panel-controls').classList.add('open');
      else $('panel-controls').classList.remove('collapsed');
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('yield-slider').focus(), 400);
    },
    simParams,
  };
}
