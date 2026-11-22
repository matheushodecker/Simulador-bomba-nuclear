/** Rosa dos ventos em SVG mostrando de onde vem o vento e para onde vai o fallout. */
export function drawCompass(svg, fromDeg, speedKmh) {
  const toDeg = (fromDeg + 180) % 360;
  const len = 14 + Math.min(26, speedKmh * 0.35);
  const ticks = ['N', 'L', 'S', 'O'].map((t, i) => {
    const a = (i * 90 * Math.PI) / 180;
    return `<text x="${Math.sin(a) * 40}" y="${-Math.cos(a) * 40 + 4}" text-anchor="middle" font-size="10" fill="${t === 'N' ? '#ffb300' : '#93a1b0'}">${t}</text>`;
  }).join('');
  svg.innerHTML = `
    <circle r="46" fill="#0d131a" stroke="rgba(255,255,255,0.15)"/>
    <circle r="30" fill="none" stroke="rgba(255,255,255,0.07)"/>
    ${ticks}
    <g transform="rotate(${toDeg})">
      <line x1="0" y1="${len * 0.6}" x2="0" y2="${-len}" stroke="#c6ff00" stroke-width="3" stroke-linecap="round"/>
      <path d="M0 ${-len - 7} L-6 ${-len + 3} L6 ${-len + 3} Z" fill="#c6ff00"/>
    </g>
    <text y="58" text-anchor="middle" font-size="0">.</text>`;
  svg.setAttribute('title', `Fallout segue para ${Math.round(toDeg)}°`);
}

export function cardinal(deg) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'L', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
