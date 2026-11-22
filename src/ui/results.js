/**
 * Painel de resultados (lado direito): anéis, danos a prédios, vítimas,
 * fallout (com regra 7-10), comparação e legenda com camadas liga/desliga.
 */
import { state } from '../state.js';
import { CONFIG, FALLOUT_COLORS } from '../config.js';
import { on } from '../util/events.js';
import { estimateCasualties, profileFromBuildings } from '../physics/casualties.js';
import { falloutContours, accumulatedDose, decayFactor } from '../physics/fallout.js';
import { TYPE_LABEL } from '../data/weapons.js';
import { unlock } from '../game/achievements.js';
import {
  fmtDist, fmtArea, fmtInt, fmtYield, fmtSci, fmtSig, fmtNum, fmtPct, escapeHtml,
} from '../util/format.js';

const $ = (id) => document.getElementById(id);

export function initResults({ layers, city, sim }) {
  const body = $('results-body');
  let cur = null; // { fx, stats, gz }
  let compare = null;
  let countries = null;
  let falloutT = 1;

  const casualtyProfile = () => {
    if (state.density === 'auto') {
      if (city.loaded && state.buildings.loadedRadiusM) {
        const p = profileFromBuildings(city.totalFloorArea(), state.buildings.loadedRadiusM / 1000);
        if (p.D0 > 50) return p;
      }
      return { ...CONFIG.casualties.densityProfiles.urbana, label: 'Urbana (padrão — carregue prédios para o modo automático)' };
    }
    return CONFIG.casualties.densityProfiles[state.density];
  };

  function ringsHtml(fx) {
    const rows = fx.rings.map((r) => `
      <div class="ring-row">
        <input type="checkbox" data-layer="${r.key}" ${layers.enabled.has(r.key) ? 'checked' : ''} aria-label="Mostrar ${escapeHtml(r.label)}" />
        <div>
          <div class="nm"><span class="sw" style="display:inline-block;vertical-align:-2px;background:${r.color}"></span> ${escapeHtml(r.label)}</div>
          <div class="ds">${escapeHtml(r.desc)}</div>
        </div>
        <div class="vals"><b>${fmtDist(r.radiusKm)}</b><br><span class="muted">${fmtArea(r.areaKm2)}</span></div>
      </div>`).join('');
    const hidden = ['blast20', 'blast10', 'blast5', 'blast3', 'blast1', 'rad500', 'thermal3', 'thermal2', 'thermal1']
      .filter((k) => !fx.rings.some((r) => r.key === k));
    const note = hidden.includes('rad500')
      ? '<p class="muted small">A radiação inicial de 500 rem não alcança o solo nesta altura de explosão.</p>' : '';
    return rows + note;
  }

  function buildingsHtml(stats) {
    if (!stats) {
      return `<p class="muted small">${state.buildings.loading ? '⏳ Carregando prédios… a contagem aparece quando chegarem.' : 'Carregue os prédios 3D (painel Alvo) para contar os danos prédio a prédio.'}</p>`;
    }
    const levels = [...CONFIG.damage].sort((a, b) => b.level - a.level);
    const max = Math.max(1, ...stats.counts);
    const bars = levels.map((d) => {
      const n = stats.counts[d.level];
      return `<div class="bar"><span class="sw" style="width:12px;height:12px;border-radius:3px;background:${d.color}"></span>
        <span>${escapeHtml(d.label)} <span class="muted">(${d.level ? `≥ ${d.min} psi` : '< 1 psi'})</span></span><b>${fmtInt(n)}</b>
        <div class="meter"><span style="width:${(100 * n) / max}%;background:${d.color}"></span></div></div>`;
    }).join('');
    return `<div class="dmg-bars">${bars}</div>
      <p class="muted small">${fmtInt(stats.total)} prédios analisados${stats.vaporized ? ` · ${fmtInt(stats.vaporized)} dentro da bola de fogo` : ''}${stats.debris ? ` · ${fmtInt(stats.debris)} blocos de destroços simulados` : ''}.</p>`;
  }

  function casualtiesHtml(fx) {
    const prof = casualtyProfile();
    const c = estimateCasualties(fx, prof);
    return `<div class="res-summary">
        <div class="stat"><div class="k">Mortos (estimativa)</div><div class="v">${fmtInt(Math.round(c.dead / 100) * 100)}</div></div>
        <div class="stat"><div class="k">Feridos (estimativa)</div><div class="v">${fmtInt(Math.round(c.injured / 100) * 100)}</div></div>
      </div>
      <p class="muted small">População na área de efeitos (até ${fmtDist(c.rMax)}): ~${fmtInt(Math.round(c.population / 1000) * 1000)} pessoas.
      Perfil: <b>${escapeHtml(prof.label)}</b> (${fmtInt(prof.D0)} hab/km² no centro).</p>
      <div class="warn-box">⚠️ Estimativa <b>grosseira</b>: ignora hora do dia, abrigos, tipo de construção, tempestades de fogo, fallout e colapso do atendimento médico. Use apenas como ordem de grandeza.</div>`;
  }

  function falloutDynHtml(fx) {
    const cs = falloutContours(fx.fallout.fissionYieldKt, fx.fallout.windKmh, fx.yieldKt, falloutT);
    const rows = cs.map((c) => `<tr>
        <td><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${FALLOUT_COLORS[c.level]}"></span> ${fmtInt(c.level)}</td>
        <td class="num">${fmtDist(c.L)}</td><td class="num">${fmtDist(c.B)}</td><td class="num">${fmtArea(c.area)}</td>
        <td class="num">${fmtInt(accumulatedDose(c.level * Math.pow(falloutT, 1.2), Math.max(1, falloutT), 168))}</td></tr>`).join('');
    const tLabel = falloutT < 24 ? `H+${fmtNum(falloutT, 1)} h` : `H+${fmtNum(falloutT / 24, 1)} dias`;
    return `<div class="lbl">Contornos no instante: <b>${tLabel}</b></div>
      <table class="fallout-table">
        <thead><tr><th>rad/h</th><th class="num">Alcance</th><th class="num">Largura</th><th class="num">Área</th><th class="num" title="Dose acumulada ao ar livre até 1 semana">Dose 1ª sem.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function falloutHtml(fx) {
    if (!fx.fallout.contours.length) {
      return `<p class="muted small">Sem fallout local significativo: a bola de fogo não toca o solo (explosão aérea). Os produtos de fissão sobem com a nuvem e se espalham globalmente em doses muito menores.</p>`;
    }
    const sevenTen = [1, 7, 49, 343].map((t) => `<td class="num">${fmtSig(1000 * decayFactor(t), 2)}</td>`).join('');
    return `<p class="small">Fissão contribuindo: <b>${fmtYield(fx.fallout.fissionYieldKt)}</b> · vento ${fmtInt(fx.fallout.windKmh)} km/h para ${Math.round(fx.fallout.downwindBearing)}°.</p>
      <label class="lbl" for="fallout-time">Tempo após a explosão (H+1 h → 2 semanas):</label>
      <input type="range" id="fallout-time" min="0" max="1000" value="${Math.round((Math.log(falloutT) / Math.log(336)) * 1000)}" />
      <div id="fallout-dyn">${falloutDynHtml(fx)}</div>
      <p class="muted small">Contornos = taxa de dose ≥ valor no instante escolhido. "Dose 1ª sem." = rad acumulados ao ar livre do instante até 7 dias (∫ D₁·t<sup>−1,2</sup> dt).</p>
      <h4 class="res-h">Regra 7-10 (decaimento)</h4>
      <table class="fallout-table"><thead><tr><th>Tempo</th><th class="num">1 h</th><th class="num">7 h</th><th class="num">2 dias</th><th class="num">2 semanas</th></tr></thead>
      <tbody><tr><td>rad/h</td>${sevenTen}</tr></tbody></table>
      <p class="muted small">A cada 7× mais tempo, a taxa de dose cai 10× (D ∝ t<sup>−1,2</sup>). Abrigar-se nas primeiras 24–48 h evita a maior parte da dose.</p>
      ${countries && countries.length ? `<p class="small">🌍 Países no eixo da pluma (1 rad/h): <b>${countries.map((c) => escapeHtml(c.name)).join(' → ')}</b></p>` : ''}`;
  }

  function compareHtml() {
    if (!compare) return '';
    const { fxA, fxB, nameA, nameB } = compare;
    const keys = ['fireball', 'blast20', 'blast5', 'blast1', 'thermal3', 'rad500'];
    const label = { fireball: 'Bola de fogo', blast20: '20 psi', blast5: '5 psi', blast1: '1 psi', thermal3: '3º grau', rad500: '500 rem' };
    const rows = keys.map((k) => {
      const a = fxA.radius[k]; const b = fxB.radius[k];
      return `<tr><td>${label[k]}</td><td class="num">${fmtDist(a)}</td><td class="num">${fmtDist(b)}</td><td class="num">${a > 0 ? `${fmtNum(b / a, 2)}×` : '—'}</td></tr>`;
    }).join('');
    return `<h3 class="res-h">⚖️ Comparação</h3>
      <table><thead><tr><th>Efeito</th><th class="num">A</th><th class="num">B</th><th class="num">B/A</th></tr></thead><tbody>
      <tr><td>Potência</td><td class="num">${fmtYield(fxA.yieldKt)}</td><td class="num">${fmtYield(fxB.yieldKt)}</td><td class="num">${fmtNum(fxB.yieldKt / fxA.yieldKt, 2)}×</td></tr>
      ${rows}</tbody></table>
      <p class="muted small">A = ${escapeHtml(nameA)} · B = ${escapeHtml(nameB)} (contornos tracejados). Note: ${fmtNum(fxB.yieldKt / fxA.yieldKt, 1)}× a potência dá só ${fmtNum(Math.cbrt(fxB.yieldKt / fxA.yieldKt), 2)}× o raio de choque.</p>`;
  }

  function legendHtml() {
    const dmg = [...CONFIG.damage].filter((d) => d.level > 0).sort((a, b) => b.level - a.level)
      .map((d) => `<div class="legend-item"><span class="sw" style="background:${d.color}"></span>${d.min}+ psi — ${escapeHtml(d.desc)}</div>`).join('');
    const fo = CONFIG.fallout.levels.map((l) => `<div class="legend-item"><span class="sw" style="background:${FALLOUT_COLORS[l]}"></span>${fmtInt(l)} rad/h (H+1)</div>`).join('');
    return `<h3 class="res-h">🗂️ Legenda e camadas</h3>
      <label class="check"><input type="checkbox" data-layer="labels" ${layers.enabled.has('labels') ? 'checked' : ''}/> Rótulos dos anéis</label>
      <label class="check"><input type="checkbox" data-layer="fallout" ${layers.enabled.has('fallout') ? 'checked' : ''}/> Fallout</label>
      <label class="check"><input type="checkbox" data-layer="buildings3d" ${city.object3d.visible ? 'checked' : ''}/> Prédios 3D e efeitos volumétricos</label>
      <div class="muted small" style="margin-top:6px">Danos aos prédios (sobrepressão):</div>${dmg}
      <div class="muted small" style="margin-top:6px">Fallout:</div>${fo}`;
  }

  function render() {
    if (!cur) return;
    const { fx } = cur;
    const b = fx.burst;
    const burstTxt = b.mode === 'surface' ? 'No solo' : b.mode === 'optimum' ? `Aérea ótima (${fmtInt(fx.hKm * 1000)} m)` : `Aérea a ${fmtInt(fx.hKm * 1000)} m`;
    body.innerHTML = `
      <div class="res-summary">
        <div class="stat"><div class="k">Arma</div><div class="v" style="font-size:13px">${escapeHtml(cur.weapon?.name || '—')}</div></div>
        <div class="stat"><div class="k">Potência</div><div class="v">${fmtYield(fx.yieldKt)}</div></div>
        <div class="stat"><div class="k">Energia</div><div class="v">${fmtSci(fx.energyJ)} J</div></div>
        <div class="stat"><div class="k">Explosão</div><div class="v" style="font-size:13px">${burstTxt}</div></div>
        <div class="stat"><div class="k">Tipo</div><div class="v" style="font-size:13px">${escapeHtml(TYPE_LABEL[cur.weapon?.type] || '—')} · ${fmtPct(fx.fissionFraction)} fissão</div></div>
        <div class="stat"><div class="k">Topo da nuvem</div><div class="v">${fmtDist(fx.cloud.topKm)}</div></div>
      </div>
      <h3 class="res-h">🎯 Anéis de efeito</h3>${ringsHtml(fx)}
      <h3 class="res-h">🏢 Danos às construções</h3>${buildingsHtml(cur.stats)}
      <h3 class="res-h">👥 Vítimas</h3>${casualtiesHtml(fx)}
      <h3 class="res-h">☢️ Fallout</h3>${falloutHtml(fx)}
      ${compareHtml()}
      ${legendHtml()}`;
    if (cur.stats && cur.stats.total - cur.stats.counts[0] > 1000) unlock('analise');
  }

  function renderPreviewOnlyCompare() {
    if (cur || !compare) return;
    body.innerHTML = compareHtml() + legendHtml();
  }

  body.addEventListener('change', (e) => {
    const k = e.target.dataset.layer;
    if (!k) return;
    if (k === 'buildings3d') {
      Object.values(sim3dObjects).forEach((o) => { o.object3d.visible = e.target.checked; });
      layers.map.triggerRepaint();
      return;
    }
    layers.setEnabled(k, e.target.checked);
  });
  body.addEventListener('input', (e) => {
    if (e.target.id !== 'fallout-time' || !cur) return;
    falloutT = Math.exp((Number(e.target.value) / 1000) * Math.log(336));
    const fx = cur.fx;
    layers.setFallout(fx, cur.gz, 1, falloutContours(fx.fallout.fissionYieldKt, fx.fallout.windKmh, fx.yieldKt, falloutT));
    const dyn = document.getElementById('fallout-dyn');
    if (dyn) dyn.innerHTML = falloutDynHtml(fx);
  });

  const sim3dObjects = {};
  on('sim:start', ({ fx, stats, gz }) => {
    cur = { fx, stats, gz, weapon: { ...state.weapon } };
    countries = null;
    falloutT = 1;
    render();
    if (matchMedia('(max-width: 900px)').matches === false && !state.cinema.active) $('panel-results').classList.remove('collapsed');
  });
  on('sim:stats', (stats) => { if (cur) { cur.stats = stats; const p = body.scrollTop; render(); body.scrollTop = p; } });
  on('density-changed', () => { const p = body.scrollTop; render(); body.scrollTop = p; });
  on('fallout-countries', (list) => { countries = list; const p = body.scrollTop; render(); body.scrollTop = p; });
  on('compare', (c) => { compare = c; if (cur) { const p = body.scrollTop; render(); body.scrollTop = p; } else renderPreviewOnlyCompare(); });
  on('cleared', () => {
    cur = null;
    body.innerHTML = '<div class="empty-state"><p>Escolha um alvo e pressione <b>DETONAR</b>.</p></div>';
  });

  return {
    registerObjects(objs) { Object.assign(sim3dObjects, objs); },
  };
}
