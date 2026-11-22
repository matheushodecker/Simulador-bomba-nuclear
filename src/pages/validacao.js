/**
 * Aba "Validação": compara os raios do modelo com valores de referência
 * publicados e com os danos documentados em Hiroshima e Nagasaki.
 * Todos os números do app são recalculados ao vivo a partir de src/config.js.
 */
import { CONFIG } from '../config.js';
import { computeEffects } from '../physics/effects.js';
import { estimateCasualties } from '../physics/casualties.js';
import { fmtYield, fmtDist, fmtArea, fmtInt, fmtNum, escapeHtml } from '../util/format.js';

const LABEL = {
  fireball: 'Bola de fogo (raio máx.)', blast20: '20 psi', blast10: '10 psi', blast5: '5 psi', blast1: '1 psi',
  thermal3: 'Queimaduras de 3º grau', rad500: 'Radiação 500 rem', cloudTop: 'Topo da nuvem',
};

function appValue(row) {
  const fx = computeEffects({ yieldKt: row.kt, burst: { mode: row.burst, heightM: row.heightM } });
  if (row.effect === 'cloudTop') return fx.cloud.topKm;
  return fx.radius[row.effect];
}

export function renderValidacao(el, ctx, first) {
  if (!first) return;
  const rows = CONFIG.validation.map((r) => {
    const v = appValue(r);
    const err = (v - r.ref) / r.ref;
    const cls = Math.abs(err) < 0.15 ? 'good' : Math.abs(err) < 0.35 ? 'mid' : 'bad';
    return `<tr>
      <td>${fmtYield(r.kt)}</td><td>${LABEL[r.effect]}</td>
      <td class="num"><b>${fmtDist(v)}</b></td><td class="num">${fmtDist(r.ref)}</td>
      <td class="num"><span class="err ${cls}">${err >= 0 ? '+' : ''}${fmtNum(err * 100, 0)}%</span></td>
      <td class="small muted">${escapeHtml(r.source)}</td></tr>`;
  }).join('');

  // tabela completa do modelo para 15 kt, 1 Mt e 50 Mt
  const yields = [15, 1000, 50000];
  const keys = ['fireball', 'blast20', 'blast10', 'blast5', 'blast3', 'blast1', 'thermal3', 'thermal2', 'thermal1', 'rad500'];
  const fxs = yields.map((W) => computeEffects({ yieldKt: W, burst: { mode: 'optimum' } }));
  const full = keys.map((k) => `<tr><td>${escapeHtml(fxs[0].rings.find((r) => r.key === k)?.label || LABEL[k] || k)}</td>${fxs.map((fx) => `<td class="num">${fx.radius[k] > 0 ? fmtDist(fx.radius[k]) : '—'}</td>`).join('')}</tr>`).join('');

  const hiro = computeEffects({ yieldKt: 15, burst: { mode: 'custom', heightM: 600 } });
  const naga = computeEffects({ yieldKt: 21, burst: { mode: 'custom', heightM: 503 } });
  const cas = (fx, key) => estimateCasualties(fx, CONFIG.casualties.densityProfiles[key]);
  const hU = cas(hiro, 'urbana'); const hM = cas(hiro, 'megacidade');
  const nU = cas(naga, 'urbana'); const nM = cas(naga, 'megacidade');
  const r100 = (x) => fmtInt(Math.round(x / 1000) * 1000);

  el.innerHTML = `
  <div class="page-wrap">
    <header class="page-hero">
      <h1>📏 Validação</h1>
      <p>Um modelo só é útil se soubermos <b>quanto confiar</b> nele. Aqui comparamos os números do simulador com valores publicados.
      Os valores do app são recalculados ao vivo a partir de <code>src/config.js</code>; as referências também ficam lá (<code>CONFIG.validation</code>) e podem ser revisadas.</p>
    </header>

    <section class="page-sec">
      <h2>Modelo × referências publicadas</h2>
      <div class="table-scroll"><table class="val-table">
        <thead><tr><th>Potência</th><th>Efeito</th><th class="num">App</th><th class="num">Referência</th><th class="num">Erro</th><th>Fonte da referência</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="muted small">Cores do erro: <span class="err good">&lt; 15%</span> <span class="err mid">15–35%</span> <span class="err bad">&gt; 35%</span>.
      Referências arredondadas; algumas vêm de relatos históricos (área destruída), não de medições de raio. Como os modelos públicos diferem entre si
      (ex.: OTA × NUKEMAP × FM 8-9), divergências de 20–40% são normais.</p>
      <div class="explain-box">
        <b>Leitura honesta dos resultados:</b>
        <ul>
          <li>As constantes de choque do enunciado (calibração tipo NUKEMAP) dão raios de 5 e 10 psi para 1 Mt <b>~20–30% menores</b> que os da tabela do OTA, que otimiza a altura para 10 psi e usa curvas diferentes.</li>
          <li>A fórmula 0,044·W<sup>0,4</sup> descreve o raio da bola de fogo num instante específico; manuais militares (FM 8-9) citam o diâmetro máximo luminoso, maior.</li>
          <li>Para a Tsar Bomba, os "100 km" de queimaduras são uma estimativa soviética para ar perfeitamente limpo; o modelo W<sup>0,41</sup> dá cerca da metade.</li>
        </ul>
      </div>
    </section>

    <section class="page-sec">
      <h2>Raios do modelo — explosão aérea em altura ótima</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>Efeito</th>${yields.map((W) => `<th class="num">${fmtYield(W)}</th>`).join('')}</tr></thead>
        <tbody>${full}</tbody>
      </table></div>
    </section>

    <section class="page-sec">
      <h2>Hiroshima e Nagasaki: modelo × danos documentados</h2>
      <div class="two-col">
        <article class="case">
          <h3>Hiroshima — 6/8/1945</h3>
          <p class="muted small">≈15 kt (incerteza ±20%) · explosão a ≈600 m</p>
          <table>
            <tr><td>5 psi (modelo)</td><td class="num"><b>${fmtDist(hiro.radius.blast5)}</b> · ${fmtArea(Math.PI * hiro.radius.blast5 ** 2)}</td></tr>
            <tr><td>3 psi (modelo)</td><td class="num">${fmtDist(hiro.radius.blast3)}</td></tr>
            <tr><td>Destruição quase total (documentado)</td><td class="num">≈ 1,6 km</td></tr>
            <tr><td>3º grau (modelo)</td><td class="num"><b>${fmtDist(hiro.radius.thermal3)}</b> · ${fmtArea(Math.PI * hiro.radius.thermal3 ** 2)}</td></tr>
            <tr><td>Área queimada (documentado)</td><td class="num">≈ 13 km²</td></tr>
            <tr><td>Mortos — modelo (urbana → megacidade)</td><td class="num">${r100(hU.dead)} – ${r100(hM.dead)}</td></tr>
            <tr><td>Mortos até o fim de 1945 (documentado)</td><td class="num">≈ 90.000 – 146.000</td></tr>
          </table>
        </article>
        <article class="case">
          <h3>Nagasaki — 9/8/1945</h3>
          <p class="muted small">≈21 kt · explosão a ≈500 m · cidade em vales</p>
          <table>
            <tr><td>5 psi (modelo)</td><td class="num"><b>${fmtDist(naga.radius.blast5)}</b> · ${fmtArea(Math.PI * naga.radius.blast5 ** 2)}</td></tr>
            <tr><td>Área destruída (documentado)</td><td class="num">≈ 6,7 km²</td></tr>
            <tr><td>3º grau (modelo)</td><td class="num">${fmtDist(naga.radius.thermal3)}</td></tr>
            <tr><td>Mortos — modelo (urbana → megacidade)</td><td class="num">${r100(nU.dead)} – ${r100(nM.dead)}</td></tr>
            <tr><td>Mortos até o fim de 1945 (documentado)</td><td class="num">≈ 60.000 – 80.000</td></tr>
          </table>
        </article>
      </div>
      <div class="explain-box">
        <p><b>O que a comparação mostra.</b> As áreas de destruição do modelo têm a mesma ordem de grandeza dos relatos: o anel de 5 psi de Nagasaki (${fmtArea(Math.PI * naga.radius.blast5 ** 2)})
        bate com os ≈6,7 km² destruídos; em Hiroshima, cidade plana com casas de madeira, a destruição foi além do anel de 5 psi, e os incêndios
        (tempestade de fogo) queimaram ≈13 km² — próximo da área de 3º grau do modelo.</p>
        <p>Já as <b>vítimas</b> do modelo ficam abaixo das contagens históricas: em 1945 muita gente estava ao ar livre ou junto a janelas, as casas eram
        inflamáveis, os hospitais foram destruídos e não havia tratamento para a doença da radiação. O modelo genérico de densidade e de exposição
        (25% ao ar livre) não captura isso — é um alerta sobre os limites de qualquer estimativa de vítimas.</p>
      </div>
    </section>

    <section class="page-sec">
      <h2>Limitações do modelo</h2>
      <ul class="limits">
        <li><b>Terreno plano:</b> morros, vales e prédios altos bloqueiam ou canalizam a onda de choque e fazem sombra à radiação térmica (Nagasaki é o exemplo clássico). O relevo 3D do mapa é apenas visual.</li>
        <li><b>Clima e visibilidade:</b> neblina, chuva, nuvens e neve mudam muito o alcance térmico (para mais ou para menos). O fallout real depende de cisalhamento do vento, chuva ("rainout") e do terreno — o modelo usa um vento único e elipses simplificadas.</li>
        <li><b>Tipos de construção:</b> os limiares de psi são médias. Concreto armado, alvenaria e madeira respondem de formas diferentes; alturas de prédios do OSM são frequentemente estimadas.</li>
        <li><b>Altura personalizada:</b> o efeito da altura de explosão é uma heurística calibrada nas curvas de Glasstone &amp; Dolan, não uma solução hidrodinâmica.</li>
        <li><b>Vítimas:</b> densidade populacional genérica, sem hora do dia, abrigos, incêndios em massa, fallout ou colapso do sistema de saúde. Incerteza de fator 2 ou mais.</li>
        <li><b>Animação:</b> o tempo é acelerado (exceto no modo "tempo real") e a nuvem/destroços são representações visuais, não simulações físicas detalhadas.</li>
      </ul>
    </section>
  </div>`;
}
