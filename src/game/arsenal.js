/** "Meu Arsenal": armas criadas na Oficina, salvas no localStorage. */
import { load, save } from '../util/storage.js';
import { emit } from '../util/events.js';

export function loadArsenal() {
  return load('arsenal', []);
}

export function saveWeapon(w) {
  const list = loadArsenal();
  const i = list.findIndex((x) => x.id === w.id);
  if (i >= 0) list[i] = w; else list.unshift(w);
  save('arsenal', list.slice(0, 60));
  emit('arsenal-changed', list);
  return list;
}

export function deleteWeapon(id) {
  const list = loadArsenal().filter((x) => x.id !== id);
  save('arsenal', list);
  emit('arsenal-changed', list);
  return list;
}

export function newId() {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
