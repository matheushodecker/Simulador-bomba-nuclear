/** Utilitários numéricos compartilhados pelos módulos de física. */

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Interpolação log-log numa tabela de pares [x, y] (x estritamente monótono).
 * Fora da tabela, extrapola com a inclinação do segmento da ponta.
 */
export function interpLogLog(table, x) {
  const n = table.length;
  const asc = table[n - 1][0] > table[0][0];
  const lx = Math.log(x);
  let i = 0;
  // encontra o segmento [i, i+1] que contém x (ou o da ponta)
  if (asc) {
    while (i < n - 2 && x > table[i + 1][0]) i++;
  } else {
    while (i < n - 2 && x < table[i + 1][0]) i++;
  }
  const [x0, y0] = table[i];
  const [x1, y1] = table[i + 1];
  const t = (lx - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
  return Math.exp(Math.log(y0) + t * (Math.log(y1) - Math.log(y0)));
}

/** Integração trapezoidal simples */
export function trapz(f, a, b, n = 200) {
  const h = (b - a) / n;
  let s = 0.5 * (f(a) + f(b));
  for (let i = 1; i < n; i++) s += f(a + i * h);
  return s * h;
}
