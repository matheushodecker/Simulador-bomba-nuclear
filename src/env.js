/**
 * Edição "artefato" (VITE_OFFLINE=1): roda dentro da página isolada do claude.ai,
 * onde qualquer servidor externo é bloqueado. Usa a cidade-modelo procedural no
 * lugar de mapas, OSM, busca, vento e Google 3D Tiles.
 */
export const OFFLINE = import.meta.env?.VITE_OFFLINE === '1';
