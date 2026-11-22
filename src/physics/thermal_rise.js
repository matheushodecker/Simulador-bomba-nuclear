/**
 * Subida da nuvem como uma TÉRMICA turbulenta (modelo integral de
 * Morton, Taylor & Turner, 1956), numa atmosfera estratificada:
 *
 *   dz/dt = w
 *   da/dt = α·|w|                  (entranhamento: o raio cresce com a distância percorrida)
 *   d(γ·V·w)/dt = F                (γ = 1 + k, massa virtual; F = V·b é o empuxo total)
 *   dF/dt = −N²(z)·V·w             (a parcela que sobe fica menos quente que o ar em volta)
 *
 * com V = 4/3·π·a³, b = g·θ'/θ₀ e N a frequência de Brunt–Väisälä.
 *
 * O empuxo inicial vem da energia que fica como calor no ar depois do pulso térmico
 * (F₀ = g/θ₀ · E/(ρ·cₚ)). Os dois parâmetros livres — α (entranhamento) e N
 * (estratificação efetiva) — são calibrados para que a térmica pare na altura do
 * topo da nuvem dada pelas escalas públicas, no tempo típico de estabilização
 * (alguns minutos) e sem passar do raio do "chapéu" (o restante do raio vem do
 * espalhamento lateral da nuvem na altura de equilíbrio, que o grid de fluidos simula).
 * Na prática α sai entre ~0,05 e 0,3 (a faixa medida em laboratório para térmicas)
 * e N perto de 0,01 s⁻¹, o valor típico da troposfera — um bom sinal de consistência
 * entre o modelo e as observações.
 *
 * Esse modelo NÃO descreve a arma: só a bolha de ar quente que sobe depois.
 */
const G = 9.81;
const THETA0 = 300;
const RHO_CP = 1.2 * 1005;
const K_VIRTUAL = 0.5;

/** Empuxo total inicial (m⁴/s²) a partir do calor depositado no ar (J). */
export function buoyancyFlux(heatJ) {
  return (G / THETA0) * (heatJ / RHO_CP);
}

/** Γ (K/m) equivalente a uma frequência de Brunt–Väisälä N (1/s). */
export function lapseFromN(N) {
  return (N * N * THETA0) / G;
}

function makeState(z0, a0, F0) {
  return { t: 0, z: z0, a: a0, w: 0, P: 0, F: F0, peaked: false, zMax: z0, tPeak: null };
}

/** Avança o estado `s` por `dt` segundos (subpassos internos para estabilidade). */
function advance(s, dt, alpha, Nfn) {
  let left = dt;
  while (left > 1e-9) {
    const V = (4 / 3) * Math.PI * s.a ** 3;
    const h = Math.min(left, 0.25, (0.05 * s.a) / Math.max(Math.abs(s.w), 1));
    // semi-implícito: momento com o empuxo atual; empuxo com a nova velocidade
    s.P += s.F * h;
    s.w = s.P / ((1 + K_VIRTUAL) * V);
    const N = Nfn(s.z);
    s.F -= N * N * V * s.w * h;
    s.z += s.w * h;
    // o volume cresce (entranhamento); o momento total se conserva nesse instante
    s.a += alpha * Math.abs(s.w) * h;
    s.t += h;
    left -= h;
    if (s.z > s.zMax) s.zMax = s.z;
    if (!s.peaked && s.t > 1 && s.w <= 0) { s.peaked = true; s.tPeak = s.t; }
  }
  return s;
}

/** Altura máxima atingida para um N uniforme (usada na calibração). */
function peakFor(z0, a0, F0, alpha, N) {
  const s = makeState(z0, a0, F0);
  const Nfn = () => N;
  for (let i = 0; i < 20000 && !s.peaked; i++) advance(s, 0.5, alpha, Nfn);
  return s;
}

/**
 * Calibra e devolve um modelo de térmica.
 * @param {object} o
 * @param {number} o.z0 altura inicial do centro (m)
 * @param {number} o.a0 raio inicial (m) — raio máximo da bola de fogo
 * @param {number} o.heatJ calor deixado no ar (J)
 * @param {number} o.zTarget altura final do centro (m)
 * @param {number} o.aTarget raio final (m)
 * @param {number} [o.tTarget] tempo até estabilizar (s)
 */
export function calibrateThermal({ z0, a0, heatJ, zTarget, aTarget, tTarget }) {
  const F0 = buoyancyFlux(heatJ);
  const climb = Math.max(zTarget - z0, a0);
  const alphaMax = Math.min(0.35, Math.max(0.05, (aTarget - a0) / climb));
  // para um α: bissecção em log(N) até a térmica parar na altura-alvo (zMax diminui com N)
  const fitN = (alpha) => {
    let lo = Math.log(1e-4);
    let hi = Math.log(0.2);
    let best = null;
    for (let i = 0; i < 34; i++) {
      const mid = (lo + hi) / 2;
      const s = peakFor(z0, a0, F0, alpha, Math.exp(mid));
      best = { alpha, N: Math.exp(mid), s };
      if (s.zMax > zTarget) lo = mid; else hi = mid;
    }
    return best;
  };
  // α: o maior compatível com o raio do chapéu; se houver um tempo de estabilização-alvo,
  // reduz α até a térmica chegar lá nesse tempo (o resto do raio vem do espalhamento lateral)
  let best = fitN(alphaMax);
  if (tTarget && best.s.tPeak > tTarget) {
    let lo = 0.03;
    let hi = alphaMax;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const b = fitN(mid);
      if (b.s.tPeak > tTarget) hi = mid; else { lo = mid; best = b; }
    }
    if (best.alpha === alphaMax) best = fitN(lo);
  }
  const alpha = best.alpha;
  const N = best.N;
  return {
    alpha, N, F0, z0, a0, zTarget, aTarget,
    tPeak: best.s.tPeak,
    aPeak: best.s.a,
    /** novo estado inicial */
    init: () => makeState(z0, a0, F0),
    /** avança o estado (o mesmo N calibrado; acima do alvo a estratificação fica bem mais forte) */
    step: (s, dt) => advance(s, dt, alpha, (z) => (z < zTarget * 1.08 ? N : N * 3)),
    /** empuxo médio b (m/s²) e excesso de temperatura (K) no estado */
    buoyancy(s) {
      const V = (4 / 3) * Math.PI * s.a ** 3;
      const b = s.F / V;
      return { b, dTheta: (b * THETA0) / G };
    },
  };
}
