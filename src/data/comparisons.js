/** Energias de referência (J) para comparações didáticas. Valores arredondados. */
export const ENERGY_REFERENCES = [
  { label: 'Pilha AA', J: 1.0e4, icon: '🔋' },
  { label: '1 kg de TNT', J: 4.184e6, icon: '🧨' },
  { label: '1 litro de gasolina', J: 3.4e7, icon: '⛽' },
  { label: 'Raio (descarga atmosférica)', J: 1.0e9, icon: '⚡' },
  { label: 'Consumo elétrico anual de uma casa (~2.400 kWh)', J: 8.6e9, icon: '🏠' },
  { label: 'Explosão do porto de Beirute (2020, ~0,5 kt)', J: 2.1e12, icon: '💥' },
  { label: 'Hiroshima (15 kt)', J: 6.3e13, icon: '☢️' },
  { label: 'Itaipu em 1 dia (~90 TWh/ano)', J: 8.9e14, icon: '🌊' },
  { label: 'Tsar Bomba (50 Mt)', J: 2.1e17, icon: '☢️' },
  { label: 'Erupção do Monte Santa Helena (1980, ~24 Mt)', J: 1.0e17, icon: '🌋' },
  { label: 'Energia solar que atinge a Terra em 1 s', J: 1.7e17, icon: '☀️' },
];

/** Comparações automáticas para uma potência em kt */
export function yieldComparisons(kt) {
  const out = [];
  const hiro = kt / 15;
  if (hiro >= 0.01) out.push(hiro >= 1 ? `≈ ${fmt(hiro)}× Hiroshima` : `≈ ${fmt(hiro * 100)}% de Hiroshima`);
  if (kt >= 1000) out.push(`≈ ${fmt(kt / 50000 * 100)}% da Tsar Bomba`);
  if (kt < 5) out.push(`≈ ${fmt(kt / 0.5)}× a explosão de Beirute (2020)`);
  out.push(`= ${fmtTnt(kt)} de TNT`);
  return out;
}

function fmt(x) {
  const d = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d }).format(x);
}

function fmtTnt(kt) {
  const t = kt * 1000;
  if (t < 1e3) return `${fmt(t)} toneladas`;
  if (t < 1e6) return `${fmt(t / 1e3)} mil toneladas`;
  return `${fmt(t / 1e6)} milhões de toneladas`;
}
