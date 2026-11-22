/**
 * Textura 3D de ruído "Perlin-Worley" (técnica usada em nuvens volumétricas de
 * jogos, ex.: Schneider/Guerrilla 2015). Gerada uma vez na CPU, repetível (tileable).
 *   canal R = forma (Perlin-Worley, baixa frequência)
 *   canal G = detalhe (Worley fbm, alta frequência)
 */
import * as THREE from 'three';

let cached = null;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function makeWorley(cells, seed) {
  const r = rng(seed);
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = r();
  return (x, y, z) => {
    const fx = x * cells; const fy = y * cells; const fz = z * cells;
    const ix = Math.floor(fx); const iy = Math.floor(fy); const iz = Math.floor(fz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx; const cy = iy + dy; const cz = iz + dz;
      const wx = ((cx % cells) + cells) % cells; const wy = ((cy % cells) + cells) % cells; const wz = ((cz % cells) + cells) % cells;
      const k = ((wz * cells + wy) * cells + wx) * 3;
      const px = cx + pts[k] - fx; const py = cy + pts[k + 1] - fy; const pz = cz + pts[k + 2] - fz;
      const d = px * px + py * py + pz * pz;
      if (d < best) best = d;
    }
    return Math.min(1, Math.sqrt(best));
  };
}

function makeValueNoise(period, seed) {
  const r = rng(seed);
  const g = new Float32Array(period * period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x, y, z) => g[((((z % period) + period) % period) * period + (((y % period) + period) % period)) * period + (((x % period) + period) % period)];
  const s = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, z) => {
    const fx = x * period; const fy = y * period; const fz = z * period;
    const ix = Math.floor(fx); const iy = Math.floor(fy); const iz = Math.floor(fz);
    const tx = s(fx - ix); const ty = s(fy - iy); const tz = s(fz - iz);
    const l = (a, b, t) => a + (b - a) * t;
    const c00 = l(at(ix, iy, iz), at(ix + 1, iy, iz), tx);
    const c10 = l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx);
    const c01 = l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx);
    const c11 = l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx);
    return l(l(c00, c10, ty), l(c01, c11, ty), tz);
  };
}

export function cloudNoiseTexture(size = 64) {
  if (cached) return cached;
  const data = new Uint8Array(size * size * size * 2);
  const v4 = makeValueNoise(4, 11); const v8 = makeValueNoise(8, 12); const v16 = makeValueNoise(16, 13); const v32 = makeValueNoise(32, 14);
  const w4 = makeWorley(4, 21); const w8 = makeWorley(8, 22); const w16 = makeWorley(16, 23);
  const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
  let k = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size; const v = y / size; const w = z / size;
    const perlin = (0.5 * v4(u, v, w) + 0.25 * v8(u, v, w) + 0.15 * v16(u, v, w) + 0.1 * v32(u, v, w));
    const W4 = 1 - w4(u, v, w); const W8 = 1 - w8(u, v, w); const W16 = 1 - w16(u, v, w);
    const wf = W4 * 0.625 + W8 * 0.25 + W16 * 0.125;
    const pw = Math.min(1, Math.max(0, remap(perlin, wf - 1, 1, 0, 1)));
    const detail = W8 * 0.5 + W16 * 0.35 + (1 - w16((u * 2) % 1, (v * 2) % 1, (w * 2) % 1)) * 0.15;
    data[k++] = Math.round(pw * 255);
    data[k++] = Math.round(detail * 255);
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
