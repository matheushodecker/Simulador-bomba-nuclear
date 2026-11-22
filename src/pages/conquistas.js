/** Conquistas desbloqueadas. */
import { ACHIEVEMENTS, unlockedMap } from '../game/achievements.js';
import { escapeHtml } from '../util/format.js';

export function renderConquistas(el) {
  const u = unlockedMap();
  const n = Object.keys(u).length;
  el.innerHTML = `
  <div class="page-wrap">
    <header class="page-hero">
      <h1>🏆 Conquistas</h1>
      <p>${n} de ${ACHIEVEMENTS.length} desbloqueadas. Ficam salvas neste navegador.</p>
      <div class="progress"><span style="width:${(100 * n) / ACHIEVEMENTS.length}%"></span></div>
    </header>
    <div class="ach-grid">
      ${ACHIEVEMENTS.map((a) => `<article class="ach ${u[a.id] ? 'on' : ''}">
        <div class="ach-icon">${u[a.id] ? a.icon : '🔒'}</div>
        <div><h4>${escapeHtml(a.title)}</h4><p class="small muted">${escapeHtml(a.desc)}</p>
        ${u[a.id] ? `<div class="small" style="color:#ffd54f">${new Date(u[a.id]).toLocaleDateString('pt-BR')}</div>` : ''}</div>
      </article>`).join('')}
    </div>
  </div>`;
}
