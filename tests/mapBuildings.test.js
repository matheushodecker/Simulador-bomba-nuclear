import { describe, it, expect } from 'vitest';
import { tilesForCircle } from '../src/services/mapBuildings.js';

describe('prédios interceptados do mapa (blocos z14)', () => {
  it('cobre o círculo com os blocos certos', () => {
    // São Paulo, Sé: bloco z14 (6069, 9295) — o mesmo baixado e conferido na OpenFreeMap
    const t = tilesForCircle(-23.5505, -46.6333, 50);
    expect(t).toEqual([{ x: 6069, y: 9295 }]);
  });
  it('raio maior → mais blocos, em grade quadrada', () => {
    const a = tilesForCircle(-23.5505, -46.6333, 500).length;
    const b = tilesForCircle(-23.5505, -46.6333, 4000).length;
    expect(b).toBeGreaterThan(a);
    expect(Number.isInteger(Math.sqrt(b))).toBe(true);
  });
});
