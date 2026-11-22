/**
 * Gera as partículas de poeira, incêndios e fumaça para uma detonação.
 * Tudo em coordenadas locais (m) e tempo visual (s).
 */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Muro de poeira levantado pela onda de choque + nuvens de colapso dos prédios. */
export function buildDust(field, { fx, gz, accel, buildings, count }) {
  field.clear();
  const rand = rng(4242);
  const W = fx.yieldKt;
  const scale = Math.min(7, Math.max(0.5, Math.cbrt(W) / 2));
  const rfb = fx.radius.fireball;
  const rMax = Math.max(fx.radius.blast3 * 1.15, rfb * 3);
  const nWall = Math.round(count * (buildings.length ? 0.55 : 0.9));
  for (let i = 0; i < nWall; i++) {
    const r = rfb + (rMax - rfb) * Math.sqrt(rand());
    const th = rand() * Math.PI * 2;
    const psi = fx.psiAt(r);
    const st = Math.min(1, Math.max(0.15, Math.log10(psi + 1) / 1.3));
    const ux = Math.cos(th); const uy = Math.sin(th);
    const g = 0.55 + 0.15 * rand();
    field.push({
      pos: [gz[0] + ux * r * 1000, gz[1] + uy * r * 1000, 5 + rand() * 15 * scale],
      vel: [ux * 22 * st * scale, uy * 22 * st * scale, (4 + rand() * 12) * st * scale],
      start: fx.arrivalAt(r) / accel + rand() * 0.15,
      life: 8 + rand() * 10,
      s0: 25 * scale,
      s1: (70 + rand() * 140) * scale * (0.5 + st),
      seed: rand(), kind: 1, loop: false,
      alpha: 0.38 * st,
      color: [g + 0.06, g + 0.02, g - 0.05],
    });
  }
  const damaged = buildings.filter((b) => b.level >= 3);
  const nB = count - nWall;
  const per = damaged.length ? Math.max(1, Math.min(3, Math.floor(nB / damaged.length))) : 0;
  const stride = damaged.length > nB ? damaged.length / nB : 1;
  for (let j = 0; j < damaged.length && per; j += stride) {
    const b = damaged[Math.floor(j)];
    const H = b.top - b.base;
    const s = Math.sqrt(b.area);
    for (let q = 0; q < per; q++) {
      const g = 0.62 + 0.12 * rand();
      field.push({
        pos: [b.c[0] + (rand() - 0.5) * s, b.c[1] + (rand() - 0.5) * s, b.base + H * (0.2 + 0.4 * rand())],
        vel: [(b.c[0] - gz[0]) * 0.002 * rand(), (b.c[1] - gz[1]) * 0.002 * rand(), 3 + rand() * 7],
        start: b.arrival + 0.25 + rand() * 0.6,
        life: 10 + rand() * 14,
        s0: s * 0.6 + 6,
        s1: s * 2.2 + H * 0.7 + 30,
        seed: rand(), kind: 1, loop: false,
        alpha: 0.5,
        color: [g + 0.05, g + 0.03, g - 0.02],
      });
    }
  }
  field.build();
  return field.items.length;
}

/** Incêndios (chamas aditivas) e colunas de fumaça na zona térmica. */
export function buildFires(fire, smoke, { fx, gz, buildings, count }) {
  fire.clear();
  smoke.clear();
  const rand = rng(777);
  const sites = [];
  if (buildings.length) {
    for (const b of buildings) {
      const p = b.burn >= 3 ? 0.55 : b.burn === 2 ? 0.22 : 0;
      const pl = b.level >= 4 ? 0.35 : 0;
      if (rand() < Math.max(p, pl)) sites.push({ x: b.c[0], y: b.c[1], z: b.level >= 4 ? b.base + 2 : b.base + (b.top - b.base) * rand(), s: Math.sqrt(b.area), top: b.level >= 4 ? b.base + 6 : b.top });
    }
  }
  // sem prédios carregados: focos genéricos espalhados na zona de 3º grau
  if (sites.length < 40) {
    const R = fx.radius.thermal3 * 1000;
    const n = Math.min(300, Math.round(count / 4));
    for (let i = 0; i < n; i++) {
      const r = R * Math.sqrt(rand());
      const th = rand() * Math.PI * 2;
      sites.push({ x: gz[0] + r * Math.cos(th), y: gz[1] + r * Math.sin(th), z: 2, s: 18 + rand() * 30, top: 8 });
    }
  }
  const maxSites = Math.max(10, Math.floor(count / 4));
  const stride = sites.length > maxSites ? sites.length / maxSites : 1;
  for (let j = 0; j < sites.length; j += stride) {
    const s = sites[Math.floor(j)];
    const start = 0.4 + rand() * 4;
    const fs = Math.min(18, 3 + s.s * 0.25);
    for (let q = 0; q < 3; q++) {
      fire.push({
        pos: [s.x + (rand() - 0.5) * s.s * 0.6, s.y + (rand() - 0.5) * s.s * 0.6, s.z],
        vel: [0, 0, 3 + rand() * 4],
        start: start + rand() * 0.6,
        life: 0.7 + rand() * 0.8,
        s0: fs * 0.8, s1: fs * 0.25,
        seed: rand(), kind: 3, loop: true, alpha: 0.85,
        color: [1, 0.5, 0.1],
      });
    }
    const gr = 0.46 + rand() * 0.12;
    smoke.push({
      pos: [s.x, s.y, s.top],
      vel: [0, 0, 9 + rand() * 7],
      start: start + 0.8,
      life: 14 + rand() * 10,
      s0: fs * 1.5, s1: 60 + s.s * 2 + rand() * 60,
      seed: rand(), kind: 2, loop: true, alpha: 0.3,
      color: [gr, gr * 0.95, gr * 0.9],
    });
  }
  fire.build();
  smoke.build();
  return sites.length;
}
