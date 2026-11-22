/**
 * Energia de ligação por núcleon (MeV) de alguns núcleos — valores de tabelas
 * padrão de massas atômicas (AME), arredondados. Usados no gráfico interativo.
 */
export const NUCLIDES = [
  { name: 'H-2 (deutério)', A: 2, Z: 1, BA: 1.112 },
  { name: 'H-3 (trítio)', A: 3, Z: 1, BA: 2.827 },
  { name: 'He-3', A: 3, Z: 2, BA: 2.573 },
  { name: 'He-4', A: 4, Z: 2, BA: 7.074 },
  { name: 'Li-6', A: 6, Z: 3, BA: 5.332 },
  { name: 'Li-7', A: 7, Z: 3, BA: 5.606 },
  { name: 'Be-9', A: 9, Z: 4, BA: 6.463 },
  { name: 'C-12', A: 12, Z: 6, BA: 7.680 },
  { name: 'O-16', A: 16, Z: 8, BA: 7.976 },
  { name: 'Ne-20', A: 20, Z: 10, BA: 8.032 },
  { name: 'Si-28', A: 28, Z: 14, BA: 8.448 },
  { name: 'Ca-40', A: 40, Z: 20, BA: 8.551 },
  { name: 'Fe-56', A: 56, Z: 26, BA: 8.790 },
  { name: 'Ni-62', A: 62, Z: 28, BA: 8.795 },
  { name: 'Kr-84', A: 84, Z: 36, BA: 8.717 },
  { name: 'Sr-90', A: 90, Z: 38, BA: 8.696 },
  { name: 'Zr-90', A: 90, Z: 40, BA: 8.710 },
  { name: 'Sn-120', A: 120, Z: 50, BA: 8.505 },
  { name: 'Ba-138', A: 138, Z: 56, BA: 8.393 },
  { name: 'Cs-137', A: 137, Z: 55, BA: 8.389 },
  { name: 'Nd-142', A: 142, Z: 60, BA: 8.346 },
  { name: 'W-184', A: 184, Z: 74, BA: 8.005 },
  { name: 'Au-197', A: 197, Z: 79, BA: 7.916 },
  { name: 'Pb-208', A: 208, Z: 82, BA: 7.868 },
  { name: 'U-235', A: 235, Z: 92, BA: 7.591 },
  { name: 'U-238', A: 238, Z: 92, BA: 7.570 },
  { name: 'Pu-239', A: 239, Z: 94, BA: 7.560 },
];

/**
 * Fórmula semiempírica de massa (Weizsäcker) — curva suave de B/A.
 * Coeficientes típicos de livros-texto (MeV).
 */
export function semfBA(A) {
  const aV = 15.75, aS = 17.8, aC = 0.711, aA = 23.7;
  // Z estável aproximado (linha de estabilidade)
  const Z = A / (1.98 + 0.0155 * A ** (2 / 3));
  const B = aV * A - aS * A ** (2 / 3) - aC * Z * (Z - 1) / A ** (1 / 3) - aA * (A - 2 * Z) ** 2 / A;
  return Math.max(0, B / A);
}
