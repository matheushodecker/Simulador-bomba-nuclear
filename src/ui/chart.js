/**
 * Mini biblioteca de gráficos em SVG (sem dependências): eixos lineares ou
 * logarítmicos, linhas finas, rótulos diretos, legenda e camada de hover
 * (cruz + tooltip). Usada nas abas "A Física" e "Validação".
 */
const NS = 'http://www.w3.org/2000/svg';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

function scale(domain, range, log) {
  const [d0, d1] = log ? domain.map(Math.log10) : domain;
  const [r0, r1] = range;
  const f = (v) => r0 + (((log ? Math.log10(v) : v) - d0) / (d1 - d0)) * (r1 - r0);
  f.invert = (p) => {
    const v = d0 + ((p - r0) / (r1 - r0)) * (d1 - d0);
    return log ? 10 ** v : v;
  };
  return f;
}

function niceTicks([a, b], n = 5) {
  const span = b - a;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function logTicks([a, b]) {
  const out = [];
  for (let e = Math.ceil(Math.log10(a)); e <= Math.floor(Math.log10(b)); e++) out.push(10 ** e);
  return out;
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * @param {HTMLElement} host
 * @param {object} o opções
 */
export function lineChart(host, o) {
  const W = o.width || 640;
  const H = o.height || 300;
  const m = { l: 56, r: o.directLabels ? 104 : 16, t: 14, b: 42 };
  host.innerHTML = '';
  host.classList.add('chart');
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  host.appendChild(wrap);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title || 'gráfico' }, wrap);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);

  const x = scale(o.xDomain, [m.l, W - m.r], o.xLog);
  const y = scale(o.yDomain, [H - m.b, m.t], o.yLog);
  const xt = o.xTicks || (o.xLog ? logTicks(o.xDomain) : niceTicks(o.xDomain));
  const yt = o.yTicks || (o.yLog ? logTicks(o.yDomain) : niceTicks(o.yDomain));
  const grid = el('g', { class: 'grid' }, svg);
  yt.forEach((v) => {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
    const t = el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, grid);
    t.textContent = (o.yFmt || String)(v);
  });
  xt.forEach((v) => {
    el('line', { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, class: 'v' }, grid);
    const t = el('text', { x: x(v), y: H - m.b + 16, 'text-anchor': 'middle', class: 'tick' }, grid);
    t.textContent = (o.xFmt || String)(v);
  });
  el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axis' }, svg);
  if (o.xLabel) { const t = el('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis-label' }, svg); t.textContent = o.xLabel; }
  if (o.yLabel) { const t = el('text', { x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', class: 'axis-label', transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` }, svg); t.textContent = o.yLabel; }

  (o.bands || []).forEach((b) => {
    el('rect', { x: x(b.x0), y: m.t, width: Math.max(0, x(b.x1) - x(b.x0)), height: H - m.b - m.t, fill: b.fill, class: 'band' }, svg);
    if (b.label) { const t = el('text', { x: (x(b.x0) + x(b.x1)) / 2, y: m.t + 14, 'text-anchor': 'middle', class: 'band-label' }, svg); t.textContent = b.label; }
  });

  const series = o.series.map((s, i) => ({ ...s, color: s.color || SERIES[i % SERIES.length] }));
  const labels = [];
  series.forEach((s) => {
    const pts = s.points.filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py) && (!o.yLog || py > 0));
    if (!pts.length) return;
    const d = pts.map(([px, py], k) => `${k ? 'L' : 'M'}${x(px).toFixed(1)},${y(py).toFixed(1)}`).join('');
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(s.dash ? { 'stroke-dasharray': s.dash } : {}) }, svg);
    if (o.directLabels && series.length <= 4) {
      const [lx, ly] = pts[pts.length - 1];
      labels.push({ x: x(lx) + 6, y: y(ly) + 4, text: s.name });
    }
  });
  // rótulos diretos sem sobreposição (espaçamento mínimo de 15 px)
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
  labels.forEach((l) => { const t = el('text', { x: l.x, y: l.y, class: 'direct-label' }, svg); t.textContent = l.text; });
  (o.dots || []).forEach((p) => {
    const c = el('circle', { cx: x(p.x), cy: y(p.y), r: p.r || 4, fill: p.color || SERIES[0], stroke: 'var(--chart-surface)', 'stroke-width': 2, class: p.cls || '' }, svg);
    c.dataset.label = p.label || '';
    if (p.text) {
      const t = el('text', { x: x(p.x) + (p.dx ?? 7), y: y(p.y) + (p.dy ?? -7), class: 'dot-label', 'text-anchor': p.anchor || 'start' }, svg);
      t.textContent = p.text;
    }
  });
  (o.markers || []).forEach((mk) => {
    el('line', { x1: x(mk.x), x2: x(mk.x), y1: m.t, y2: H - m.b, class: 'marker' }, svg);
    if (mk.label) { const t = el('text', { x: x(mk.x) + 4, y: m.t + 12, class: 'marker-label' }, svg); t.textContent = mk.label; }
  });

  if (series.length > 1 && o.legend !== false) {
    const lg = document.createElement('div');
    lg.className = 'chart-legend';
    lg.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    host.insertBefore(lg, wrap);
  }

  // camada de hover
  const cross = el('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' }, svg);
  const hoverDots = series.map((s) => el('circle', { r: 4.5, fill: s.color, stroke: 'var(--chart-surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
  const overlay = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const interp = (pts, xv) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      if ((xv >= x0 && xv <= x1) || (xv <= x0 && xv >= x1)) {
        const t = (o.xLog ? Math.log(xv / x0) / Math.log(x1 / x0) : (xv - x0) / (x1 - x0)) || 0;
        return o.yLog ? y0 * (y1 / y0) ** t : y0 + (y1 - y0) * t;
      }
    }
    return null;
  };
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const xv = x.invert(px);
    const vals = series.map((s) => interp(s.points, xv));
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    vals.forEach((v, i) => {
      const dot = hoverDots[i];
      if (v == null || (o.yLog && v <= 0)) { dot.setAttribute('visibility', 'hidden'); return; }
      dot.setAttribute('cx', px); dot.setAttribute('cy', y(v)); dot.setAttribute('visibility', 'visible');
    });
    tip.hidden = false;
    tip.innerHTML = o.tooltip ? o.tooltip(xv, vals, series) : `${(o.xFmt || String)(xv)}<br>${vals.map((v, i) => `${series[i].name}: ${v == null ? '—' : (o.yFmt || String)(v)}`).join('<br>')}`;
    const left = ((px / W) * r.width);
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(4, left + 12))}px`;
    tip.style.top = '8px';
  };
  overlay.addEventListener('pointermove', move);
  overlay.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    hoverDots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  });
  return { svg, x, y };
}

/** Barras horizontais em escala log (escada de energia). */
export function hBarLog(host, { items, domain, marker, fmt }) {
  const W = 640;
  const rowH = 26;
  const m = { l: 250, r: 70, t: 8, b: 28 };
  const H = m.t + m.b + items.length * rowH;
  const x = scale(domain, [m.l, W - m.r], true);
  host.innerHTML = '';
  host.classList.add('chart');
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  host.appendChild(wrap);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Escada de energias' }, wrap);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);
  const g = el('g', { class: 'grid' }, svg);
  logTicks(domain).forEach((v, i) => {
    if (i % 2) return;
    el('line', { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, class: 'v' }, g);
    const t = el('text', { x: x(v), y: H - 10, 'text-anchor': 'middle', class: 'tick' }, g);
    t.textContent = fmt(v);
  });
  items.forEach((it, i) => {
    const yy = m.t + i * rowH;
    const w = Math.max(2, x(it.J) - m.l);
    const lab = el('text', { x: m.l - 8, y: yy + rowH / 2 + 4, 'text-anchor': 'end', class: 'bar-label' }, svg);
    lab.textContent = `${it.icon} ${it.label}`;
    const bar = el('rect', { x: m.l, y: yy + 4, width: w, height: rowH - 8, rx: 4, fill: it.highlight ? 'var(--series-2)' : 'var(--series-1)', class: 'bar' }, svg);
    const hit = el('rect', { x: 0, y: yy, width: W, height: rowH, fill: 'transparent' }, svg);
    hit.addEventListener('pointerenter', () => {
      tip.hidden = false;
      tip.innerHTML = `<b>${it.label}</b><br>${fmt(it.J)} J`;
      tip.style.left = `${(x(it.J) / W) * svg.getBoundingClientRect().width * 0.8}px`;
      tip.style.top = `${(yy / H) * svg.getBoundingClientRect().height + 20}px`;
      bar.classList.add('hover');
    });
    hit.addEventListener('pointerleave', () => { tip.hidden = true; bar.classList.remove('hover'); });
  });
  if (marker) {
    el('line', { x1: x(marker.J), x2: x(marker.J), y1: m.t - 4, y2: H - m.b, class: 'marker' }, svg);
    const t = el('text', { x: x(marker.J), y: H - m.b + 12, 'text-anchor': 'middle', class: 'marker-label' }, svg);
    t.textContent = marker.label;
  }
}
