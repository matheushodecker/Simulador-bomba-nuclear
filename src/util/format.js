/** Formatação numérica em português do Brasil. */
const nf = (d) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const nfFixed = (d) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });

export function fmtNum(x, d = 2) {
  if (!Number.isFinite(x)) return '—';
  return nf(d).format(x);
}

/** Número com algarismos significativos adequados. */
export function fmtSig(x, sig = 3) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(x)));
  const d = Math.max(0, sig - 1 - mag);
  return nfFixed(Math.min(d, 6)).format(Number(x.toFixed(Math.min(d, 6))));
}

export function fmtInt(x) {
  if (!Number.isFinite(x)) return '—';
  return nf(0).format(Math.round(x));
}

/** Distância: metros abaixo de 1 km. */
export function fmtDist(km) {
  if (!Number.isFinite(km)) return '—';
  if (km < 1) return `${fmtInt(km * 1000)} m`;
  if (km < 10) return `${nfFixed(2).format(km)} km`;
  if (km < 100) return `${nfFixed(1).format(km)} km`;
  return `${fmtInt(km)} km`;
}

export function fmtArea(km2) {
  if (!Number.isFinite(km2)) return '—';
  if (km2 < 0.01) return `${fmtInt(km2 * 1e6)} m²`;
  if (km2 < 10) return `${nfFixed(2).format(km2)} km²`;
  if (km2 < 1000) return `${nfFixed(1).format(km2)} km²`;
  return `${fmtInt(km2)} km²`;
}

/** Potência em t / kt / Mt. */
export function fmtYield(kt) {
  if (!Number.isFinite(kt)) return '—';
  if (kt < 1) return `${fmtSig(kt * 1000, 3)} t`;
  if (kt < 1000) return `${fmtSig(kt, 3)} kt`;
  return `${fmtSig(kt / 1000, 3)} Mt`;
}

/** Notação científica legível: 4,18 × 10¹² */
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function fmtSci(x, sig = 3) {
  if (!Number.isFinite(x) || x === 0) return String(x);
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / 10 ** e;
  const exp = String(e).split('').map((c) => SUP[c]).join('');
  return `${nfFixed(sig - 1).format(m)} × 10${exp}`;
}

export function fmtPct(x, d = 0) {
  return `${nfFixed(d).format(x * 100)}%`;
}

export function fmtCoord(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'L' : 'O';
  return `${nfFixed(5).format(Math.abs(lat))}° ${ns}, ${nfFixed(5).format(Math.abs(lon))}° ${ew}`;
}

export function fmtTime(sec) {
  if (sec < 60) return `${nfFixed(1).format(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} min ${s.toString().padStart(2, '0')} s`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
