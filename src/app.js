/**
 * Controlador da aplicação: ações de alto nível chamadas pela interface
 * (escolher alvo, carregar prédios, detonar, limpar, comparar, inspecionar).
 */
import maplibregl from 'maplibre-gl';
import { state, simParams } from './state.js';
import { CONFIG } from './config.js';
import { emit, on } from './util/events.js';
import { computeEffects } from './physics/effects.js';
import { haversineKm, destination } from './map/geo.js';
import { fetchBuildings, parseBuildings } from './services/overpass.js';
import { countryAt } from './services/nominatim.js';
import { unlock } from './game/achievements.js';
import { HISTORIC_WEAPONS } from './data/weapons.js';
import { loadArsenal } from './game/arsenal.js';
import { fmtDist, fmtSig, fmtTime, fmtInt, escapeHtml, fmtYield } from './util/format.js';
import { damageInfo } from './physics/blast.js';

export function createApp({ mapView, layers, scene, city, sim }) {
  const map = mapView.map;
  let loadCtrl = null;
  let orbitRaf = 0;

  // marcador do ponto zero (arrastável)
  const gzEl = document.createElement('div');
  gzEl.className = 'gz-marker';
  gzEl.innerHTML = '<span class="pulse"></span>';
  gzEl.title = 'Ponto de detonação (arraste para mover)';
  const gzMarker = new maplibregl.Marker({ element: gzEl, draggable: true }).setLngLat(state.gz).addTo(map);
  gzMarker.on('dragend', () => app.setGZ(gzMarker.getLngLat()));

  const bEl = document.createElement('div');
  bEl.className = 'gz-marker b';
  const bMarker = new maplibregl.Marker({ element: bEl });

  const app = {
    setGZ(ll, { fly = false, zoom } = {}) {
      state.gz = { lng: ll.lng, lat: ll.lat };
      gzMarker.setLngLat(state.gz);
      if (fly) map.flyTo({ center: state.gz, zoom: zoom ?? Math.max(map.getZoom(), 13.5), essential: true });
      emit('gz-changed', state.gz);
      app.updateCompare();
    },

    setClickMode(mode) {
      state.clickMode = mode;
      emit('click-mode', mode);
    },

    /** Carrega prédios reais do OSM ao redor de `center`. */
    async loadBuildings(center = state.gz, radiusM = state.buildings.radiusM) {
      if (loadCtrl) loadCtrl.abort();
      const ctrl = new AbortController();
      loadCtrl = ctrl;
      state.buildings.loading = true;
      emit('buildings-status', { text: 'Carregando prédios do OpenStreetMap…', kind: 'busy' });
      try {
        const json = await fetchBuildings(center.lat, center.lng, radiusM, {
          signal: ctrl.signal,
          onStatus: (text) => emit('buildings-status', { text, kind: 'busy' }),
        });
        if (ctrl.signal.aborted) return;
        let list = parseBuildings(json);
        const max = CONFIG.buildings.maxCount[state.quality] || 20000;
        const truncated = list.length > max;
        if (truncated) {
          const d = (b) => {
            const [lng, lat] = b.outer[0];
            return (lng - center.lng) ** 2 * Math.cos((lat * Math.PI) / 180) ** 2 + (lat - center.lat) ** 2;
          };
          list = list.map((b) => [d(b), b]).sort((a, b) => a[0] - b[0]).slice(0, max).map((x) => x[1]);
        }
        scene.setOrigin(center);
        const n = city.setBuildings(list);
        if (state.terrain) setTimeout(() => city.applyTerrain(true), 300);
        mapView.setHideStyleBuildings(n > 0);
        state.buildings.center = { ...center };
        state.buildings.count = n;
        state.buildings.loadedRadiusM = radiusM;
        emit('buildings-status', {
          text: n
            ? `✔ ${fmtInt(n)} prédios reais carregados (raio ${fmtDist(radiusM / 1000)})${truncated ? ` — limitado pela qualidade "${state.quality}"` : ''}.`
            : 'Nenhum prédio mapeado nesta área do OpenStreetMap.',
          kind: n ? 'ok' : 'warn',
        });
        if (n) unlock('cidade3d');
        sim.onBuildingsLoaded();
        map.triggerRepaint();
      } catch (e) {
        if (ctrl.signal.aborted) return;
        console.warn('[prédios]', e);
        emit('buildings-status', { text: 'Falha ao consultar a Overpass API (servidor ocupado ou sem conexão). Tente de novo em instantes ou reduza o raio.', kind: 'err' });
      } finally {
        if (loadCtrl === ctrl) {
          state.buildings.loading = false;
          loadCtrl = null;
        }
      }
    },

    clearBuildings() {
      city.dispose();
      mapView.setHideStyleBuildings(false);
      state.buildings.center = null;
      state.buildings.count = 0;
      emit('buildings-status', { text: '', kind: '' });
    },

    /** Enquadra a cena antes da detonação. */
    async cinematic(fx) {
      const loaded = state.buildings.center && haversineKm(state.buildings.center, state.gz) < 1;
      let R = Math.max(fx.radius.blast3 * 1.6, 1.0);
      if (loaded || state.buildings.auto) R = Math.min(R, Math.max(1.2, (state.buildings.radiusM / 1000) * 1.5));
      R = Math.min(R, 80);
      const c = map.getContainer();
      const px = 0.42 * Math.min(c.clientWidth, c.clientHeight);
      const zoom = Math.log2((78271.517 * Math.cos((state.gz.lat * Math.PI) / 180) * px) / (R * 1000));
      const bearing = Math.abs(map.getBearing()) < 1 ? -25 : map.getBearing();
      map.easeTo({ center: state.gz, zoom: Math.min(17, Math.max(3, zoom)), pitch: 58, bearing, duration: 1300, essential: true });
      await new Promise((r) => {
        const t = setTimeout(r, 1500);
        map.once('moveend', () => { clearTimeout(t); r(); });
      });
    },

    /** Depois que a onda passa, afasta a câmera para enquadrar a nuvem em cogumelo. */
    pullBackForCloud(fx, delayMs) {
      clearTimeout(app._pullTimer);
      app._pullTimer = setTimeout(() => {
        if (sim.fx !== fx || app._userMoved) return;
        const R = Math.min(150, fx.cloud.topKm * 1.5);
        const c = map.getContainer();
        const px = 0.42 * Math.min(c.clientWidth, c.clientHeight);
        const zoom = Math.log2((78271.517 * Math.cos((state.gz.lat * Math.PI) / 180) * px) / (R * 1000));
        // câmera abaixo do topo da nuvem esconderia o "chapéu": inclinação moderada
        if (zoom < map.getZoom()) map.easeTo({ center: state.gz, zoom, pitch: 60, duration: 5000, essential: true });
      }, delayMs);
    },

    startOrbit() {
      cancelAnimationFrame(orbitRaf);
      app._userMoved = false;
      const stop = () => { cancelAnimationFrame(orbitRaf); orbitRaf = 0; app._userMoved = true; };
      ['mousedown', 'touchstart', 'wheel', 'dragstart'].forEach((ev) => map.once(ev, stop));
      const t0 = performance.now();
      const step = () => {
        if (performance.now() - t0 > 30000) return stop();
        map.setBearing(map.getBearing() + 0.05);
        orbitRaf = requestAnimationFrame(step);
      };
      orbitRaf = requestAnimationFrame(step);
    },

    async detonate() {
      if (!state.gz) return emit('toast', { type: 'warn', text: 'Escolha um ponto no mapa primeiro.' });
      const params = simParams();
      const preview = computeEffects(params);
      const needLoad = state.buildings.auto && !state.buildings.loading
        && (!state.buildings.center || haversineKm(state.buildings.center, state.gz) > (state.buildings.radiusM / 1000) * 0.5);
      if (needLoad) app.loadBuildings(state.gz, state.buildings.radiusM);
      sim.stop();
      if (state.cinematic) await app.cinematic(preview);
      const fx = sim.detonate(params, state.gz, {
        speed: state.speed, quality: state.quality, reduceFlash: state.reduceFlash, sound: state.sound,
      });
      state.lastResult = { fx, params, gz: { ...state.gz }, weapon: { ...state.weapon } };
      unlock('primeira');
      if (fx.yieldKt >= 1000) unlock('megaton');
      if (fx.yieldKt >= 50000) unlock('czar');
      if (fx.yieldKt <= 0.05) unlock('micro');
      app.updateCompare();
      if (state.cinematic) {
        app.startOrbit();
        app.pullBackForCloud(fx, (fx.arrivalAt(fx.radius.blast3) / sim.accel) * 1000 + 1500);
      }
      if (city.loaded || needLoad) app.setClickMode('inspect');
    },

    clear() {
      cancelAnimationFrame(orbitRaf);
      sim.stop();
      state.lastResult = null;
      layers.setCompare(null);
      bMarker.remove();
      app.setClickMode('target');
      emit('cleared');
    },

    /** Arma B para comparação (histórica ou do Meu Arsenal). */
    compareWeapon() {
      const id = state.compare.weaponId;
      const h = HISTORIC_WEAPONS.find((w) => w.id === id);
      if (h) return { name: h.name, yieldKt: h.yieldKt, fissionFraction: h.fissionFraction ?? CONFIG.fallout.fissionFraction[h.type] };
      const a = loadArsenal().find((w) => w.id === id);
      if (a) return { name: a.name, yieldKt: a.yieldKt, fissionFraction: a.fissionFraction };
      return null;
    },

    updateCompare() {
      const w = app.compareWeapon();
      if (!state.compare.on || !w || !state.gz) {
        layers.setCompare(null);
        bMarker.remove();
        emit('compare', null);
        return;
      }
      const params = simParams();
      const fxA = state.lastResult?.fx || computeEffects(params);
      const fxB = computeEffects({ ...params, yieldKt: w.yieldKt, fissionFraction: w.fissionFraction });
      const center = state.compare.layout === 'same'
        ? state.gz
        : destination(state.gz, 90, (fxA.radius.blast1 + fxB.radius.blast1) * 1.08);
      layers.setCompare(fxB, center, w.name);
      if (state.compare.layout === 'side') bMarker.setLngLat(center).addTo(map); else bMarker.remove();
      emit('compare', { fxA, fxB, nameA: state.weapon.name, nameB: w.name });
      unlock('comparador');
    },

    /** Popup com informações de um prédio sob o cursor. */
    inspectAt(point) {
      if (!city.loaded) {
        emit('toast', { type: 'info', text: 'Carregue os prédios 3D primeiro (painel Alvo → Carregar).' });
        return false;
      }
      const b = city.pick(scene.screenRay(point.x, point.y));
      if (!b) return false;
      const ll = scene.toLngLat(b.c[0], b.c[1]);
      const detonated = Boolean(sim.fx);
      const fx = sim.fx || computeEffects(simParams());
      const gz = detonated ? sim.gz : state.gz;
      const dKm = haversineKm(gz, ll);
      const psi = fx.psiAt(dKm);
      const lvl = fx.damageLevelAt(dKm);
      const di = damageInfo(lvl);
      const burn = fx.burnDegreeAt(dKm);
      const q = fx.thermalFluenceAt(dKm);
      const rem = fx.radiationDoseAt(dKm);
      const src = b.src;
      const title = src.name ? escapeHtml(src.name) : `Edificação (${escapeHtml(src.kind)})`;
      const html = `<div class="inspect">
        <h4>${title}</h4>
        <div class="muted small">${detonated ? `Após ${escapeHtml(fmtYield(fx.yieldKt))}` : 'Prévia — ainda não detonado'}</div>
        <table>
          <tr><td>Altura</td><td class="num">${fmtSig(src.height, 3)} m${src.estimated ? ' <span class="muted">(estimada)</span>' : ''}</td></tr>
          <tr><td>Distância ao ponto zero</td><td class="num">${fmtDist(dKm)}</td></tr>
          <tr><td>Sobrepressão estimada</td><td class="num"><b>${psi > 200 ? '> 200' : fmtSig(psi, 3)} psi</b></td></tr>
          <tr><td>Chegada da onda</td><td class="num">${fmtTime(fx.arrivalAt(dKm))}</td></tr>
          <tr><td>Fluência térmica</td><td class="num">${q > 1000 ? '> 1000' : fmtSig(q, 2)} cal/cm²${burn ? ` (${burn}º grau)` : ''}</td></tr>
          <tr><td>Radiação inicial</td><td class="num">${rem > 1e5 ? '> 100.000' : fmtSig(rem, 2)} rem</td></tr>
        </table>
        <div style="margin-top:8px"><span class="lvl" style="background:${di.color}">${di.label}</span> <span class="small">${di.desc}</span></div>
      </div>`;
      new maplibregl.Popup({ maxWidth: '330px', closeButton: true }).setLngLat(ll).setHTML(html).addTo(map);
      if (detonated) unlock('inspetor');
      return true;
    },
  };

  /** Verifica se o fallout cruza fronteiras (geocodificação reversa ao longo do eixo da pluma). */
  on('sim:fallout-complete', async ({ fx, gz }) => {
    const c1 = fx.fallout.contours.find((c) => c.level === 1);
    if (!c1 || c1.L < 5) return;
    const pts = [gz, ...[0.35, 0.7, 1].map((f) => destination(gz, fx.fallout.downwindBearing, c1.L * f))];
    const found = [];
    for (const p of pts) {
      if (sim.fx !== fx) return;
      const c = await countryAt(p.lat, p.lng);
      if (c && !found.some((x) => x.code === c.code)) found.push(c);
    }
    if (sim.fx !== fx) return;
    emit('fallout-countries', found);
    if (found.length > 1) {
      unlock('fronteira');
      emit('toast', { type: 'warn', text: `O fallout (1 rad/h) atravessa fronteiras: ${found.map((c) => c.name).join(' → ')}` });
    }
  });

  return app;
}
