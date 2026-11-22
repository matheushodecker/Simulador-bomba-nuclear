/**
 * Oficina (modo jogo): montagem estilizada e fictícia + "Meu Arsenal".
 */
import {
  CLASSES, SLOTS, MODULES, PAINTS, EMBLEMS, DEFAULT_BUDGET, evaluateBuild, getClass,
} from '../game/workshop-model.js';
import { loadArsenal, saveWeapon, deleteWeapon, newId } from '../game/arsenal.js';
import { CHALLENGES, evaluateChallenge, recordChallenge, getChallengeScores } from '../game/challenges.js';
import { unlock } from '../game/achievements.js';
import { setWeapon } from '../state.js';
import { emit, on } from '../util/events.js';
import { warheadSvg } from '../render/warhead.js';
import { TYPE_LABEL } from '../data/weapons.js';
import { yieldComparisons } from '../data/comparisons.js';
import { fmtYield, fmtSig, escapeHtml, fmtPct } from '../util/format.js';

export const workshop = {
  build: { id: null, name: 'Protótipo 1', classId: 'fissao', modules: { nucleo: 'mk1', casco: 'fenix' }, paint: 'grafite', emblem: 'estrela' },
  challengeId: null,
};

const bar = (v, max = 10, color = 'var(--accent)') => `<span class="mini-bar"><span style="width:${(100 * v) / max}%;background:${color}"></span></span>`;

export function renderOficina(el, ctx, first) {
  if (first) {
    on('arsenal-changed', () => renderArsenal(el, ctx));
    on('workshop-challenge', () => draw(el, ctx));
  }
  draw(el, ctx);
}

function draw(el, ctx) {
  const b = workshop.build;
  const ch = CHALLENGES.find((c) => c.id === workshop.challengeId);
  const budget = ch ? ch.budget : DEFAULT_BUDGET;
  const ev = evaluateBuild(b, budget);
  const cls = getClass(b.classId);
  const slots = SLOTS.filter((s) => s.allowed.includes(cls.id));

  el.innerHTML = `
  <div class="page-wrap wide">
    <header class="page-hero">
      <h1>🛠️ Oficina <small class="muted">— modo jogo</small></h1>
      <p>Montagem <b>estilizada e fictícia</b>, como um sistema de <i>crafting</i>. Os módulos e atributos são inventados e não correspondem a componentes reais.
      O único resultado que vai para o simulador é a <b>potência (kt)</b> e o <b>tipo</b> (que define o fallout).</p>
      ${ch ? `<div class="challenge-banner">🏁 Desafio ativo: <b>${escapeHtml(ch.title)}</b> — ${escapeHtml(ch.goal)} Orçamento: <b>${ch.budget}</b> créditos. <button class="btn small" id="ch-leave">Sair do desafio</button></div>` : ''}
    </header>

    <div class="workshop">
      <div class="ws-col">
        <h3>1. Classe</h3>
        <div class="class-cards">
          ${CLASSES.map((c) => `<button class="class-card ${c.id === cls.id ? 'active' : ''}" data-class="${c.id}" style="--c:${c.color}">
            <b>${escapeHtml(c.name)}</b><span>${fmtYield(c.range[0])} – ${fmtYield(c.range[1])}</span><small>${c.cost} créditos · capacidade ${c.capacity}</small></button>`).join('')}
        </div>
        <p class="muted small">${escapeHtml(cls.desc)}</p>
        <h3>2. Módulos</h3>
        ${slots.map((s) => `
          <div class="slot">
            <div class="slot-name">${escapeHtml(s.name)} ${s.required.includes(cls.id) ? '<span class="req">obrigatório</span>' : '<span class="opt">opcional</span>'}</div>
            <div class="modules">
              ${s.required.includes(cls.id) ? '' : `<button class="module ${!b.modules[s.id] ? 'active' : ''}" data-slot="${s.id}" data-mod=""><b>Vazio</b><small>0 créditos</small></button>`}
              ${MODULES[s.id].map((m) => `<button class="module ${b.modules[s.id] === m.id ? 'active' : ''}" data-slot="${s.id}" data-mod="${m.id}">
                <b>${escapeHtml(m.name)}</b><small>${escapeHtml(m.desc)}</small>
                <span class="attrs">
                  <span>Potência ${bar(m.pot, 10, '#ff7043')}</span>
                  <span>Eficiência ${bar(m.efi, 10, '#66bb6a')}</span>
                  <span>Peso ${bar(m.peso, 12, '#90a4ae')}</span>
                  <span>Custo ${bar(m.custo, 45, '#ffd54f')} ${m.custo}</span>
                </span></button>`).join('')}
            </div>
          </div>`).join('')}
      </div>

      <div class="ws-col center">
        <div class="warhead-stage">${warheadSvg(b, { width: 420 })}</div>
        <h3>3. Identidade</h3>
        <label class="lbl">Nome</label>
        <input type="text" id="ws-name" maxlength="28" value="${escapeHtml(b.name)}" />
        <label class="lbl">Pintura</label>
        <div class="swatches">${PAINTS.map((p) => `<button class="swatch ${b.paint === p.id ? 'active' : ''}" data-paint="${p.id}" title="${escapeHtml(p.name)}" style="background:linear-gradient(135deg, ${p.base} 55%, ${p.accent} 55%)"></button>`).join('')}</div>
        <label class="lbl">Emblema</label>
        <div class="emblems">${EMBLEMS.map((e) => `<button class="chip ${b.emblem === e.id ? 'active' : ''}" data-emblem="${e.id}">${escapeHtml(e.name)}</button>`).join('')}</div>
      </div>

      <div class="ws-col">
        <h3>4. Resultado</h3>
        <div class="ws-yield">${fmtYield(ev.yieldKt)}</div>
        <div class="muted">${escapeHtml(yieldComparisons(ev.yieldKt)[0] || '')}</div>
        <div class="ws-meter"><span>Orçamento</span><div class="meter-bar ${ev.overBudget ? 'bad' : ''}"><span style="width:${Math.min(100, (100 * ev.cost) / budget)}%"></span></div><b>${ev.cost} / ${budget}</b></div>
        <div class="ws-meter"><span>Peso</span><div class="meter-bar ${ev.overweight ? 'bad' : ''}"><span style="width:${Math.min(100, (100 * ev.weight) / ev.capacity)}%"></span></div><b>${ev.weight} / ${ev.capacity}</b></div>
        <div class="ws-meter"><span>Eficiência</span><div class="meter-bar ok"><span style="width:${100 * ev.efficiency}%"></span></div><b>${fmtPct(ev.efficiency)}</b></div>
        <div class="ws-meter"><span>Classe</span><div class="meter-bar"><span style="width:${100 * ev.score}%;background:${cls.color}"></span></div><b>${fmtPct(ev.score)}</b></div>
        <p class="small">Tipo: <b>${TYPE_LABEL[ev.type]}</b> · fallout com ${fmtPct(ev.fissionFraction)} de fissão.</p>
        ${ev.overweight ? '<div class="warn-box">⚠️ Sobrepeso: a montagem fica instável e perde 20% de desempenho.</div>' : ''}
        ${ev.overBudget ? '<div class="warn-box">💸 Acima do orçamento.</div>' : ''}
        ${ev.missing.length ? `<div class="warn-box">🧩 Falta: ${ev.missing.map(escapeHtml).join(', ')}.</div>` : ''}
        <div class="ws-actions">
          <button class="btn primary" id="ws-use" ${ev.missing.length ? 'disabled' : ''}>☢ Usar no simulador</button>
          <button class="btn" id="ws-save" ${ev.missing.length ? 'disabled' : ''}>💾 Salvar no Meu Arsenal</button>
          ${ch ? `<button class="btn danger" id="ws-test" ${ev.valid ? '' : 'disabled'}>🏁 Testar no desafio</button>` : ''}
          <button class="btn" id="ws-new">✨ Nova montagem</button>
        </div>
        <div id="ws-test-result"></div>
      </div>
    </div>

    <section class="page-sec">
      <h2>🗄️ Meu Arsenal</h2>
      <div class="arsenal-grid" id="arsenal-grid"></div>
    </section>
  </div>`;

  renderArsenal(el, ctx);

  el.querySelectorAll('[data-class]').forEach((x) => x.addEventListener('click', () => {
    const id = x.dataset.class;
    b.classId = id;
    // garante módulos obrigatórios
    for (const s of SLOTS) {
      if (!s.allowed.includes(id)) delete b.modules[s.id];
      else if (s.required.includes(id) && !b.modules[s.id]) b.modules[s.id] = MODULES[s.id][0].id;
    }
    draw(el, ctx);
  }));
  el.querySelectorAll('[data-slot]').forEach((x) => x.addEventListener('click', () => {
    b.modules[x.dataset.slot] = x.dataset.mod || null;
    draw(el, ctx);
  }));
  el.querySelectorAll('[data-paint]').forEach((x) => x.addEventListener('click', () => { b.paint = x.dataset.paint; draw(el, ctx); }));
  el.querySelectorAll('[data-emblem]').forEach((x) => x.addEventListener('click', () => { b.emblem = x.dataset.emblem; draw(el, ctx); }));
  el.querySelector('#ws-name').addEventListener('change', (e) => { b.name = e.target.value.trim() || 'Sem nome'; draw(el, ctx); });
  el.querySelector('#ch-leave')?.addEventListener('click', () => { workshop.challengeId = null; draw(el, ctx); });
  el.querySelector('#ws-new').addEventListener('click', () => {
    workshop.build = { id: null, name: `Protótipo ${loadArsenal().length + 1}`, classId: 'fissao', modules: { nucleo: 'mk1', casco: 'fenix' }, paint: 'grafite', emblem: 'estrela' };
    draw(el, ctx);
  });
  el.querySelector('#ws-save')?.addEventListener('click', () => {
    const name = el.querySelector('#ws-name').value.trim() || b.name;
    b.name = name;
    if (!b.id) b.id = newId();
    saveWeapon({ ...structuredClone(b), yieldKt: ev.yieldKt, type: ev.type, fissionFraction: ev.fissionFraction, cost: ev.cost, date: Date.now() });
    unlock('engenheiro');
    emit('toast', { type: 'ok', text: `"${name}" salva no Meu Arsenal.` });
  });
  el.querySelector('#ws-use')?.addEventListener('click', () => {
    setWeapon({ yieldKt: ev.yieldKt, name: `${b.name} (Oficina)`, id: b.id, type: ev.type, fissionFraction: ev.fissionFraction });
    emit('toast', { type: 'ok', text: `${b.name}: ${fmtYield(ev.yieldKt)} pronta no simulador.` });
    ctx.showView('sim');
  });
  el.querySelector('#ws-test')?.addEventListener('click', () => {
    const res = evaluateChallenge(ch, b);
    const box = el.querySelector('#ws-test-result');
    if (res.ok) {
      const improved = recordChallenge(ch.id, res);
      unlock('desafiante');
      const scores = getChallengeScores();
      if (CHALLENGES.every((c) => scores[c.id])) unlock('mestre');
      box.innerHTML = `<div class="ok-box">✅ Desafio cumprido! Resultado: ${fmtSig(res.value, 3)} ${ch.unit}. Custo: <b>${res.ev.cost}</b> créditos ${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)}
        ${res.par ? `<br><span class="small">Custo mínimo possível: ${res.par.cost} créditos.</span>` : ''}${improved ? '<br><b>Novo recorde pessoal!</b>' : ''}
        <p class="small">💡 ${escapeHtml(ch.lesson)}</p></div>`;
    } else {
      box.innerHTML = `<div class="warn-box">❌ Ainda não: obteve ${fmtSig(res.value, 3)} ${ch.unit}. ${escapeHtml(ch.goal)}</div>`;
    }
  });
}

function renderArsenal(el, ctx) {
  const grid = el.querySelector('#arsenal-grid');
  if (!grid) return;
  const list = loadArsenal();
  if (!list.length) {
    grid.innerHTML = '<p class="muted">Nenhuma arma salva ainda. Monte uma e clique em "Salvar no Meu Arsenal".</p>';
    return;
  }
  grid.innerHTML = list.map((w) => `
    <article class="arsenal-card">
      <div class="thumb">${warheadSvg(w, { width: 220, animate: false })}</div>
      <h4>${escapeHtml(w.name)}</h4>
      <div class="muted small">${TYPE_LABEL[w.type]} · ${fmtYield(w.yieldKt)} · ${w.cost} créditos</div>
      <div class="row">
        <button class="btn small primary" data-use="${w.id}">Usar</button>
        <button class="btn small" data-edit="${w.id}">Editar</button>
        <button class="btn small" data-del="${w.id}" aria-label="Excluir">🗑️</button>
      </div>
    </article>`).join('');
  grid.querySelectorAll('[data-use]').forEach((x) => x.addEventListener('click', () => {
    const w = list.find((y) => y.id === x.dataset.use);
    setWeapon({ yieldKt: w.yieldKt, name: `${w.name} (Meu Arsenal)`, id: w.id, type: w.type, fissionFraction: w.fissionFraction });
    ctx.showView('sim');
  }));
  grid.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => {
    const w = list.find((y) => y.id === x.dataset.edit);
    workshop.build = { id: w.id, name: w.name, classId: w.classId, modules: { ...w.modules }, paint: w.paint, emblem: w.emblem };
    draw(el, ctx);
    el.scrollTop = 0;
  }));
  grid.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => {
    // confirmação em dois cliques (diálogos do navegador não funcionam em todos os ambientes)
    if (x.dataset.armed) { deleteWeapon(x.dataset.del); return; }
    x.dataset.armed = '1';
    x.textContent = 'Confirmar exclusão';
    x.classList.add('danger');
    setTimeout(() => { if (x.isConnected) { delete x.dataset.armed; x.textContent = '🗑️'; x.classList.remove('danger'); } }, 3500);
  }));
}
