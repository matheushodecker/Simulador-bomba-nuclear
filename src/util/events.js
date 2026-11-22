/** Barramento de eventos minimalista para desacoplar módulos. */
const handlers = new Map();

export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
  return () => handlers.get(name).delete(fn);
}

export function emit(name, payload) {
  const set = handlers.get(name);
  if (set) for (const fn of [...set]) {
    try { fn(payload); } catch (e) { console.error(`[evento ${name}]`, e); }
  }
}
