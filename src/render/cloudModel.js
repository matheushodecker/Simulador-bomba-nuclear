/**
 * Linha do tempo da bola de fogo e da nuvem em cogumelo (compartilhada pelo
 * modo mapa e pelo modo cinema). Dimensões finais em CONFIG.cloud; a subida é
 * comprimida no tempo visual (na realidade leva ~5–10 minutos).
 */
import { CONFIG } from '../config.js';
import { smoothstep, lerp } from '../physics/math.js';

export function cloudState(fx, tau, tFb) {
  const T = CONFIG.anim.cloudRiseSeconds;
  const top = fx.cloud.topKm * 1000;
  const capR = fx.cloud.capKm * 1000;
  const rfb = fx.radius.fireball * 1000;
  const h0 = fx.hKm * 1000;
  const surface = h0 < rfb;
  // subida com aceleração gradual (empuxo): lenta no início, ~completa em T segundos
  const u = Math.min(1, Math.max(0, tau - tFb * 0.6) / (T * 0.95));
  const rise = 1 - (1 - u) ** 2.2 * (1 + 2.2 * u);
  const rtF = 0.5 * capR;
  const finalH = Math.max(h0 + rfb, top - rtF * 0.85);
  const H = lerp(h0 + (surface ? rfb * 0.6 : 0), finalH, rise);
  const Rt = lerp(rfb * 0.45, capR * 0.62, rise);
  const rt = lerp(rfb * 0.8, rtF, rise);
  const stemR = lerp(rfb * 0.3, capR * 0.1, rise);
  const stemTop = Math.max(10, H - rt * 0.55);
  const g = Math.min(1, Math.max(0.03, Math.pow(Math.max(tau, 0) / tFb, 0.4)));
  const after = Math.max(0, tau - tFb);
  return {
    top, capR, rfb, h0, surface, rise, H, Rt, rt, stemR, stemTop,
    heat: Math.exp(-tau / (tFb * 2.5 + 2.5)),
    fbR: rfb * g * (1 + 0.12 * Math.min(after, 4)),
    fbZ: tau < tFb ? h0 : Math.max(h0, H),
    fbTemp: Math.exp(-tau / (tFb * 1.7)),
    fbAmt: 1 - smoothstep(tFb * 1.1, tFb * 1.1 + 3.5, tau),
    appear: smoothstep(tFb * 0.5, tFb * 1.6 + 0.6, tau),
    stemGrow: surface ? smoothstep(0.2, 1.5, tau) : smoothstep(1.5, T * 0.7, tau),
    skirtR: lerp(rfb, capR * 1.15, rise),
    skirtAmt: surface ? smoothstep(0.3, 2, tau) * (1 - smoothstep(T, T * 4, tau)) : 0,
    late: 1 - smoothstep(180, 260, tau),
    drift: Math.max(0, tau - T * 0.4),
  };
}
