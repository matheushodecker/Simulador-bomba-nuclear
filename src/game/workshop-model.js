/**
 * Oficina — sistema de "crafting" ESTILIZADO e FICTÍCIO.
 * Nenhum módulo corresponde a componentes reais; os atributos são de jogo.
 * O único resultado que vai para o simulador é: potência (kt) + tipo (afeta o fallout).
 */
import { CONFIG } from '../config.js';

export const CLASSES = [
  {
    id: 'fissao', name: 'Fissão', type: 'fissao', range: [1, 50], cost: 10, capacity: 16, color: '#4fc3f7',
    desc: 'Classe de entrada. Libera potências de 1 a 50 kt. Fallout: 100% fissão.',
  },
  {
    id: 'reforcada', name: 'Fissão Reforçada', type: 'reforcada', range: [50, 500], cost: 25, capacity: 20, color: '#ab47bc',
    desc: 'Exige um Amplificador. Libera de 50 a 500 kt.',
  },
  {
    id: 'termo', name: 'Termonuclear', type: 'termonuclear', range: [100, 100000], cost: 45, capacity: 28, color: '#ff7043',
    desc: 'Exige um Estágio Secundário. Libera de 0,1 a 100 Mt. Fallout: ~50% fissão.',
  },
];

export const SLOTS = [
  { id: 'nucleo', name: 'Núcleo', weight: 1.0, required: ['fissao', 'reforcada', 'termo'], allowed: ['fissao', 'reforcada', 'termo'] },
  { id: 'amplificador', name: 'Amplificador', weight: 0.6, required: ['reforcada'], allowed: ['fissao', 'reforcada', 'termo'] },
  { id: 'estagio', name: 'Estágio Secundário', weight: 1.2, required: ['termo'], allowed: ['termo'] },
  { id: 'casco', name: 'Casco', weight: 0.4, required: ['fissao', 'reforcada', 'termo'], allowed: ['fissao', 'reforcada', 'termo'] },
  { id: 'aletas', name: 'Aletas', weight: 0.15, required: [], allowed: ['fissao', 'reforcada', 'termo'] },
];

/** pot = Potência, efi = Eficiência, peso = Peso, custo = créditos (todos atributos de jogo) */
export const MODULES = {
  nucleo: [
    { id: 'mk1', name: 'Núcleo Mk-I', pot: 3, efi: 4, peso: 3, custo: 8, glow: '#4fc3f7', desc: 'Confiável, barato e sem surpresas.' },
    { id: 'aurora', name: 'Núcleo Aurora Mk-II', pot: 5, efi: 6, peso: 4, custo: 16, glow: '#69f0ae', desc: 'Brilho esverdeado e bom equilíbrio.' },
    { id: 'quasar', name: 'Núcleo Quasar X', pot: 7, efi: 6, peso: 6, custo: 26, glow: '#e040fb', desc: 'Pesado, mas potente.' },
    { id: 'singularidade', name: 'Núcleo Singularidade', pot: 10, efi: 8, peso: 7, custo: 40, glow: '#ffd740', desc: 'O topo da linha. Caríssimo.' },
  ],
  amplificador: [
    { id: 'pulsar', name: 'Bobina Pulsar', pot: 3, efi: 5, peso: 2, custo: 8, rings: 1, desc: 'Um anel de bobinas pulsantes.' },
    { id: 'omega', name: 'Amplificador Ômega', pot: 6, efi: 7, peso: 4, custo: 18, rings: 2, desc: 'Clássico da Oficina: eficiente.' },
    { id: 'helix', name: 'Amplificador Helix-9', pot: 9, efi: 6, peso: 6, custo: 30, rings: 3, desc: 'Espirais triplas. Força bruta.' },
  ],
  estagio: [
    { id: 'hydra', name: 'Estágio Hydra', pot: 4, efi: 5, peso: 6, custo: 14, segments: 1, desc: 'Compacto e econômico.' },
    { id: 'titan', name: 'Estágio Secundário Titan', pot: 7, efi: 6, peso: 9, custo: 28, segments: 2, desc: 'O cavalo de batalha.' },
    { id: 'colosso', name: 'Estágio Colosso', pot: 10, efi: 7, peso: 12, custo: 45, segments: 3, desc: 'Gigantesco. Exige casco leve.' },
  ],
  casco: [
    { id: 'fenix', name: 'Casco Fênix (leve)', pot: 0, efi: 3, peso: 2, custo: 4, desc: 'Leve e barato.' },
    { id: 'bastiao', name: 'Casco Bastião', pot: 1, efi: 6, peso: 6, custo: 10, desc: 'Blindado, robusto.' },
    { id: 'nebulosa', name: 'Casco Nebulosa', pot: 2, efi: 9, peso: 4, custo: 20, desc: 'Liga exótica de ficção científica.' },
  ],
  aletas: [
    { id: 'cometa', name: 'Aletas Cometa', pot: 0, efi: 2, peso: 1, custo: 3, fin: 'delta', desc: 'Aletas delta simples.' },
    { id: 'falcao', name: 'Aletas Falcão', pot: 0, efi: 4, peso: 2, custo: 6, fin: 'swept', desc: 'Enflechadas, estilo caça.' },
    { id: 'orion', name: 'Aleta Anelar Órion', pot: 1, efi: 5, peso: 2, custo: 9, fin: 'ring', desc: 'Anel estabilizador futurista.' },
  ],
};

export const PAINTS = [
  { id: 'artico', name: 'Ártico', base: '#e8eef2', accent: '#90a4ae', pattern: 'none' },
  { id: 'grafite', name: 'Grafite', base: '#37474f', accent: '#ffca28', pattern: 'stripes' },
  { id: 'deserto', name: 'Deserto', base: '#c8a97e', accent: '#6d4c41', pattern: 'camo' },
  { id: 'neon', name: 'Neon', base: '#1a1a2e', accent: '#00e5ff', pattern: 'hex' },
  { id: 'carmim', name: 'Carmim', base: '#8e1b1b', accent: '#f5f5f5', pattern: 'stripes' },
  { id: 'oliva', name: 'Oliva', base: '#556b2f', accent: '#d7ccc8', pattern: 'camo' },
  { id: 'dourado', name: 'Dourado', base: '#b8860b', accent: '#fff8e1', pattern: 'none' },
  { id: 'oceano', name: 'Oceano', base: '#0d47a1', accent: '#80deea', pattern: 'hex' },
];

export const EMBLEMS = [
  { id: 'estrela', name: 'Estrela' },
  { id: 'raio', name: 'Raio' },
  { id: 'atomo', name: 'Átomo' },
  { id: 'coroa', name: 'Coroa' },
  { id: 'cometa', name: 'Cometa' },
  { id: 'olho', name: 'Olho' },
  { id: 'escudo', name: 'Escudo' },
  { id: 'chama', name: 'Chama' },
];

export const DEFAULT_BUDGET = 200;

export function getClass(id) {
  return CLASSES.find((c) => c.id === id) || CLASSES[0];
}

export function getModule(slot, id) {
  return (MODULES[slot] || []).find((m) => m.id === id) || null;
}

function slotMax(slotId, key) {
  return Math.max(...MODULES[slotId].map((m) => m[key]));
}

/**
 * Avalia uma montagem.
 * @param {{classId:string, modules:Object<string,string|null>}} build
 */
export function evaluateBuild(build, budget = DEFAULT_BUDGET) {
  const cls = getClass(build.classId);
  const slots = SLOTS.filter((s) => s.allowed.includes(cls.id));
  let potNum = 0;
  let potDen = 0;
  let efiNum = 0;
  let efiDen = 0;
  let weight = 0;
  let cost = cls.cost;
  const missing = [];
  const chosen = {};
  for (const s of slots) {
    const m = getModule(s.id, build.modules?.[s.id]);
    potDen += slotMax(s.id, 'pot') * s.weight;
    if (!m) {
      if (s.required.includes(cls.id)) missing.push(s.name);
      continue;
    }
    chosen[s.id] = m;
    potNum += m.pot * s.weight;
    efiNum += m.efi * s.weight;
    efiDen += s.weight;
    weight += m.peso;
    cost += m.custo;
  }
  const s = potDen > 0 ? potNum / potDen : 0;
  const e = efiDen > 0 ? efiNum / efiDen / 10 : 0;
  const overweight = weight > cls.capacity;
  let score = Math.min(1, Math.max(0, s * (0.75 + 0.35 * e)));
  if (overweight) score *= 0.8;
  const [lo, hi] = cls.range;
  const yieldKt = lo * Math.pow(hi / lo, score);
  const overBudget = cost > budget;
  return {
    cls, chosen, yieldKt, score, efficiency: e, weight, capacity: cls.capacity, cost, budget,
    overweight, overBudget, missing,
    valid: missing.length === 0 && !overBudget,
    type: cls.type,
    fissionFraction: CONFIG.fallout.fissionFraction[cls.type],
  };
}

/** Enumera todas as montagens possíveis de uma classe (para calcular o "par" dos desafios). */
export function* enumerateBuilds() {
  for (const cls of CLASSES) {
    const slots = SLOTS.filter((s) => s.allowed.includes(cls.id));
    const options = slots.map((s) => {
      const ids = MODULES[s.id].map((m) => m.id);
      return s.required.includes(cls.id) ? ids : [null, ...ids];
    });
    const idx = new Array(slots.length).fill(0);
    for (;;) {
      const modules = {};
      slots.forEach((s, i) => { modules[s.id] = options[i][idx[i]]; });
      yield { classId: cls.id, modules };
      let k = 0;
      while (k < idx.length) {
        idx[k]++;
        if (idx[k] < options[k].length) break;
        idx[k] = 0;
        k++;
      }
      if (k === idx.length) break;
    }
  }
}
