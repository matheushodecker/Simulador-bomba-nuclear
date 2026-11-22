/** Navegação entre as abas (views). As páginas são renderizadas sob demanda. */
import { emit } from '../util/events.js';

const renderers = new Map();
const rendered = new Set();

export function registerView(name, render) {
  renderers.set(name, render);
}

export function showView(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  const el = document.getElementById(`view-${name}`);
  const r = renderers.get(name);
  if (r) {
    r(el, !rendered.has(name));
    rendered.add(name);
  }
  if (el && el.classList.contains('page')) el.scrollTop = 0;
  emit('view', name);
}

export function initViews() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
}
