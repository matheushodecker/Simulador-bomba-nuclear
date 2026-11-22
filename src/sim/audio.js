/**
 * Som sintetizado com Web Audio (sem arquivos): estrondo grave que chega
 * JUNTO com a onda de choque — o som viaja à mesma velocidade.
 */
let ctx = null;
let noiseBuf = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = on; }

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const len = ctx.sampleRate * 6;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // ruído "marrom" (mais grave que o branco)
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Desbloqueia o áudio no gesto do usuário (clique em Detonar). */
export function primeAudio() {
  if (enabled) ensure();
}

/** @param {number} intensity 0–1 */
export function playBlast(intensity = 0.5, durationScale = 1) {
  if (!enabled) return;
  const ac = ensure();
  if (!ac) return;
  const t = ac.currentTime;
  const dur = (2.5 + 4 * intensity) * durationScale;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(220 + 900 * intensity, t);
  lp.frequency.exponentialRampToValueAtTime(60, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25 + 0.6 * intensity, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + dur + 0.1);
  // "pancada" subgrave
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(55, t);
  osc.frequency.exponentialRampToValueAtTime(25, t + 1.2);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.5 * intensity + 0.1, t + 0.02);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  osc.connect(og).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 1.6);
}
