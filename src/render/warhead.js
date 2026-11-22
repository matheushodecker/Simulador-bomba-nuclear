/**
 * Ogiva ESTILIZADA (cartoon / ficção científica) em SVG para a Oficina.
 * O visual muda conforme classe, módulos, pintura e emblema — puramente estético.
 */
import { getClass, getModule, PAINTS } from '../game/workshop-model.js';
import { escapeHtml } from '../util/format.js';

let uid = 0;

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16; let g = (n >> 8) & 255; let b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

const EMBLEM_PATHS = {
  estrela: () => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const r = i % 2 ? 5 : 12;
      pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}"/>`;
  },
  raio: () => '<path d="M-3,-13 L7,-2 L1,-1 L5,13 L-7,0 L-1,-1 Z"/>',
  atomo: () => '<g fill="none" stroke-width="2"><ellipse rx="12" ry="4.5"/><ellipse rx="12" ry="4.5" transform="rotate(60)"/><ellipse rx="12" ry="4.5" transform="rotate(-60)"/></g><circle r="2.6"/>',
  coroa: () => '<path d="M-12,7 L-12,-6 L-6,1 L0,-10 L6,1 L12,-6 L12,7 Z"/>',
  cometa: () => '<circle cx="5" cy="-4" r="5"/><path d="M1,-1 L-13,12 L-4,0 L-12,3 L2,-8 Z" opacity="0.7"/>',
  olho: () => '<path d="M-13,0 C-6,-9 6,-9 13,0 C6,9 -6,9 -13,0 Z" fill="none" stroke-width="2"/><circle r="4"/>',
  escudo: () => '<path d="M0,-12 L11,-7 L9,5 L0,12 L-9,5 L-11,-7 Z"/>',
  chama: () => '<path d="M0,-13 C7,-5 9,1 6,7 C3,12 -3,12 -6,7 C-9,1 -3,-3 0,-13 Z"/>',
};

/**
 * @param {{classId, modules, paint, emblem, name}} build
 * @param {{width?:number, animate?:boolean}} opts
 */
export function warheadSvg(build, { width = 400, animate = true } = {}) {
  const id = `wh${++uid}`;
  const cls = getClass(build.classId);
  const paint = PAINTS.find((p) => p.id === build.paint) || PAINTS[0];
  const core = getModule('nucleo', build.modules?.nucleo);
  const amp = getModule('amplificador', build.modules?.amplificador);
  const stage = cls.id === 'termo' ? getModule('estagio', build.modules?.estagio) : null;
  const hull = getModule('casco', build.modules?.casco);
  const fins = getModule('aletas', build.modules?.aletas);

  const L = cls.id === 'fissao' ? 210 : cls.id === 'reforcada' ? 250 : 290;
  const H = cls.id === 'fissao' ? 96 : cls.id === 'reforcada' ? 84 : 76;
  const cy = 100;
  const r = H / 2;
  const x0 = 200 - L / 2 + 10;
  const x1 = 200 + L / 2 + 10;
  const nose = L * (cls.id === 'fissao' ? 0.34 : 0.3);
  const xb = x1 - nose;
  const body = `M ${x0 + 16} ${cy - r * 0.78} L ${xb} ${cy - r} C ${xb + nose * 0.62} ${cy - r} ${x1} ${cy - r * 0.38} ${x1} ${cy}
    C ${x1} ${cy + r * 0.38} ${xb + nose * 0.62} ${cy + r} ${xb} ${cy + r} L ${x0 + 16} ${cy + r * 0.78} Q ${x0 - 2} ${cy} ${x0 + 16} ${cy - r * 0.78} Z`;
  const base = paint.base;
  const acc = paint.accent;
  const glow = core?.glow || '#4fc3f7';

  // padrão de pintura
  let pattern = '';
  if (paint.pattern === 'stripes') {
    pattern = [0, 1, 2].map((i) => `<rect x="${x0 + 30 + i * 16}" y="${cy - r - 5}" width="8" height="${H + 10}" fill="${acc}" opacity="0.85" transform="skewX(-18)"/>`).join('');
  } else if (paint.pattern === 'camo') {
    let s = 7;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    pattern = Array.from({ length: 14 }, () => `<ellipse cx="${x0 + rnd() * L}" cy="${cy - r + rnd() * H}" rx="${10 + rnd() * 18}" ry="${6 + rnd() * 10}" fill="${acc}" opacity="0.55"/>`).join('');
  } else if (paint.pattern === 'hex') {
    pattern = `<pattern id="${id}hex" width="14" height="12" patternUnits="userSpaceOnUse"><path d="M7 0 L14 3.5 L14 8.5 L7 12 L0 8.5 L0 3.5 Z" fill="none" stroke="${acc}" stroke-width="0.8" opacity="0.5"/></pattern><rect x="${x0}" y="${cy - r}" width="${L}" height="${H}" fill="url(#${id}hex)"/>`;
  }

  // casco: linhas de painel
  let panels = '';
  if (hull?.id === 'bastiao') {
    panels = [0.25, 0.45, 0.62].map((f) => `<line x1="${x0 + L * f}" y1="${cy - r + 2}" x2="${x0 + L * f}" y2="${cy + r - 2}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>`
      + Array.from({ length: 5 }, (_, i) => `<circle cx="${x0 + L * f + 4}" cy="${cy - r * 0.7 + i * r * 0.35}" r="1.2" fill="rgba(0,0,0,0.4)"/>`).join('')).join('');
  } else if (hull?.id === 'nebulosa') {
    panels = `<path d="M ${x0 + 20} ${cy} L ${xb + nose * 0.5} ${cy}" stroke="${acc}" stroke-width="1.6" opacity="0.9" class="${animate ? 'wh-pulse' : ''}"/>`;
  } else {
    panels = `<line x1="${x0 + L * 0.4}" y1="${cy - r + 3}" x2="${x0 + L * 0.4}" y2="${cy + r - 3}" stroke="rgba(0,0,0,0.25)"/>`;
  }

  // estágio secundário: seções segmentadas
  let stageSvg = '';
  if (stage) {
    const sx = x0 + L * 0.12;
    const sw = L * 0.26;
    stageSvg = `<rect x="${sx}" y="${cy - r * 0.95}" width="${sw}" height="${H * 0.95}" rx="8" fill="${shade(base, -0.15)}" stroke="rgba(0,0,0,0.3)"/>`
      + Array.from({ length: stage.segments }, (_, i) => `<rect x="${sx + 6 + i * (sw / stage.segments)}" y="${cy - r * 0.8}" width="${sw / stage.segments - 10}" height="${H * 0.8 - 10}" rx="4" fill="none" stroke="${acc}" stroke-width="1.4" opacity="0.8"/>`).join('');
  }

  // amplificador: anéis luminosos
  let ampSvg = '';
  if (amp) {
    ampSvg = Array.from({ length: amp.rings }, (_, i) => {
      const x = x0 + L * (0.5 + i * 0.07);
      return `<ellipse cx="${x}" cy="${cy}" rx="5" ry="${r + 3}" fill="none" stroke="${glow}" stroke-width="3" opacity="0.85" filter="url(#${id}glow)" class="${animate ? 'wh-pulse' : ''}" style="animation-delay:${i * 0.25}s"/>`;
    }).join('');
  }

  // núcleo: janela brilhante
  const coreSvg = core ? `<circle cx="${x0 + L * 0.42}" cy="${cy}" r="${r * 0.38}" fill="${shade(base, -0.5)}" stroke="${acc}" stroke-width="2"/>
    <circle cx="${x0 + L * 0.42}" cy="${cy}" r="${r * 0.26}" fill="${glow}" filter="url(#${id}glow)" class="${animate ? 'wh-pulse' : ''}"/>` : '';

  // aletas
  let finsSvg = '';
  const fx = x0 + 6;
  const finColor = shade(base, -0.25);
  if (fins?.fin === 'delta') {
    finsSvg = `<path d="M ${fx + 40} ${cy - r * 0.75} L ${fx} ${cy - r - 22} L ${fx - 6} ${cy - r * 0.6} Z" fill="${finColor}"/><path d="M ${fx + 40} ${cy + r * 0.75} L ${fx} ${cy + r + 22} L ${fx - 6} ${cy + r * 0.6} Z" fill="${finColor}"/>`;
  } else if (fins?.fin === 'swept') {
    finsSvg = `<path d="M ${fx + 55} ${cy - r * 0.78} C ${fx + 30} ${cy - r - 10} ${fx + 5} ${cy - r - 30} ${fx - 10} ${cy - r - 30} L ${fx + 8} ${cy - r * 0.55} Z" fill="${finColor}"/>
      <path d="M ${fx + 55} ${cy + r * 0.78} C ${fx + 30} ${cy + r + 10} ${fx + 5} ${cy + r + 30} ${fx - 10} ${cy + r + 30} L ${fx + 8} ${cy + r * 0.55} Z" fill="${finColor}"/>`;
  } else if (fins?.fin === 'ring') {
    finsSvg = `<path d="M ${fx + 20} ${cy - r * 0.7} L ${fx + 4} ${cy - r - 14} M ${fx + 20} ${cy + r * 0.7} L ${fx + 4} ${cy + r + 14}" stroke="${finColor}" stroke-width="5"/>
      <ellipse cx="${fx + 2}" cy="${cy}" rx="9" ry="${r + 16}" fill="none" stroke="${acc}" stroke-width="5" opacity="0.9"/>`;
  }

  const emb = EMBLEM_PATHS[build.emblem] || EMBLEM_PATHS.estrela;
  const ex = xb - 8;
  const emblem = `<g transform="translate(${ex},${cy - r * 0.15})"><circle r="17" fill="${shade(base, -0.35)}" stroke="${acc}" stroke-width="2"/><g fill="${acc}" stroke="${acc}">${emb()}</g></g>`;
  const name = build.name ? `<text x="${x0 + L * 0.62}" y="${cy + r * 0.62}" font-size="11" font-family="system-ui" font-weight="700" letter-spacing="1.5" fill="${acc}" opacity="0.9" text-anchor="middle">${escapeHtml(build.name.toUpperCase().slice(0, 18))}</text>` : '';

  return `<svg viewBox="0 0 420 200" width="${width}" class="warhead-svg" role="img" aria-label="Ogiva estilizada ${escapeHtml(build.name || '')}">
    <defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${shade(base, 0.38)}"/><stop offset="0.42" stop-color="${base}"/><stop offset="1" stop-color="${shade(base, -0.5)}"/>
      </linearGradient>
      <filter id="${id}glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <clipPath id="${id}clip"><path d="${body}"/></clipPath>
    </defs>
    <ellipse cx="210" cy="${cy + r + 34}" rx="${L * 0.45}" ry="8" fill="rgba(0,0,0,0.45)"/>
    <g class="${animate ? 'wh-float' : ''}">
      ${finsSvg}
      <path d="${body}" fill="url(#${id}g)" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>
      <g clip-path="url(#${id}clip)">${pattern}${stageSvg}${panels}
        <rect x="${x0}" y="${cy - r * 0.78}" width="${L}" height="${r * 0.22}" fill="#fff" opacity="0.18"/>
      </g>
      ${ampSvg}${coreSvg}${emblem}${name}
    </g>
  </svg>`;
}
