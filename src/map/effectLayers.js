/**
 * Camadas 2D de efeitos no MapLibre: anéis, fallout, frente de choque,
 * comparação e rótulos (marcadores DOM, independentes de fontes do estilo).
 */
import maplibregl from 'maplibre-gl';
import { circleRing, localToLngLat, destination } from './geo.js';
import { ellipsePoints } from '../physics/fallout.js';
import { FALLOUT_COLORS } from '../config.js';
import { fmtDist } from '../util/format.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

const SHORT = {
  fireball: 'Bola de fogo', blast20: '20 psi', blast10: '10 psi', blast5: '5 psi', blast3: '3 psi', blast1: '1 psi',
  rad500: '500 rem', thermal3: '3º grau', thermal2: '2º grau', thermal1: '1º grau',
};

export class EffectLayers {
  constructor(map) {
    this.map = map;
    this.data = { rings: EMPTY, fallout: EMPTY, shock: EMPTY, compare: EMPTY };
    this.enabled = new Set(['fireball', 'blast20', 'blast10', 'blast5', 'blast3', 'blast1', 'rad500', 'thermal3', 'thermal2', 'thermal1', 'fallout', 'labels']);
    this.revealed = new Set();
    this.labels = [];
    this.compareLabels = [];
    map.on('zoom', () => this._updateLabelVisibility());
  }

  /** (Re)instala fontes e camadas — chamado a cada carregamento de estilo. */
  install() {
    const m = this.map;
    const add = (id) => { if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: this.data[id] }); };
    ['rings', 'fallout', 'shock', 'compare'].forEach(add);
    const layer = (def) => { if (!m.getLayer(def.id)) m.addLayer(def); };
    layer({
      id: 'fx-fallout-fill', type: 'fill', source: 'fallout',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['*', 0.32, ['get', 'alpha']] },
    });
    layer({
      id: 'fx-fallout-line', type: 'line', source: 'fallout',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': ['get', 'alpha'] },
    });
    layer({
      id: 'fx-rings-fill', type: 'fill', source: 'rings',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'key'], 'fireball'], 0.45, 0.1] },
    });
    layer({
      id: 'fx-rings-line', type: 'line', source: 'rings',
      paint: { 'line-color': ['get', 'color'], 'line-width': 2.2, 'line-opacity': 0.95 },
    });
    layer({
      id: 'fx-compare-line', type: 'line', source: 'compare',
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 2] },
    });
    layer({
      id: 'fx-shock-glow', type: 'line', source: 'shock',
      paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-blur': 8, 'line-opacity': ['*', 0.6, ['get', 'alpha']] },
    });
    layer({
      id: 'fx-shock-line', type: 'line', source: 'shock',
      paint: { 'line-color': '#fffbe6', 'line-width': 2.5, 'line-opacity': ['get', 'alpha'] },
    });
    this._applyFilter();
  }

  _set(id, fc) {
    this.data[id] = fc;
    const src = this.map.getSource(id);
    if (src) src.setData(fc);
  }

  _applyFilter() {
    const keys = [...this.enabled].filter((k) => this.revealed.has(k));
    const f = ['in', ['get', 'key'], ['literal', keys]];
    for (const id of ['fx-rings-fill', 'fx-rings-line']) if (this.map.getLayer(id)) this.map.setFilter(id, f);
    const vis = this.enabled.has('fallout') ? 'visible' : 'none';
    for (const id of ['fx-fallout-fill', 'fx-fallout-line']) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis);
    this._updateLabelVisibility();
  }

  setEnabled(key, on) {
    if (on) this.enabled.add(key); else this.enabled.delete(key);
    this._applyFilter();
  }

  /** Desenha todos os anéis; `revealAll` = mostrar já (sem animação). */
  setRings(fx, center, revealAll = false) {
    this.center = center;
    this.fx = fx;
    const rings = [...fx.rings].sort((a, b) => b.radiusKm - a.radiusKm);
    this._set('rings', {
      type: 'FeatureCollection',
      features: rings.map((r) => ({
        type: 'Feature',
        properties: { key: r.key, color: r.color },
        geometry: { type: 'Polygon', coordinates: [circleRing(center, r.radiusKm, 160)] },
      })),
    });
    this.revealed = new Set(revealAll ? fx.rings.map((r) => r.key) : []);
    this._makeLabels(fx, center);
    this._applyFilter();
  }

  reveal(key) {
    if (this.revealed.has(key)) return;
    this.revealed.add(key);
    this._applyFilter();
  }

  revealAll() {
    if (!this.fx) return;
    this.fx.rings.forEach((r) => this.revealed.add(r.key));
    this._applyFilter();
  }

  _clearLabels(list) {
    list.forEach((m) => m.remove());
    list.length = 0;
  }

  _makeLabels(fx, center) {
    this._clearLabels(this.labels);
    const rings = [...fx.rings].sort((a, b) => a.radiusKm - b.radiusKm);
    rings.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'ring-label';
      el.style.setProperty('--c', r.color);
      el.innerHTML = `<b>${SHORT[r.key]}</b> ${fmtDist(r.radiusKm)}`;
      const bearing = 125 + (i % 2 === 0 ? -1 : 1) * 12 * Math.ceil(i / 2);
      const p = destination(center, bearing, r.radiusKm);
      const mk = new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat(p);
      mk._key = r.key;
      mk._radius = r.radiusKm;
      this.labels.push(mk);
    });
    this._updateLabelVisibility();
  }

  _updateLabelVisibility() {
    if (!this.center) return;
    const m = this.map;
    const c = m.project(this.center);
    const showAll = this.enabled.has('labels');
    for (const mk of this.labels) {
      const p = m.project(mk.getLngLat());
      const px = Math.hypot(p.x - c.x, p.y - c.y);
      const show = showAll && this.enabled.has(mk._key) && this.revealed.has(mk._key) && px > 34;
      if (show && !mk._added) { mk.addTo(m); mk._added = true; }
      if (!show && mk._added) { mk.remove(); mk._added = false; }
    }
  }

  /**
   * Fallout: elipses dos contornos. `progress` (0–1) avança a pluma a favor do vento.
   */
  setFallout(fx, center, progress = 1, contours = fx.fallout.contours) {
    if (!contours.length) { this._set('fallout', EMPTY); return; }
    const maxL = Math.max(...contours.map((c) => c.L));
    const xMax = progress >= 1 ? Infinity : maxL * progress;
    const feats = [...contours]
      .sort((a, b) => a.level - b.level) // 1 rad/h (maior) primeiro
      .filter((c) => c.L > 0.01)
      .map((c) => {
        const pts = localToLngLat(center, fx.fallout.downwindBearing, ellipsePoints(c, 120, xMax));
        return {
          type: 'Feature',
          properties: { level: c.level, color: FALLOUT_COLORS[c.level], alpha: Math.min(1, progress * 1.5) },
          geometry: { type: 'Polygon', coordinates: [pts] },
        };
      });
    this._set('fallout', { type: 'FeatureCollection', features: feats });
  }

  setShock(center, radiusKm, alpha) {
    if (!(radiusKm > 0) || alpha <= 0) { this._set('shock', EMPTY); return; }
    this._set('shock', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { alpha }, geometry: { type: 'LineString', coordinates: circleRing(center, radiusKm, 180) } }],
    });
  }

  setCompare(fx, center, name) {
    this._clearLabels(this.compareLabels);
    if (!fx) { this._set('compare', EMPTY); return; }
    const keys = ['fireball', 'blast20', 'blast5', 'blast1', 'thermal3'];
    const rings = fx.rings.filter((r) => keys.includes(r.key));
    this._set('compare', {
      type: 'FeatureCollection',
      features: rings.map((r) => ({
        type: 'Feature', properties: { key: r.key, color: r.color },
        geometry: { type: 'LineString', coordinates: circleRing(center, r.radiusKm, 160) },
      })),
    });
    const outer = rings.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a), rings[0]);
    if (outer) {
      const el = document.createElement('div');
      el.className = 'ring-label compare';
      el.innerHTML = `<b>B</b> ${name}`;
      const mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(destination(center, 0, outer.radiusKm)).addTo(this.map);
      this.compareLabels.push(mk);
    }
  }

  clear() {
    this.fx = null;
    this.center = null;
    this._set('rings', EMPTY);
    this._set('fallout', EMPTY);
    this._set('shock', EMPTY);
    this.setCompare(null);
    this._clearLabels(this.labels);
    this.revealed.clear();
  }
}
