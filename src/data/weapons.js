/**
 * Arsenal histórico — somente dados públicos amplamente divulgados
 * (nome, país, ano, tipo, potência e um fato histórico).
 * fissionFraction: fração da energia vinda de fissão (afeta o fallout).
 * burst: modo de explosão histórico/típico (opcional).
 */
export const HISTORIC_WEAPONS = [
  {
    id: 'little-boy', name: 'Little Boy', country: 'EUA', flag: '🇺🇸', year: 1945, type: 'fissao', yieldKt: 15,
    burst: { mode: 'custom', heightM: 600 },
    fact: 'Lançada sobre Hiroshima em 6 de agosto de 1945; explodiu a cerca de 600 m de altura. Menos de 1 g de matéria foi convertida em energia.',
  },
  {
    id: 'fat-man', name: 'Fat Man', country: 'EUA', flag: '🇺🇸', year: 1945, type: 'fissao', yieldKt: 21,
    burst: { mode: 'custom', heightM: 503 },
    fact: 'Lançada sobre Nagasaki em 9 de agosto de 1945. As montanhas que cercam a cidade limitaram parte da destruição.',
  },
  {
    id: 'trinity', name: 'Trinity ("Gadget")', country: 'EUA', flag: '🇺🇸', year: 1945, type: 'fissao', yieldKt: 25,
    burst: { mode: 'custom', heightM: 30 },
    fact: 'Primeiro teste nuclear da história, no deserto do Novo México (16/7/1945). Reestimativas de 2021 apontam ~25 kt.',
  },
  {
    id: 'rds-1', name: 'RDS-1 ("Joe-1")', country: 'URSS', flag: '🇷🇺', year: 1949, type: 'fissao', yieldKt: 22,
    burst: { mode: 'custom', heightM: 30 },
    fact: 'Primeiro teste soviético, em Semipalatinsk (Cazaquistão). Encerrou o monopólio nuclear americano quatro anos depois de Hiroshima.',
  },
  {
    id: 'hurricane', name: 'Operação Hurricane', country: 'Reino Unido', flag: '🇬🇧', year: 1952, type: 'fissao', yieldKt: 25,
    burst: { mode: 'surface' },
    fact: 'Primeiro teste britânico: o dispositivo foi detonado dentro do casco de uma fragata nas ilhas Monte Bello, Austrália.',
  },
  {
    id: 'ivy-mike', name: 'Ivy Mike', country: 'EUA', flag: '🇺🇸', year: 1952, type: 'termonuclear', yieldKt: 10400, fissionFraction: 0.75,
    burst: { mode: 'surface' },
    fact: 'Primeiro teste de um dispositivo termonuclear, no atol Enewetak. A ilhota Elugelab desapareceu, deixando uma cratera de ~1,9 km.',
  },
  {
    id: 'castle-bravo', name: 'Castle Bravo', country: 'EUA', flag: '🇺🇸', year: 1954, type: 'termonuclear', yieldKt: 15000, fissionFraction: 0.67,
    burst: { mode: 'surface' },
    fact: 'Rendeu ~2,5× o previsto. O fallout atingiu as ilhas Rongelap e o pesqueiro japonês Daigo Fukuryū Maru — o maior acidente radiológico de testes dos EUA.',
  },
  {
    id: 'gerboise', name: 'Gerboise Bleue', country: 'França', flag: '🇫🇷', year: 1960, type: 'fissao', yieldKt: 70,
    burst: { mode: 'custom', heightM: 100 },
    fact: 'Primeiro teste francês, no Saara argelino. Sua potência foi cerca de 4× a de Hiroshima.',
  },
  {
    id: 'davy-crockett', name: 'Davy Crockett (W54)', country: 'EUA', flag: '🇺🇸', year: 1961, type: 'fissao', yieldKt: 0.02,
    burst: { mode: 'surface' },
    fact: 'Uma das menores armas nucleares já colocadas em serviço: potência equivalente a ~20 toneladas de TNT.',
  },
  {
    id: 'tsar', name: 'Tsar Bomba (AN602)', country: 'URSS', flag: '🇷🇺', year: 1961, type: 'termonuclear', yieldKt: 50000, fissionFraction: 0.03,
    burst: { mode: 'custom', heightM: 4000 },
    fact: 'A maior explosão já produzida pela humanidade. O cogumelo chegou a ~64 km de altura. Foi uma versão "limpa", com pouquíssimo fallout.',
  },
  {
    id: '596', name: 'Projeto 596', country: 'China', flag: '🇨🇳', year: 1964, type: 'fissao', yieldKt: 22,
    burst: { mode: 'custom', heightM: 100 },
    fact: 'Primeiro teste chinês, em Lop Nur. O nome vem do mês (junho de 1959) em que a URSS suspendeu a cooperação nuclear.',
  },
  {
    id: 'smiling-buddha', name: 'Smiling Buddha', country: 'Índia', flag: '🇮🇳', year: 1974, type: 'fissao', yieldKt: 8,
    burst: { mode: 'surface' },
    fact: 'Primeiro teste indiano, subterrâneo, em Pokhran — oficialmente descrito como "explosão nuclear pacífica".',
  },
  {
    id: 'w76', name: 'W76', country: 'EUA', flag: '🇺🇸', year: 1978, type: 'termonuclear', yieldKt: 100,
    fact: 'Ogiva de mísseis lançados de submarinos (Trident). Potência pública aproximada de ~100 kt — cerca de 7 Hiroshimas.',
  },
  {
    id: 'b83', name: 'B83', country: 'EUA', flag: '🇺🇸', year: 1983, type: 'termonuclear', yieldKt: 1200,
    fact: 'Bomba de potência ajustável de até 1,2 Mt — a de maior potência do arsenal americano nas últimas décadas.',
  },
];

/** Presets rápidos do painel de controle */
export const QUICK_PRESETS = [
  { label: 'Hiroshima', kt: 15, id: 'little-boy' },
  { label: 'Nagasaki', kt: 21, id: 'fat-man' },
  { label: 'Castle Bravo', kt: 15000, id: 'castle-bravo' },
  { label: 'Tsar Bomba', kt: 50000, id: 'tsar' },
];

export const TYPE_LABEL = {
  fissao: 'Fissão',
  reforcada: 'Fissão reforçada',
  termonuclear: 'Termonuclear',
};
