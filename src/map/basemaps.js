/**
 * Mapas-base públicos.
 *  - OpenFreeMap (https://openfreemap.org): vetorial, gratuito, sem chave, dados OSM.
 *  - Esri World Imagery: imagens de satélite (uso com atribuição).
 *  - OpenStreetMap padrão (raster).
 */
import { OFFLINE } from '../env.js';
import { demoStyle } from '../data/demoCity.js';

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

function rasterStyle(sources, layers) {
  return { version: 8, sources, layers };
}

const ONLINE_BASEMAPS = {
  liberty: {
    label: 'Ruas 3D — OpenFreeMap Liberty',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    vector: true,
  },
  bright: {
    label: 'Ruas — OpenFreeMap Bright',
    style: 'https://tiles.openfreemap.org/styles/bright',
    vector: true,
  },
  dark: {
    label: 'Noturno — OpenFreeMap Dark',
    style: 'https://tiles.openfreemap.org/styles/dark',
    vector: true,
  },
  satelite: {
    label: 'Satélite + rótulos — Esri',
    vector: false,
    style: rasterStyle(
      {
        esri: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Imagens © Esri, Maxar, Earthstar Geographics e comunidade GIS',
        },
        esriRoads: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
        },
        esriLabels: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        },
      },
      [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b0f14' } },
        { id: 'esri', type: 'raster', source: 'esri' },
        { id: 'esri-roads', type: 'raster', source: 'esriRoads', paint: { 'raster-opacity': 0.75 } },
        { id: 'esri-labels', type: 'raster', source: 'esriLabels' },
      ],
    ),
  },
  osm: {
    label: 'OpenStreetMap padrão',
    vector: false,
    style: rasterStyle(
      {
        osm: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          attribution: OSM_ATTR,
        },
      },
      [
        { id: 'bg', type: 'background', paint: { 'background-color': '#dddddd' } },
        { id: 'osm', type: 'raster', source: 'osm' },
      ],
    ),
  },
};

export const BASEMAPS = OFFLINE
  ? { demo: { label: 'Cidade-modelo (offline)', style: demoStyle(), vector: false } }
  : ONLINE_BASEMAPS;

/** Fonte de relevo pública (AWS Terrain Tiles, codificação Terrarium). */
export const TERRAIN_SOURCE = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
  attribution: 'Relevo: Mapzen/AWS Terrain Tiles',
};
