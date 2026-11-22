/**
 * Vento atual — Open-Meteo (https://open-meteo.com), sem chave de API.
 * O fallout é transportado principalmente por ventos em altitude; usamos a média
 * vetorial de 850 hPa (~1,5 km) e 500 hPa (~5,5 km) quando disponível.
 */
import { fetchJson } from './http.js';

function vecAvg(list) {
  // direção meteorológica = de onde o vento SOPRA
  let u = 0; let v = 0;
  for (const { speed, dir } of list) {
    const th = (dir * Math.PI) / 180;
    u += -speed * Math.sin(th);
    v += -speed * Math.cos(th);
  }
  u /= list.length; v /= list.length;
  const speed = Math.hypot(u, v);
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speed, dir };
}

export async function fetchWind(lat, lng) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
    + '&current=wind_speed_10m,wind_direction_10m'
    + '&hourly=wind_speed_850hPa,wind_direction_850hPa,wind_speed_500hPa,wind_direction_500hPa'
    + '&wind_speed_unit=kmh&forecast_days=1&timezone=GMT';
  const d = await fetchJson(url, { timeoutMs: 15000 });
  const surface = { speed: d.current?.wind_speed_10m ?? 0, dir: d.current?.wind_direction_10m ?? 0 };
  let aloft = null;
  const h = d.hourly;
  if (h && h.time && h.wind_speed_850hPa) {
    const now = Date.now();
    let best = 0;
    let bestDt = Infinity;
    h.time.forEach((t, i) => {
      const dt = Math.abs(Date.parse(`${t}Z`) - now);
      if (dt < bestDt) { bestDt = dt; best = i; }
    });
    const l850 = { speed: h.wind_speed_850hPa[best], dir: h.wind_direction_850hPa[best] };
    const l500 = { speed: h.wind_speed_500hPa?.[best], dir: h.wind_direction_500hPa?.[best] };
    const valid = [l850, l500].filter((x) => Number.isFinite(x.speed) && Number.isFinite(x.dir));
    if (valid.length) aloft = { ...vecAvg(valid), levels: { h850: l850, h500: l500 } };
  }
  return { surface, aloft, effective: aloft || surface };
}
