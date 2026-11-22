/** Notificações temporárias. */
import { on } from '../util/events.js';
import { escapeHtml } from '../util/format.js';

const box = () => document.getElementById('toasts');

export function toast({ type = 'info', text, title, html, timeout = 4500 }) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${title ? `<div class="t-title">${escapeHtml(title)}</div>` : ''}${html || escapeHtml(text || '')}`;
  box().appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, timeout);
}

export function initToasts() {
  on('toast', (t) => toast(t));
  on('achievement', (a) => toast({ type: 'achievement', title: `🏆 Conquista: ${a.title}`, text: `${a.icon} ${a.desc}`, timeout: 6000 }));
}
