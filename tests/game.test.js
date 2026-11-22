import { describe, it, expect } from 'vitest';
import { evaluateBuild, enumerateBuilds, CLASSES } from '../src/game/workshop-model.js';
import { CHALLENGES, challengePar } from '../src/game/challenges.js';

describe('Oficina', () => {
  it('potência sempre dentro da faixa da classe', () => {
    for (const b of enumerateBuilds()) {
      const ev = evaluateBuild(b, 1e9);
      const [lo, hi] = ev.cls.range;
      expect(ev.yieldKt).toBeGreaterThanOrEqual(lo * 0.999);
      expect(ev.yieldKt).toBeLessThanOrEqual(hi * 1.001);
    }
  });
  it('cada classe tem pelo menos uma montagem válida no orçamento padrão', () => {
    for (const c of CLASSES) {
      const ok = [...enumerateBuilds()].some((b) => b.classId === c.id && evaluateBuild(b).valid);
      expect(ok).toBe(true);
    }
  });
  it('todos os desafios são solucionáveis dentro do orçamento', () => {
    for (const ch of CHALLENGES) {
      const par = challengePar(ch);
      expect(par, ch.id).not.toBeNull();
      expect(par.cost).toBeLessThanOrEqual(ch.budget);
    }
  });
});
