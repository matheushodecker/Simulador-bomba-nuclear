/** Conquistas (salvas no localStorage). */
import { load, save } from '../util/storage.js';
import { emit } from '../util/events.js';

export const ACHIEVEMENTS = [
  { id: 'primeira', icon: '💥', title: 'Primeira detonação', desc: 'Faça sua primeira simulação.' },
  { id: 'megaton', icon: '🏋️', title: 'Megaton Club', desc: 'Simule uma arma de 1 Mt ou mais.' },
  { id: 'czar', icon: '👑', title: 'Escala do Czar', desc: 'Simule 50 Mt ou mais.' },
  { id: 'micro', icon: '🔬', title: 'Pequeno, mas nuclear', desc: 'Simule uma potência de 50 toneladas ou menos.' },
  { id: 'fronteira', icon: '🌍', title: 'Fallout atravessou fronteira', desc: 'A pluma de fallout alcança outro país.' },
  { id: 'cidade3d', icon: '🏙️', title: 'Cidade em 3D', desc: 'Carregue os prédios reais de uma área.' },
  { id: 'analise', icon: '📊', title: 'Análise urbana', desc: 'Avalie danos em mais de 1.000 prédios numa simulação.' },
  { id: 'explorador3d', icon: '🧊', title: 'Explorador(a) 3D', desc: 'Incline o mapa para a vista 3D.' },
  { id: 'inspetor', icon: '🔎', title: 'Inspetor(a) de estruturas', desc: 'Inspecione um prédio após uma simulação.' },
  { id: 'meteorologista', icon: '🌬️', title: 'Meteorologista', desc: 'Use o vento real da Open-Meteo.' },
  { id: 'historiador', icon: '📜', title: 'Historiador(a)', desc: 'Selecione 5 armas diferentes do arsenal histórico.' },
  { id: 'engenheiro', icon: '🛠️', title: 'Engenheiro(a) da Oficina', desc: 'Salve uma arma no Meu Arsenal.' },
  { id: 'comparador', icon: '⚖️', title: 'Lado a lado', desc: 'Compare duas armas no mesmo mapa.' },
  { id: 'desafiante', icon: '🏁', title: 'Desafiante', desc: 'Complete um desafio de escala.' },
  { id: 'mestre', icon: '🎓', title: 'Mestre da escala', desc: 'Complete todos os desafios.' },
  { id: 'fisico', icon: '⚛️', title: 'Físico(a) curioso(a)', desc: 'Visite a aba A Física.' },
  { id: 'cetico', icon: '🧪', title: 'Ceticismo científico', desc: 'Visite a aba Validação.' },
];

let unlocked = load('achievements', {});

export function isUnlocked(id) {
  return Boolean(unlocked[id]);
}

export function unlock(id) {
  if (unlocked[id]) return false;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return false;
  unlocked = { ...unlocked, [id]: Date.now() };
  save('achievements', unlocked);
  emit('achievement', a);
  return true;
}

export function unlockedMap() {
  return { ...unlocked };
}

/** Contadores auxiliares (ex.: armas históricas distintas). */
export function trackHistoric(id) {
  const seen = new Set(load('historicSeen', []));
  seen.add(id);
  save('historicSeen', [...seen]);
  if (seen.size >= 5) unlock('historiador');
}

export function resetAchievements() {
  unlocked = {};
  save('achievements', unlocked);
  save('historicSeen', []);
}
