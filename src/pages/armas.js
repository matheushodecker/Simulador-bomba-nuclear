/**
 * Menu inicial: três modos de escolha da arma.
 *  1. Arsenal histórico   2. Potência livre   3. Oficina (modo jogo)
 */
import { HISTORIC_WEAPONS, TYPE_LABEL } from '../data/weapons.js';
import { yieldComparisons } from '../data/comparisons.js';
import { setWeapon } from '../state.js';
import { CONFIG } from '../config.js';
import { trackHistoric } from '../game/achievements.js';
import { emit } from '../util/events.js';
import { fmtYield, escapeHtml } from '../util/format.js';

export function renderArmas(el, ctx, first) {
  if (!first) return;
  el.innerHTML = `
  <div class="page-wrap">
    <header class="page-hero">
      <h1>Escolha a arma</h1>
      <p>Três formas de definir a potência que será simulada. Em todas, o resultado é só um número (kt) e um tipo (que afeta o fallout).</p>
    </header>
    <div class="mode-cards">
      <button class="mode-card" data-mode="historico">
        <span class="mc-icon">📜</span><h3>Arsenal histórico</h3>
        <p>Armas e testes reais, com dados públicos e curiosidades históricas.</p>
      </button>
      <button class="mode-card" data-mode="livre">
        <span class="mc-icon">🎚️</span><h3>Potência livre</h3>
        <p>Qualquer valor de 10 toneladas a 100 megatons, com comparações automáticas.</p>
      </button>
      <button class="mode-card" data-mode="oficina">
        <span class="mc-icon">🛠️</span><h3>Oficina <small>(modo jogo)</small></h3>
        <p>Monte uma arma fictícia com módulos de videogame, orçamento e pintura.</p>
      </button>
    </div>

    <section id="historico" class="page-sec">
      <div class="sec-head">
        <h2>📜 Arsenal histórico</h2>
        <div class="seg" id="hist-filter">
          <button data-f="all" class="active">Todas</button>
          <button data-f="fissao">Fissão</button>
          <button data-f="termonuclear">Termonucleares</button>
        </div>
      </div>
      <div class="weapon-grid" id="weapon-grid"></div>
    </section>
  </div>`;

  const grid = el.querySelector('#weapon-grid');
  const draw = (f) => {
    grid.innerHTML = HISTORIC_WEAPONS.filter((w) => f === 'all' || w.type === f).map((w) => `
      <article class="weapon-card ${w.type}">
        <div class="wc-top"><span class="flag">${w.flag}</span><span class="badge ${w.type}">${TYPE_LABEL[w.type]}</span></div>
        <h3>${escapeHtml(w.name)}</h3>
        <div class="wc-meta">${escapeHtml(w.country)} · ${w.year}</div>
        <div class="wc-yield">${fmtYield(w.yieldKt)}</div>
        <div class="wc-cmp">${escapeHtml(yieldComparisons(w.yieldKt)[0] || '')}</div>
        <p class="wc-fact">${escapeHtml(w.fact)}</p>
        <button class="btn primary" data-id="${w.id}">Selecionar</button>
      </article>`).join('');
  };
  draw('all');
  el.querySelector('#hist-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    el.querySelectorAll('#hist-filter button').forEach((x) => x.classList.toggle('active', x === b));
    draw(b.dataset.f);
  });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const w = HISTORIC_WEAPONS.find((x) => x.id === b.dataset.id);
    setWeapon({
      yieldKt: w.yieldKt, name: w.name, id: w.id, type: w.type,
      fissionFraction: w.fissionFraction ?? CONFIG.fallout.fissionFraction[w.type],
      burst: w.burst,
    });
    trackHistoric(w.id);
    emit('toast', { type: 'ok', text: `${w.name} selecionada (${fmtYield(w.yieldKt)}). Escolha o alvo e detone.` });
    ctx.showView('sim');
  });
  el.querySelector('.mode-cards').addEventListener('click', (e) => {
    const c = e.target.closest('.mode-card');
    if (!c) return;
    if (c.dataset.mode === 'historico') el.querySelector('#historico').scrollIntoView({ behavior: 'smooth' });
    if (c.dataset.mode === 'livre') ctx.controls.focusYield();
    if (c.dataset.mode === 'oficina') ctx.showView('oficina');
  });
}
