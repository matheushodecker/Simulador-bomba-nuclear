/**
 * Mapa MapLibre GL: estilos públicos, relevo 3D, céu/atmosfera e controles.
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAPS, TERRAIN_SOURCE } from './basemaps.js';
import { emit } from '../util/events.js';

const SKY = {
  'sky-color': '#6a9be0',
  'horizon-color': '#d6e6f5',
  'fog-color': '#e8eef4',
  'sky-horizon-blend': 0.55,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.75,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
};

export class MapView {
  constructor(container, { center, zoom, basemap = 'liberty' }) {
    this.basemap = BASEMAPS[basemap] ? basemap : 'liberty';
    this.terrainOn = false;
    this.hideBuildings = false;
    this.styleLoadedOnce = false;
    this._styleLoaded = false;

    this.map = new maplibregl.Map({
      container,
      style: BASEMAPS[this.basemap].style,
      center,
      zoom,
      pitch: 0,
      maxPitch: 85,
      antialias: true,
      attributionControl: { compact: true },
      fadeDuration: 150,
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    this.map.on('style.load', () => this._afterStyle());
    this.map.on('error', (e) => this._onError(e));
    this._armFallbackTimer();
  }

  _armFallbackTimer() {
    clearTimeout(this._fallbackTimer);
    this._styleLoaded = false;
    this._fallbackTimer = setTimeout(() => {
      if (!this._styleLoaded && BASEMAPS[this.basemap].vector) this._fallback('tempo esgotado');
    }, 15000);
  }

  _onError(e) {
    const msg = String(e?.error?.message || e?.error || '');
    // falha ao baixar o estilo vetorial → usa o raster do OSM
    if (!this._styleLoaded && BASEMAPS[this.basemap].vector) {
      this._fallback(msg);
      return;
    }
    if (/terrarium|elevation-tiles/.test(msg) && this.terrainOn) {
      emit('toast', { type: 'warn', text: 'Não foi possível baixar os dados de relevo.' });
    }
  }

  _fallback(reason) {
    console.warn('[mapa] estilo indisponível, usando OSM raster:', reason);
    emit('toast', { type: 'warn', text: 'Estilo vetorial indisponível — usando OpenStreetMap padrão.' });
    this.setBasemap('osm');
    emit('basemap-changed', 'osm');
  }

  _afterStyle() {
    this._styleLoaded = true;
    this.styleLoadedOnce = true;
    clearTimeout(this._fallbackTimer);
    try { this.map.setSky(SKY); } catch { /* versões sem céu */ }
    if (this.terrainOn) this._enableTerrain();
    this.setHideStyleBuildings(this.hideBuildings);
    emit('style-ready', this.map);
  }

  setBasemap(key) {
    if (!BASEMAPS[key]) return;
    this.basemap = key;
    this._armFallbackTimer();
    this.map.setStyle(BASEMAPS[key].style, { diff: false });
  }

  /** Oculta os prédios 3D do próprio estilo quando os prédios destrutíveis estão carregados. */
  setHideStyleBuildings(hide) {
    this.hideBuildings = hide;
    const style = this.map.getStyle();
    if (!style) return;
    for (const l of style.layers) {
      if (l['source-layer'] === 'building' && (l.type === 'fill-extrusion' || l.type === 'fill')) {
        const vis = hide && l.type === 'fill-extrusion' ? 'none' : 'visible';
        try { this.map.setLayoutProperty(l.id, 'visibility', vis); } catch { /* ignore */ }
      }
    }
  }

  _enableTerrain() {
    const m = this.map;
    if (!m.getSource('terrain-dem')) m.addSource('terrain-dem', TERRAIN_SOURCE);
    if (!m.getSource('hillshade-dem')) m.addSource('hillshade-dem', TERRAIN_SOURCE);
    if (!m.getLayer('hillshade')) {
      const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol');
      m.addLayer({
        id: 'hillshade', type: 'hillshade', source: 'hillshade-dem',
        paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3d3d3d' },
      }, firstSymbol?.id);
    }
    m.setTerrain({ source: 'terrain-dem', exaggeration: 1.0 });
  }

  setTerrain(on) {
    this.terrainOn = on;
    if (!this.map.isStyleLoaded() && !this._styleLoaded) return;
    if (on) this._enableTerrain();
    else {
      this.map.setTerrain(null);
      if (this.map.getLayer('hillshade')) this.map.removeLayer('hillshade');
    }
    emit('terrain-changed', on);
  }

  set3D(on) {
    this.map.easeTo({ pitch: on ? 60 : 0, bearing: on ? this.map.getBearing() || -20 : 0, duration: 900 });
  }
}
