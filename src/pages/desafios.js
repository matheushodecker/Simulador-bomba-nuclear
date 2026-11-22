/** Desafios de escala (modo jogo). */
import { CHALLENGES, challengePar, getChallengeScores } from '../game/challenges.js';
import { workshop } from './oficina.js';
import { emit } from '../util/events.js';
import { escapeHtml } from '../util/format.js';

export function renderDesafios(el, ctx) {
  const scores = getChallengeScores();
  el.innerHTML = `
  <div class="page-wrap">
    <header class="page-hero">
      <h1>🏁 Desafios de escala</h1>
      <p>Monte, na Oficina, a arma <b>mais barata</b> que atinja cada meta. O objetivo é sentir na prática as leis de escala:
      raios de choque crescem com W<sup>1/3</sup>, o calor com W<sup>0,41</sup> e a radiação inicial só com W<sup>0,19</sup>.</p>
    </header>
    <div class="challenge-grid">
      ${CHALLENGES.map((c) => {
        const s = scores[c.id];
        const par = challengePar(c);
        return `<article class="challenge-card ${s ? 'done' : ''}">
          <div class="cc-top"><h3>${escapeHtml(c.title)}</h3><span class="stars">${s ? '★'.repeat(s.stars) + '☆'.repeat(3 - s.stars) : '☆☆☆'}</span></div>
          <p>${escapeHtml(c.goal)}</p>
          <div class="muted small">Orçamento: ${c.budget} créditos · Melhor possível: ${par ? par.cost : '—'} · Seu recorde: ${s ? s.cost : '—'}</div>
          <button class="btn primary" data-ch="${c.id}">${s ? 'Tentar de novo' : 'Aceitar desafio'}</button>
        </article>`;
      }).join('')}
    </div>
  </div>`;
  el.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => {
    workshop.challengeId = b.dataset.ch;
    emit('workshop-challenge');
    ctx.showView('oficina');
  }));
}
