import { describe, it, expect } from 'vitest';
import { StructuralDestruction } from '../src/render/structural.js';
import { computeEffects } from '../src/physics/effects.js';

const fx = computeEffects({ yieldKt: 15, burst: { mode: 'custom', heightM: 600 } });

function house({ x = 800, y = 0, w = 10, d = 8, h = 6.4, mat = 'masonry', level = 3, psi = 6 } = {}) {
  const outer = [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
  return { c: [x, y], outer, holes: [], base: 0, top: h, level, psi, dKm: Math.hypot(x, y) / 1000, arrival: 2, mat, burn: 0, src: { color: [0.8, 0.7, 0.6] } };
}

function planOne(b) {
  const s = new StructuralDestruction();
  const r = s.plan({ buildings: [b], fx, accel: 1, gz: [0, 0], focus: b.c, quality: 'media' });
  return { s, r };
}

describe('física estrutural: decomposição', () => {
  it('casa de 2 andares vira paredes por andar + lajes (piso do 2º e cobertura)', () => {
    const { s, r } = planOne(house());
    expect(r.buildings).toBe(1);
    const walls = s.els.filter((e) => e.kind === 0);
    const slabs = s.els.filter((e) => e.kind !== 0);
    expect(new Set(walls.map((e) => e.story))).toEqual(new Set([0, 1]));
    expect(slabs.some((e) => e.kind === 2)).toBe(true); // cobertura
    expect(slabs.some((e) => e.kind === 1)).toBe(true); // laje do 2º andar
  });

  it('paredes não se sobrepõem às lajes (vão do topo da laje à base da de cima)', () => {
    const { s } = planOne(house());
    const B = s.blds[0];
    for (const w of s.els.filter((e) => e.kind === 0)) {
      const top = w.cz + w.hz;
      const slabBottom = B.z0 + (w.story + 1) * B.hE - 0.24;
      expect(top).toBeLessThanOrEqual(slabBottom + 1e-6);
    }
  });

  it('paredes de cima apontam para a de baixo (apoio) e massa usa a densidade do material', () => {
    const { s } = planOne(house());
    const up = s.els.filter((e) => e.kind === 0 && e.story === 1);
    expect(up.every((e) => e.below >= 0 && s.els[e.below].above === s.els.indexOf(e))).toBe(true);
    expect(up[0].rho).toBe(1800);
  });

  it('concreto e aço são pórticos; alvenaria e madeira, paredes portantes', () => {
    expect(planOne(house({ mat: 'concrete' })).s.blds[0].frame).toBe(true);
    expect(planOne(house({ mat: 'steel' })).s.blds[0].frame).toBe(true);
    expect(planOne(house({ mat: 'wood' })).s.blds[0].frame).toBe(false);
  });

  it('prédios sem dano estrutural (nível < 2) ficam fora da física', () => {
    expect(planOne(house({ level: 1 })).r.buildings).toBe(0);
  });

  it('respeita o orçamento de peças (torre grande é simplificada)', () => {
    const { s } = planOne(house({ w: 60, d: 40, h: 90, mat: 'concrete', level: 4 }));
    expect(s.els.length).toBeLessThanOrEqual(300);
    expect(s.els.length).toBeGreaterThan(30);
  });
});

describe('física estrutural: carga da onda', () => {
  it('fachada voltada para a explosão sente a pressão refletida; lateral, a incidente; fundos, menos', () => {
    const { s } = planOne(house());
    const B = s.blds[0];
    const t = B.arrV + 0.01;
    const walls = s.els.filter((e) => e.kind === 0 && e.story === 0);
    const front = walls.find((e) => e.facing > 0.9);
    const side = walls.find((e) => Math.abs(e.facing) < 0.1);
    const back = walls.find((e) => e.facing < -0.9);
    const pf = s._load(front, t); const ps = s._load(side, t); const pb = s._load(back, t);
    expect(pf / ps).toBeCloseTo(B.refl, 1);
    expect(pb).toBeLessThan(ps);
    expect(s._load(front, B.arrV - 0.1)).toBe(0); // antes da chegada
  });

  it('resistência calibrada na pressão incidente: a 12 psi toda parede de alvenaria rompe, em qualquer face', () => {
    const { s } = planOne(house({ psi: 12, level: 5 }));
    const B = s.blds[0];
    const t = B.arrV + 0.001;
    expect(s.els.filter((e) => e.kind === 0).every((e) => s._load(e, t) > e.cap)).toBe(true);
  });

  it('a 1,5 psi, nenhuma parede de alvenaria rompe (só os vidros)', () => {
    const { s } = planOne(house({ psi: 1.5, level: 2 }));
    const B = s.blds[0];
    const t = B.arrV + 0.001;
    expect(s.els.filter((e) => e.kind === 0).every((e) => s._load(e, t) < e.cap)).toBe(true);
  });
});

describe('física estrutural: simulação (Rapier)', () => {
  async function run(b, seconds = 6) {
    const s = new StructuralDestruction();
    s.plan({ buildings: [b], fx, accel: 1, gz: [0, 0], focus: b.c, quality: 'media' });
    const ok = await s.build({ groundZ: 0 });
    expect(ok).toBe(true);
    const B = s.blds[0];
    for (let t = 0; t <= B.arrV + seconds; t += 1 / 60) s.update({ tau: t });
    return { s, B };
  }

  it('8 psi numa casa de alvenaria: a fachada da frente voa para longe da explosão e a casa desaba', async () => {
    const { s, B } = await run(house({ psi: 8, level: 3 }));
    const orig = s.els.slice(0, s._plan.length);
    const front = orig.filter((e) => e.kind === 0 && e.facing > 0.9);
    expect(front.length).toBeGreaterThan(0);
    expect(front.filter((e) => e.state === 1).length / front.length).toBeGreaterThan(0.6);
    // deslocou na direção radial (para longe do ponto zero, +x aqui), mais que a parede dos fundos
    const back = orig.filter((e) => e.kind === 0 && e.facing < -0.9 && e.state === 1);
    const dxF = Math.max(...front.filter((e) => e.state === 1).map((e) => e.body.translation().x - e.cx));
    expect(dxF).toBeGreaterThan(2);
    if (back.length) expect(dxF).toBeGreaterThan(Math.max(...back.map((e) => e.body.translation().x - e.cx)));
    expect(B.collapseFrom).toBeLessThan(Infinity);
    // tudo acaba no chão (nada flutua)
    for (const e of s.els) if (e.state === 1) expect(e.body.translation().z).toBeGreaterThan(-1);
    const down = orig.filter((e) => e.state === 1).length / orig.length;
    console.log(`casa 8 psi: ${(down * 100).toFixed(0)}% das peças caíram, ${s.stats.fragments} fragmentos`);
    expect(down).toBeGreaterThan(0.6);
  }, 30000);

  it('3,5 psi (abaixo do limiar de colapso da alvenaria): a casa fica de pé, no máximo perde painéis', async () => {
    const { s, B } = await run(house({ psi: 3.5, level: 2 }), 3);
    const orig = s.els.slice(0, s._plan.length);
    expect(B.collapseFrom).toBe(Infinity);
    expect(orig.filter((e) => e.state === 1).length / orig.length).toBeLessThan(0.3);
  }, 30000);

  it('2 psi: a estrutura de alvenaria fica de pé', async () => {
    const { s } = await run(house({ psi: 2, level: 2 }), 3);
    expect(s.stats.released).toBe(0);
  }, 30000);

  it('concreto armado a 10 psi perde fachada mas o esqueleto (lajes) fica', async () => {
    const { s } = await run(house({ psi: 10, mat: 'concrete', level: 4, w: 20, d: 16, h: 16 }), 4);
    const slabs = s.els.slice(0, s._plan.length).filter((e) => e.kind !== 0);
    const fallen = slabs.filter((e) => e.state === 1).length;
    expect(fallen / slabs.length).toBeLessThan(0.5);
  }, 30000);
});
