/**
 * Desafios de escala — aprenda, na prática, que R ∝ W^(1/3):
 * para dobrar o raio de um efeito de choque é preciso 8× mais potência.
 * Monte uma arma na Oficina com o MENOR custo que satisfaça a meta.
 */
import { computeEffects } from '../physics/effects.js';
import { evaluateBuild, enumerateBuilds } from './workshop-model.js';
import { load, save } from '../util/storage.js';

export const CHALLENGES = [
  {
    id: 'c1', title: 'Cinco psi a 2 km', budget: 120,
    goal: 'Faça o anel de 5 psi (explosão em altura ótima) alcançar pelo menos 2 km de raio.',
    lesson: 'Raio de choque cresce com a raiz cúbica da potência: 2 km exigem ~54 kt, enquanto 1 km exigiria só ~7 kt.',
    test: (fx) => fx.radius.blast5 >= 2, metric: (fx) => fx.radius.blast5, unit: 'km',
    burst: { mode: 'optimum' },
  },
  {
    id: 'c2', title: 'Calor a 5 km', budget: 140,
    goal: 'Leve as queimaduras de 3º grau (altura ótima) até 5 km do ponto zero.',
    lesson: 'O pulso térmico escala ~W^0,41 — mais rápido que a onda de choque. Por isso, em armas grandes, o fogo alcança mais longe que a destruição por pressão.',
    test: (fx) => fx.radius.thermal3 >= 5, metric: (fx) => fx.radius.thermal3, unit: 'km',
    burst: { mode: 'optimum' },
  },
  {
    id: 'c3', title: 'Precisão de engenharia', budget: 150,
    goal: 'Deixe o anel de 20 psi (altura ótima) entre 0,9 e 1,1 km — nem mais, nem menos.',
    lesson: 'Uma janela de ±10% no raio corresponde a uma janela de quase ±30% na potência (porque 1,1³ ≈ 1,33).',
    test: (fx) => fx.radius.blast20 >= 0.9 && fx.radius.blast20 <= 1.1, metric: (fx) => fx.radius.blast20, unit: 'km',
    burst: { mode: 'optimum' },
  },
  {
    id: 'c4', title: 'Pluma longa', budget: 150,
    goal: 'Explosão no solo com vento de 24 km/h: a faixa de 10 rad/h (H+1) deve chegar a 50 km a favor do vento.',
    lesson: 'O fallout depende da potência de FISSÃO. Uma arma termonuclear "mais limpa" precisa de mais potência total para a mesma pluma.',
    test: (fx) => (fx.fallout.contours.find((c) => c.level === 10)?.L || 0) >= 50,
    metric: (fx) => fx.fallout.contours.find((c) => c.level === 10)?.L || 0, unit: 'km',
    burst: { mode: 'surface' },
  },
  {
    id: 'c5', title: 'Megaton econômico', budget: 95,
    goal: 'Alcance 1 Mt (1.000 kt) gastando no máximo 95 créditos.',
    lesson: 'Equilibrar módulos importa: peso acima da capacidade derruba a potência.',
    test: (fx) => fx.yieldKt >= 1000, metric: (fx) => fx.yieldKt / 1000, unit: 'Mt',
    burst: { mode: 'optimum' },
  },
  {
    id: 'c6', title: 'Mil quilômetros quadrados', budget: 200,
    goal: 'Cubra 1.000 km² com sobrepressão de pelo menos 1 psi (altura ótima).',
    lesson: 'Área cresce com W^(2/3): para dobrar a área afetada é preciso ~2,8× a potência.',
    test: (fx) => fx.rings.find((r) => r.key === 'blast1')?.areaKm2 >= 1000,
    metric: (fx) => fx.rings.find((r) => r.key === 'blast1')?.areaKm2 || 0, unit: 'km²',
    burst: { mode: 'optimum' },
  },
];

export function challengeEffects(ch, ev) {
  return computeEffects({
    yieldKt: ev.yieldKt,
    burst: ch.burst,
    fissionFraction: ev.fissionFraction,
    wind: { speedKmh: 24, fromDeg: 270 },
  });
}

/** Custo mínimo possível (par) para cada desafio, por força bruta (~2 mil montagens). */
const parCache = new Map();
export function challengePar(ch) {
  if (parCache.has(ch.id)) return parCache.get(ch.id);
  let best = null;
  for (const b of enumerateBuilds()) {
    const ev = evaluateBuild(b, ch.budget);
    if (!ev.valid) continue;
    if (best && ev.cost >= best.cost) continue;
    if (ch.test(challengeEffects(ch, ev))) best = { cost: ev.cost, build: b };
  }
  parCache.set(ch.id, best);
  return best;
}

export function evaluateChallenge(ch, build) {
  const ev = evaluateBuild(build, ch.budget);
  const fx = challengeEffects(ch, ev);
  const ok = ev.valid && ch.test(fx);
  const par = challengePar(ch);
  let stars = 0;
  if (ok) stars = !par ? 3 : ev.cost <= par.cost ? 3 : ev.cost <= par.cost * 1.25 ? 2 : 1;
  return { ok, ev, fx, value: ch.metric(fx), par, stars };
}

export function getChallengeScores() {
  return load('challenges', {});
}

export function recordChallenge(id, result) {
  const scores = getChallengeScores();
  const prev = scores[id];
  if (!prev || result.ev.cost < prev.cost) {
    scores[id] = { cost: result.ev.cost, stars: result.stars, date: Date.now() };
    save('challenges', scores);
    return true;
  }
  return false;
}
