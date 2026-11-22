/**
 * Trecho de HTML (compartilhado pelos inspetores do mapa e do cinema) que explica como a
 * onda de choque age naquele ponto: reflexão no solo, duração da fase positiva, resposta
 * de cada material e vibração do solo.
 */
import {
  MATERIALS, materialResponse, positivePhaseSeconds, reflectionRegime, incidenceAngleDeg,
  normalReflectionFactor, groundParticleVelocity,
} from '../physics/structures.js';
import { damageInfo } from '../physics/blast.js';
import { fmtSig } from '../util/format.js';

const REGIME = {
  superficie: 'hemisférica (no solo)',
  regular: 'regular',
  mach: 'tronco de Mach',
};

export function structureHtml(fx, dKm, mat = null) {
  const psi = fx.psiAt(dKm);
  if (!(psi > 0.05)) return '';
  const s = Math.hypot(dKm, fx.hKm);
  const td = positivePhaseSeconds(s, fx.yieldKt);
  const regime = reflectionRegime(dKm, fx.hKm, fx.radius.fireball);
  const ang = incidenceAngleDeg(dKm, fx.hKm);
  const v = groundParticleVelocity(psi);
  const rows = Object.entries(MATERIALS).map(([k, m]) => {
    const r = materialResponse(k, psi, td);
    const di = damageInfo(k === 'glass' ? Math.min(r.level, 5) : r.level);
    const label = k === 'glass' ? (r.level >= 1 ? 'quebram' : 'resistem') : di.label;
    const me = k === mat ? ' style="font-weight:700"' : '';
    return `<tr${me}><td>${m.label}${k === mat ? ' ◀' : ''}</td><td class="num">T ${fmtSig(m.T, 2)} s · FCD ${fmtSig(r.dlf, 2)}</td><td><span class="lvl" style="background:${k === 'glass' && r.level ? '#90caf9' : di.color}">${label}</span></td></tr>`;
  }).join('');
  const own = mat && MATERIALS[mat] ? `<div class="small" style="margin-top:4px"><b>${MATERIALS[mat].label}:</b> ${MATERIALS[mat].note}</div>` : '';
  return `
    <table class="small" style="margin-top:6px">
      <tr><td>Fase positiva</td><td class="num">${fmtSig(td, 2)} s</td></tr>
      <tr><td>Reflexão no solo</td><td class="num">${REGIME[regime]}${regime !== 'superficie' ? ` · ${fmtSig(ang, 2)}°` : ''}</td></tr>
      <tr><td>Parede voltada à onda</td><td class="num">×${fmtSig(normalReflectionFactor(psi), 2)} (reflexão)</td></tr>
      <tr><td>Vibração do solo</td><td class="num">≈ ${fmtSig(v * 100, 2)} cm/s</td></tr>
    </table>
    <details class="small" style="margin-top:4px"${mat ? ' open' : ''}><summary>Como cada material responde aqui</summary>
      <table class="small">${rows}</table>
      <div class="muted">T = período natural; FCD = fator de carga dinâmica (oscilador de 1 grau de liberdade sob a fase positiva). Onda longa (FCD→2) é mais destrutiva que um pulso curto com o mesmo pico. Tronco de Mach: além de ~40° a onda refletida alcança a incidente e as duas se fundem junto ao chão (mais pressão). Vibração: v ≈ p/(ρ·c) do solo.</div>
    </details>${own}`;
}
