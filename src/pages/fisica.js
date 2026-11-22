/**
 * Aba "A Física" — explicações em nível de ensino médio/faculdade, com
 * ilustrações animadas e gráficos interativos. Apenas física geral e física
 * dos EFEITOS; nenhum parâmetro de projeto de armas.
 */
import { CONFIG } from '../config.js';
import { ENERGY_REFERENCES } from '../data/comparisons.js';
import { NUCLIDES, semfBA } from '../data/nuclides.js';
import { computeEffects } from '../physics/effects.js';
import { blastRadius, makeOverpressureFn, shockSpeed } from '../physics/blast.js';
import { decayFactor } from '../physics/fallout.js';
import { thermalPulsePower, thermalPulseFraction } from '../physics/thermal.js';
import { dynamicLoadFactor } from '../physics/structures.js';
import { lineChart, hBarLog } from '../ui/chart.js';
import { fmtSci, fmtYield, fmtSig, fmtDist, fmtNum, fmtTime } from '../util/format.js';

const C = CONFIG.units;
const sup = (e) => String(e).split('').map((c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]).join('');
const pow10 = (v) => `10${sup(Math.round(Math.log10(v)))}`;
const LOG_MIN = -2;
const LOG_MAX = 5;

export function renderFisica(el, ctx, first) {
  if (!first) return;
  el.innerHTML = `
  <div class="page-wrap physics">
    <header class="page-hero">
      <h1>⚛️ A Física</h1>
      <p>De onde vem a energia de uma explosão nuclear e por que cada efeito cresce de um jeito diferente com a potência.
      Nível ensino médio / início de faculdade. As fórmulas de escala desta página são <b>as mesmas</b> usadas pelo simulador.</p>
      <nav class="toc">
        <a href="#f-emc">1. E = mc²</a><a href="#f-ligacao">2. Energia de ligação</a><a href="#f-cadeia">3. Reação em cadeia</a>
        <a href="#f-fissao-fusao">4. Fissão × fusão</a><a href="#f-efeitos">5. Física dos efeitos</a><a href="#f-escala">6. Leis de escala</a>
        <a href="#f-ambiente">7. Simulação no ambiente</a>
      </nav>
    </header>

    <section class="phys-sec" id="f-emc">
      <h2>1. E = mc² e a escala de energia</h2>
      <div class="two-col">
        <div>
          <p>Em 1905, Einstein mostrou que massa e energia são equivalentes: <span class="formula">E = m·c²</span>, com
          c ≈ 3 × 10⁸ m/s. Como c² é enorme (9 × 10¹⁶ m²/s²), uma massa minúscula equivale a uma quantidade gigantesca de energia.</p>
          <p>Numa reação nuclear, a soma das massas dos produtos é ligeiramente <b>menor</b> que a dos reagentes. Essa diferença
          (o <i>defeito de massa</i>) aparece como energia cinética dos fragmentos, radiação e calor.</p>
          <p>Por convenção, <b>1 quiloton (kt) = 4,184 × 10¹² J</b> — a energia de mil toneladas de TNT.</p>
          <div class="calc">
            <label class="lbl" for="emc-slider">Potência: <b id="emc-yield"></b></label>
            <input type="range" id="emc-slider" min="0" max="1000" value="${Math.round(((Math.log10(15) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000)}" />
            <div class="calc-grid">
              <div><span class="k">Energia</span><b id="emc-J"></b></div>
              <div><span class="k">Massa convertida (Δm = E/c²)</span><b id="emc-m"></b></div>
              <div><span class="k">Em kWh</span><b id="emc-kwh"></b></div>
            </div>
          </div>
        </div>
        <div class="emc-anim" aria-hidden="true">
          <svg viewBox="-100 -100 200 200">
            <defs><radialGradient id="emcg"><stop offset="0" stop-color="#fff8e1"/><stop offset="0.5" stop-color="#ffb300"/><stop offset="1" stop-color="#ff6d00" stop-opacity="0"/></radialGradient></defs>
            ${Array.from({ length: 16 }, (_, i) => `<line class="ray" x1="0" y1="0" x2="0" y2="-80" transform="rotate(${i * 22.5})" style="animation-delay:${(i % 4) * 0.3}s"/>`).join('')}
            <circle class="emc-glow" r="60" fill="url(#emcg)"/>
            <circle class="emc-mass" r="16" fill="#90a4ae"/>
            <text y="4" text-anchor="middle" font-size="11" fill="#0b0f14" font-weight="700">m</text>
          </svg>
          <p class="muted small center">Uma fração mínima da massa vira energia irradiada.</p>
        </div>
      </div>
      <h3>Escada de energias (escala logarítmica)</h3>
      <p class="muted small">Cada marca da escala vale 100× a anterior. A linha mostra a potência escolhida acima.</p>
      <div id="energy-ladder"></div>
    </section>

    <section class="phys-sec" id="f-ligacao">
      <h2>2. Curva de energia de ligação por núcleon</h2>
      <p>Os prótons e nêutrons de um núcleo estão ligados pela força nuclear forte. A <b>energia de ligação por núcleon</b> (B/A)
      mede quão "firmemente" cada partícula está presa. Quanto mais alto na curva, mais estável o núcleo.</p>
      <p>O pico fica perto do <b>ferro-56 / níquel-62</b>. Por isso, existem <b>duas</b> maneiras de liberar energia: <b>juntar</b> núcleos leves
      (fusão, subindo a curva pela esquerda) ou <b>partir</b> núcleos muito pesados (fissão, subindo pela direita).</p>
      <div class="row">
        <button class="btn" id="be-fission">Mostrar fissão do U-235</button>
        <button class="btn" id="be-fusion">Mostrar fusão D + T</button>
      </div>
      <div id="be-chart"></div>
      <div id="be-explain" class="explain-box">Passe o mouse sobre a curva ou escolha um exemplo.</div>
    </section>

    <section class="phys-sec" id="f-cadeia">
      <h2>3. Reação em cadeia (conceito)</h2>
      <p>Quando um núcleo pesado se parte, ele libera energia e, em média, <b>2 a 3 nêutrons</b>. Se esses nêutrons provocarem novas fissões,
      o processo se repete: é a <b>reação em cadeia</b>. O que importa é o <b>fator de multiplicação k</b> — quantas novas fissões, em média,
      cada fissão provoca:</p>
      <ul>
        <li><b>k &lt; 1</b> (subcrítico): a cadeia se apaga.</li>
        <li><b>k = 1</b> (crítico): taxa constante — é assim que um <b>reator</b> opera, de forma controlada.</li>
        <li><b>k &gt; 1</b> (supercrítico): crescimento exponencial, N = k<sup>g</sup> após g gerações.</li>
      </ul>
      <div class="chain">
        <canvas id="chain-canvas" width="720" height="380" aria-label="Animação conceitual de reação em cadeia"></canvas>
        <div class="chain-side">
          <label class="lbl" for="chain-k">Fator k: <b id="chain-k-out">1,6</b> <span id="chain-state" class="badge"></span></label>
          <input type="range" id="chain-k" min="0.5" max="2.5" step="0.1" value="1.6" />
          <div class="row"><button class="btn primary" id="chain-start">▶ Iniciar</button><button class="btn" id="chain-reset">↺ Reiniciar</button></div>
          <div class="calc-grid"><div><span class="k">Geração</span><b id="chain-gen">0</b></div><div><span class="k">Fissões</span><b id="chain-count">0</b></div></div>
          <div id="chain-bars"></div>
        </div>
      </div>
      <p class="muted small">⚠️ Animação puramente conceitual: o espaço, o tempo e o número de núcleos são ilustrativos e não representam materiais, geometrias ou parâmetros reais.</p>
    </section>

    <section class="phys-sec" id="f-fissao-fusao">
      <h2>4. Fissão × fusão — e as armas, no nível histórico</h2>
      <div class="compare-cards">
        <article><h3>☢️ Fissão</h3>
          <p>Um núcleo pesado (urânio, plutônio) absorve um nêutron e se divide em dois núcleos médios, liberando ~200 MeV por evento — cerca de
          <b>50 milhões de vezes</b> mais que uma reação química típica (alguns eV).</p>
          <p>Armas de fissão (1945): Little Boy e Fat Man. Potências práticas de até centenas de kt.</p></article>
        <article><h3>☀️ Fusão</h3>
          <p>Núcleos leves (isótopos do hidrogênio) se unem formando hélio. A reação D + T libera 17,6 MeV — por unidade de massa, mais que a fissão.
          É a fonte de energia do Sol.</p>
          <p>Exige temperaturas de dezenas de milhões de graus. Nas armas <b>termonucleares</b> (a partir de 1952), a energia de uma explosão de fissão
          é usada para desencadear reações de fusão, permitindo potências de megatons.</p></article>
      </div>
      <h3>Linha do tempo</h3>
      <ol class="timeline">
        <li><b>1905</b> Einstein: E = mc².</li>
        <li><b>1932</b> Chadwick descobre o nêutron.</li>
        <li><b>1938</b> Hahn, Strassmann, Meitner e Frisch identificam a fissão nuclear.</li>
        <li><b>1942</b> Chicago Pile-1: primeira reação em cadeia controlada (k = 1).</li>
        <li><b>1945</b> Teste Trinity; bombardeios de Hiroshima e Nagasaki.</li>
        <li><b>1949</b> Primeiro teste soviético.</li>
        <li><b>1952</b> Ivy Mike: primeiro dispositivo termonuclear (10,4 Mt).</li>
        <li><b>1954</b> Castle Bravo: fallout atinge ilhas habitadas e um pesqueiro.</li>
        <li><b>1961</b> Tsar Bomba: 50 Mt, a maior explosão já feita.</li>
        <li><b>1963</b> Tratado de Proibição Parcial de Testes (fim dos testes atmosféricos para os signatários).</li>
        <li><b>1968</b> Tratado de Não Proliferação (TNP).</li>
        <li><b>1996</b> Tratado de Proibição Completa de Testes (CTBT) aberto a assinaturas.</li>
        <li><b>2017</b> Tratado sobre a Proibição de Armas Nucleares (TPNW) adotado na ONU.</li>
      </ol>
    </section>

    <section class="phys-sec" id="f-efeitos">
      <h2>5. Física dos efeitos</h2>
      <h3>Para onde vai a energia</h3>
      <p>Numa explosão aérea típica (Glasstone &amp; Dolan, §1.24), a energia se divide aproximadamente assim:</p>
      <div class="partition">
        <span style="flex:50;background:var(--series-1)">Onda de choque ~50%</span>
        <span style="flex:35;background:var(--series-2)">Térmica ~35%</span>
        <span style="flex:5;background:var(--series-3)" title="Radiação inicial ~5%">5%</span>
        <span style="flex:10;background:var(--series-4)" title="Radiação residual (fallout) ~10%">10%</span>
      </div>
      <div class="partition-legend muted small"><span><i style="background:var(--series-3)"></i>Radiação inicial ~5%</span><span><i style="background:var(--series-4)"></i>Radiação residual / fallout ~10%</span></div>

      <div class="effect-grid">
        <article>
          <h3>🔥 Bola de fogo</h3>
          <p>Em menos de um milionésimo de segundo, a energia aquece o material e o ar a dezenas de milhões de graus. O ar quente emite raios X que são
          absorvidos e reemitidos, formando uma esfera luminosa que cresce e sobe como um balão (empuxo).</p>
          <p class="formula">R<sub>máx</sub> ≈ ${fmtNum(CONFIG.fireball.R1_km, 3)} km · W<sup>${fmtNum(CONFIG.fireball.exponent, 3)}</sup></p>
          <p class="muted small">Se a bola de fogo toca o solo, ela vaporiza e suga terra e destroços, que se misturam aos produtos de fissão: nasce o fallout.</p>
        </article>
        <article>
          <h3>💨 Onda de choque</h3>
          <p>O ar superaquecido se expande violentamente e empurra uma camada de ar comprimido — a frente de choque — que se descola da bola de fogo
          e viaja mais rápido que o som. A grandeza que destrói prédios é a <b>sobrepressão de pico</b> (psi acima da pressão atmosférica).</p>
          <p class="formula">R(P) = R₁(P) · W<sup>1/3</sup> &nbsp;&nbsp; U = c₀ √(1 + 6p / 7P₀)</p>
          <p class="muted small">A raiz cúbica vem da geometria: a energia se espalha num <i>volume</i> (∝ R³). A velocidade U vem das relações de Rankine–Hugoniot;
          longe do centro a onda desacelera até ~340 m/s.</p>
        </article>
        <article>
          <h3>🌡️ Pulso térmico</h3>
          <p>A bola de fogo irradia luz e infravermelho por alguns segundos. A <b>fluência</b> (energia por área, cal/cm²) cai com o inverso do quadrado
          da distância e com a absorção da atmosfera. ~2–3 cal/cm² causam queimaduras de 1º grau; ~8–10, de 3º grau.</p>
          <p class="formula">Q ∝ W·τ / R² &nbsp;⇒&nbsp; R ≈ R₁ · W<sup>${fmtNum(CONFIG.thermal.exponent, 3)}</sup></p>
          <p class="muted small">O expoente (0,41) é menor que 0,5 porque pulsos mais longos (armas maiores) exigem mais fluência para o mesmo dano e a atmosfera absorve mais a grandes distâncias.</p>
        </article>
        <article>
          <h3>☢️ Radiação inicial</h3>
          <p>Nêutrons e raios gama emitidos no primeiro minuto. O ar os absorve exponencialmente (comprimento de relaxação de algumas centenas de metros):</p>
          <p class="formula">D(R) ∝ W · e<sup>−R/λ</sup> / R² &nbsp;⇒&nbsp; R<sub>500 rem</sub> ≈ ${fmtNum(CONFIG.radiation.R1_km_500rem, 3)} km · W<sup>${fmtNum(CONFIG.radiation.exponent, 3)}</sup></p>
          <p class="muted small">Por causa do termo exponencial, multiplicar W por 1000 aumenta o raio só ~3,7×. Em armas pequenas, a radiação é o efeito letal de maior alcance;
          em armas grandes, fica <i>dentro</i> da zona de destruição total.</p>
        </article>
        <article>
          <h3>🌫️ Fallout</h3>
          <p>Partículas radioativas que caem da nuvem nas horas seguintes, levadas pelo vento numa pluma alongada. A taxa de dose decai com o tempo:</p>
          <p class="formula">D(t) = D₁ · t<sup>−1,2</sup> &nbsp; (regra 7-10)</p>
          <p class="muted small">A cada 7× mais tempo, a taxa cai 10×: 1000 rad/h na hora 1 viram ~100 em 7 h, ~10 em 2 dias e ~1 em 2 semanas.</p>
        </article>
        <article>
          <h3>🏙️ Reflexão de Mach e altura ótima</h3>
          <p>Numa explosão aérea, a onda refletida pelo chão alcança a onda incidente e as duas se fundem numa frente vertical mais forte, o <b>tronco de Mach</b>.
          Por isso existe uma <b>altura ótima</b> para cada sobrepressão: alta demais, a onda chega fraca; baixa demais, a energia se concentra perto do centro.</p>
          <svg viewBox="0 0 300 140" class="mach-svg" aria-label="Diagrama de reflexão de Mach">
            <line x1="0" y1="125" x2="300" y2="125" stroke="var(--muted)"/>
            <circle cx="70" cy="40" r="5" fill="var(--series-2)"/><text x="78" y="36" class="dlabel">explosão</text>
            <path d="M 70 40 m -70 0 a 70 70 0 0 0 125 52" fill="none" stroke="var(--series-1)" stroke-width="2"/>
            <path d="M 132 95 Q 170 70 200 50" fill="none" stroke="var(--series-3)" stroke-width="2" stroke-dasharray="4 3"/>
            <line x1="215" y1="125" x2="215" y2="78" stroke="var(--series-4)" stroke-width="4"/>
            <circle cx="215" cy="78" r="4" fill="var(--text)"/>
            <text x="40" y="112" class="dlabel">incidente</text><text x="150" y="58" class="dlabel">refletida</text>
            <text x="222" y="108" class="dlabel">tronco de Mach</text><text x="222" y="78" class="dlabel">ponto triplo</text>
          </svg>
        </article>
      </div>

      <h3>Pulso de pressão num ponto (forma de Friedlander)</h3>
      <p>Num local atingido, a pressão sobe de repente ao pico P<sub>s</sub>, cai durante a <i>fase positiva</i> (vento forte para fora) e fica abaixo da
      atmosférica numa <i>fase negativa</i> (vento de retorno): <span class="formula">p(t) = P<sub>s</sub> (1 − t/t₊) e<sup>−b·t/t₊</sup></span></p>
      <div class="row"><label class="lbl" for="fr-dist">Distância (para 15 kt, altura ótima): <b id="fr-out"></b></label></div>
      <input type="range" id="fr-dist" min="200" max="5000" step="50" value="1300" />
      <div id="fr-chart"></div>

      <h3>Decaimento do fallout (regra 7-10)</h3>
      <div id="decay-chart"></div>
    </section>

    <section class="phys-sec" id="f-escala">
      <h2>6. Leis de escala — por que cada efeito cresce diferente</h2>
      <p>Raio de cada efeito em função da potência (eixos logarítmicos). Numa escala log-log, uma lei de potência R ∝ W<sup>n</sup> vira uma reta de inclinação n:
      choque (1/3), bola de fogo (0,4), calor (0,41) e radiação inicial (0,19, a mais plana).</p>
      <div id="scale-chart"></div>
      <div class="formula-box" id="formula-box"></div>
    </section>

    <section class="phys-sec" id="f-ambiente">
      <h2>7. Simulação dos efeitos no ambiente</h2>
      <p>No modo cinema, além das leis de escala, o simulador resolve equações da física do ar, do calor e das estruturas.
      Aqui está o que cada parte faz — e onde ela é uma aproximação.</p>
      <div class="effect-grid">
        <article>
          <h3>🌪️ Fluidos (Navier–Stokes)</h3>
          <p>O ar em volta da explosão é um grid 3D na GPU (até 128 × 128 × 160 células) resolvido pelo método <i>stable fluids</i>:
          advecção semi-lagrangiana (com correção de MacCormack), projeção de pressão para manter ∇·u = 0, e confinamento de vorticidade
          para não perder os redemoinhos.</p>
          <p class="formula">∂u/∂t + (u·∇)u = −∇p/ρ + b ẑ + f &nbsp;&nbsp; ∇·u = 0</p>
          <p class="muted small">É o que faz a fumaça girar no anel de vórtice, a haste ser sugada para cima e a nuvem tombar com o vento (que aumenta com a altura).</p>
        </article>
        <article>
          <h3>🎈 Subida da nuvem (térmica)</h3>
          <p>Uma célula do grid tem dezenas de metros: o núcleo quente se diluiria rápido demais. Por isso o núcleo segue um <b>modelo integral de térmica</b>
          (Morton, Taylor &amp; Turner, 1956), acoplado ao grid como o vórtice esférico de Hill:</p>
          <p class="formula">dz/dt = w &nbsp; da/dt = α|w| &nbsp; d(γVw)/dt = F &nbsp; dF/dt = −N²Vw</p>
          <p class="muted small">F₀ vem do calor deixado no ar (~35% da energia). α (entranhamento) e N (estratificação) são calibrados para a nuvem parar na altura
          das escalas públicas em alguns minutos — e saem na faixa medida em laboratório (α ≈ 0,1) e na atmosfera real (N ≈ 0,01 s⁻¹). Para 15 kt: sobe a ~100 m/s no início
          e estabiliza perto de 9 km em ~5 min.</p>
        </article>
        <article>
          <h3>🌡️ Temperatura e cor</h3>
          <p>A temperatura é um campo simulado: o ar quente sobe (empuxo de Boussinesq, b = g·θ'/θ₀), esfria por radiação (∝ T⁴, forte acima de ~2000 K)
          e por mistura. A cor da bola de fogo é a de um <b>corpo negro</b> — ~7 700 K no segundo máximo (G&amp;D §2.110), depois laranja e vermelho.</p>
          <p class="muted small">O chapéu fica branco porque o ar úmido que sobe acima do nível de condensação (~1–2 km) se expande, esfria e condensa. No início a nuvem é
          castanho-avermelhada: óxidos de nitrogênio formados no ar quente (G&amp;D §2.16).</p>
        </article>
        <article>
          <h3>⏱️ Pulso térmico no tempo</h3>
          <p>O calor não chega de uma vez: há um flash curtíssimo e um segundo máximo em t<sub>máx</sub>. A carbonização e os incêndios no 3D seguem a fração já emitida.</p>
          <p class="formula">t<sub>máx</sub> ≈ 0,0417·W<sup>0,44</sup> s &nbsp;&nbsp; P/P<sub>máx</sub> ≈ 2τ²/(1+τ⁴), τ = t/t<sub>máx</sub></p>
          <div id="pulse-chart"></div>
        </article>
        <article>
          <h3>🧱 Materiais: por que o vidro quebra antes</h3>
          <p>Cada elemento é tratado como um oscilador (massa-mola) com período natural T. Sob a fase positiva de duração t<sub>d</sub>, o deslocamento máximo é o estático
          vezes o <b>fator de carga dinâmica</b> (FCD), que vai de ≈ π·t<sub>d</sub>/T (pulso curto) a 2 (pulso longo).</p>
          <p class="formula">m·ẍ + k·x = P(t)·A &nbsp;&nbsp; P(t) = P<sub>s</sub>(1 − t/t<sub>d</sub>)</p>
          <div id="dlf-chart"></div>
          <p class="muted small">Vidro (T ≈ 0,02 s) é rígido e frágil: quebra a ~0,5–1 psi e vira estilhaço. Madeira cede (~3–5 psi), alvenaria racha e tomba, concreto armado
          e aço resistem muito mais. Explosões nucleares têm fase positiva longa (décimos de s a segundos), por isso destroem mais do que uma explosão química com o mesmo pico.</p>
        </article>
        <article>
          <h3>🏚️ Destruição estrutural (corpo rígido)</h3>
          <p>Os prédios perto da vista viram estrutura: painéis de parede por andar e trecho de fachada, e lajes divididas em placas, cada peça com a massa
          do seu material. A onda aplica <b>F = p(t)·A</b> (refletida nas fachadas de frente) e o vento da onda arrasta as peças soltas
          (<b>F = ½·ρ·C<sub>d</sub>·A·u²</b>); o motor de física (Rapier) cuida da gravidade e das colisões.</p>
          <p class="muted small">Uma peça só se solta quando a carga passa da resistência do material. Em paredes portantes (alvenaria, madeira), perder mais da
          metade das paredes de um andar derruba tudo acima ("panqueca"); em pórticos (concreto, aço) a fachada voa mas o esqueleto fica, a não ser sob
          pressões muito altas. Impactos fortes quebram peças presas e partem as soltas, levantando poeira.</p>
        </article>
        <article>
          <h3>🌍 Reflexão e vibração do solo</h3>
          <p>Ao bater no chão, a onda reflete: perto do marco zero a reflexão é regular; além de ~40° a refletida (mais rápida, no ar já comprimido) alcança a incidente e forma o
          <b>tronco de Mach</b>, cuja altura (ponto triplo) cresce com a distância. Uma parede voltada para a onda sente de 2× a 8× a sobrepressão (Rankine–Hugoniot).</p>
          <p class="formula">p<sub>r</sub> = 2p(7P₀ + 4p)/(7P₀ + p) &nbsp;&nbsp; v<sub>solo</sub> ≈ p/(ρ·c)</p>
          <p class="muted small">O solo vibra com velocidade de partícula ~p/(ρc) — alguns cm/s a 10 psi. Em explosões no solo, o tremor que viaja pelo terreno (~1 km/s)
          chega a pontos distantes antes da onda no ar.</p>
        </article>
      </div>
      <p class="muted small">Aproximações: o grid de fluidos não resolve a turbulência abaixo da célula (o ruído 3D só a sugere), a altura do ponto triplo é um modelo geométrico
      ilustrativo e os limiares por material são valores típicos de tabelas públicas — prédios reais variam muito.</p>
    </section>
  </div>`;

  setupEnergy(el);
  setupBinding(el);
  setupChain(el);
  setupFriedlander(el);
  setupDecay(el);
  setupScaling(el);
  setupPulse(el);
  setupDLF(el);
  el.querySelectorAll('.toc a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    el.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' });
  }));
}

/* ------------------------------------------------------------------ */
function setupEnergy(el) {
  const slider = el.querySelector('#emc-slider');
  const update = () => {
    const kt = 10 ** (LOG_MIN + (Number(slider.value) / 1000) * (LOG_MAX - LOG_MIN));
    const J = kt * C.KT_TO_J;
    const m = J / C.C ** 2;
    el.querySelector('#emc-yield').textContent = fmtYield(kt);
    el.querySelector('#emc-J').textContent = `${fmtSci(J)} J`;
    el.querySelector('#emc-m').textContent = m < 1e-3 ? `${fmtSig(m * 1e6, 3)} mg` : m < 1 ? `${fmtSig(m * 1e3, 3)} g` : `${fmtSig(m, 3)} kg`;
    el.querySelector('#emc-kwh').textContent = fmtSci(J / 3.6e6);
    const items = [...ENERGY_REFERENCES].sort((a, b) => a.J - b.J).map((r) => ({ ...r, highlight: r.J <= J }));
    hBarLog(el.querySelector('#energy-ladder'), {
      items, domain: [1e3, 1e18], marker: { J, label: fmtYield(kt) }, fmt: (v) => `${pow10(v)}`,
    });
  };
  slider.addEventListener('input', update);
  update();
}

/* ------------------------------------------------------------------ */
function setupBinding(el) {
  const curve = [];
  for (let A = 12; A <= 250; A += 2) curve.push([A, semfBA(A)]);
  const highlight = new Set(['He-4', 'Fe-56', 'U-235', 'H-2 (deutério)', 'H-3 (trítio)']);
  const draw = (extraDots = []) => {
    lineChart(el.querySelector('#be-chart'), {
      title: 'Energia de ligação por núcleon',
      series: [{ name: 'Modelo da gota líquida', points: curve }],
      xDomain: [0, 250], yDomain: [0, 9.5], xLabel: 'Número de massa A (prótons + nêutrons)', yLabel: 'B/A (MeV)',
      yFmt: (v) => fmtNum(v, 1), xFmt: (v) => fmtNum(v, 0), legend: false, height: 320,
      bands: [
        { x0: 1, x1: 56, fill: 'rgba(57,135,229,0.07)', label: '← fusão libera energia' },
        { x0: 56, x1: 250, fill: 'rgba(217,89,38,0.06)', label: 'fissão libera energia →' },
      ],
      dots: [
        ...NUCLIDES.map((n) => ({
          x: n.A, y: n.BA, r: highlight.has(n.name) ? 5 : 3.5, label: n.name,
          text: highlight.has(n.name) ? n.name.split(' ')[0] : '', anchor: n.A > 200 ? 'end' : 'start', dx: n.A > 200 ? -8 : 7,
          color: 'var(--series-1)',
        })),
        ...extraDots,
      ],
      tooltip: (xv, vals) => {
        const near = NUCLIDES.reduce((a, b) => (Math.abs(b.A - xv) < Math.abs(a.A - xv) ? b : a));
        return Math.abs(near.A - xv) < 6
          ? `<b>${near.name}</b><br>A = ${near.A}<br>B/A = ${fmtNum(near.BA, 3)} MeV`
          : `A ≈ ${fmtNum(xv, 0)}<br>modelo: ${vals[0] == null ? '—' : `${fmtNum(vals[0], 2)} MeV`}`;
      },
    });
  };
  draw();
  const box = el.querySelector('#be-explain');
  el.querySelector('#be-fission').addEventListener('click', () => {
    draw([
      { x: 95, y: 8.6, r: 6, color: 'var(--series-2)', text: 'fragmento ~95', dy: -10 },
      { x: 140, y: 8.4, r: 6, color: 'var(--series-2)', text: 'fragmento ~140', dy: -10 },
    ]);
    box.innerHTML = `<b>Fissão do U-235:</b> o núcleo (B/A ≈ 7,6 MeV) se divide em dois fragmentos médios (B/A ≈ 8,5 MeV) + 2 a 3 nêutrons.
      Ganho ≈ 235 × (8,5 − 7,6) ≈ <b>~200 MeV por fissão</b>. Uma reação química libera ~1 a 10 eV — dezenas de milhões de vezes menos.`;
  });
  el.querySelector('#be-fusion').addEventListener('click', () => {
    draw([{ x: 4, y: 7.074, r: 7, color: 'var(--series-2)', text: 'He-4 ✓', dx: 9 }]);
    box.innerHTML = `<b>Fusão D + T → He-4 + n:</b> B(He-4) − [B(D) + B(T)] = 4×7,074 − (2×1,112 + 3×2,827) ≈ <b>17,6 MeV</b>.
      Por núcleon participante (5), são ~3,5 MeV — cerca de 4× mais que a fissão (~0,85 MeV por núcleon). É por isso que a fusão "rende" mais por massa.`;
  });
}

/* ------------------------------------------------------------------ */
function setupChain(el) {
  const cv = el.querySelector('#chain-canvas');
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const kIn = el.querySelector('#chain-k');
  let nuclei; let neutrons; let frags; let gens; let running; let raf; let fissions;

  const reset = () => {
    nuclei = [];
    for (let i = 0; i < 16; i++) for (let j = 0; j < 9; j++) {
      nuclei.push({ x: 40 + i * 42 + (j % 2) * 18 + (Math.random() - 0.5) * 8, y: 30 + j * 40 + (Math.random() - 0.5) * 8, alive: true, flash: 0 });
    }
    neutrons = [];
    frags = [];
    gens = [];
    fissions = 0;
    running = false;
    cancelAnimationFrame(raf);
    el.querySelector('#chain-gen').textContent = '0';
    el.querySelector('#chain-count').textContent = '0';
    drawBars();
    frame();
  };

  const spawn = (x, y, gen) => {
    const k = Number(kIn.value);
    const n = Math.random() < 0.5 ? 2 : 3; // 2 a 3 nêutrons por fissão (média 2,5)
    const pEff = Math.min(1, k / 2.5);
    for (let i = 0; i < n; i++) {
      const effective = Math.random() < pEff;
      // prefere alvos próximos (entre os 10 núcleos intactos mais perto)
      const alive = nuclei.filter((q) => q.alive && !q.targeted)
        .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
      const target = effective && alive.length ? alive[Math.floor(Math.random() * Math.min(alive.length, 10))] : null;
      let tx; let ty;
      if (target) {
        target.targeted = true;
        tx = target.x; ty = target.y;
      } else {
        const a = Math.random() * Math.PI * 2;
        tx = x + Math.cos(a) * 900; ty = y + Math.sin(a) * 900;
      }
      const d = Math.hypot(tx - x, ty - y) || 1;
      const sp = 2.2 + Math.random() * 0.8;
      neutrons.push({ x, y, vx: ((tx - x) / d) * sp, vy: ((ty - y) / d) * sp, target, gen, life: 400 });
    }
  };

  const fission = (q, gen) => {
    q.alive = false;
    q.flash = 1;
    fissions++;
    gens[gen] = (gens[gen] || 0) + 1;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      frags.push({ x: q.x, y: q.y, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, life: 60 });
    }
    spawn(q.x, q.y, gen + 1);
    el.querySelector('#chain-gen').textContent = String(gen);
    el.querySelector('#chain-count').textContent = String(fissions);
    drawBars();
  };

  const drawBars = () => {
    const host = el.querySelector('#chain-bars');
    const max = Math.max(1, ...gens.filter(Boolean));
    host.innerHTML = `<div class="lbl">Fissões por geração</div><div class="gen-bars">${gens.map((n, i) => `<span title="Geração ${i}: ${n || 0}" style="height:${(100 * (n || 0)) / max}%"></span>`).join('')}</div>`;
  };

  const frame = () => {
    g.fillStyle = '#0d131a';
    g.fillRect(0, 0, W, H);
    for (const q of nuclei) {
      if (q.alive) {
        g.beginPath(); g.arc(q.x, q.y, 9, 0, Math.PI * 2);
        g.fillStyle = '#3987e5'; g.fill();
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(q.x - 3, q.y - 3, 3, 0, Math.PI * 2); g.fill();
      } else if (q.flash > 0) {
        g.beginPath(); g.arc(q.x, q.y, 9 + (1 - q.flash) * 22, 0, Math.PI * 2);
        g.fillStyle = `rgba(255,190,60,${q.flash * 0.7})`; g.fill();
        q.flash -= 0.03;
      }
    }
    for (const f of frags) {
      f.x += f.vx; f.y += f.vy; f.life--;
      g.beginPath(); g.arc(f.x, f.y, 5, 0, Math.PI * 2);
      g.fillStyle = `rgba(217,89,38,${Math.max(0, f.life / 60)})`; g.fill();
    }
    frags = frags.filter((f) => f.life > 0);
    if (running) {
      for (const n of neutrons) {
        n.x += n.vx; n.y += n.vy; n.life--;
        if (n.target && n.target.alive && Math.hypot(n.x - n.target.x, n.y - n.target.y) < 9) {
          fission(n.target, n.gen);
          n.dead = true;
        }
        if (n.x < -10 || n.y < -10 || n.x > W + 10 || n.y > H + 10 || n.life <= 0) n.dead = true;
      }
      neutrons = neutrons.filter((n) => !n.dead);
    }
    for (const n of neutrons) {
      g.beginPath(); g.arc(n.x, n.y, 2.6, 0, Math.PI * 2);
      g.fillStyle = n.target ? '#f0efec' : 'rgba(240,239,236,0.45)'; g.fill();
    }
    if (running && !neutrons.length) {
      running = false;
      const left = nuclei.filter((q) => q.alive).length;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, H / 2 - 22, W, 44);
      g.fillStyle = '#ffb300'; g.font = '600 16px system-ui'; g.textAlign = 'center';
      g.fillText(left ? 'A cadeia se extinguiu (nêutrons perdidos).' : 'Todos os núcleos fissionaram.', W / 2, H / 2 + 5);
    }
    if (running || frags.length || nuclei.some((q) => q.flash > 0)) raf = requestAnimationFrame(frame);
  };

  const updK = () => {
    const k = Number(kIn.value);
    el.querySelector('#chain-k-out').textContent = fmtNum(k, 1);
    const st = el.querySelector('#chain-state');
    st.textContent = k < 0.95 ? 'subcrítico' : k <= 1.05 ? 'crítico' : 'supercrítico';
    st.className = `badge ${k < 0.95 ? 'fissao' : k <= 1.05 ? 'reforcada' : 'termonuclear'}`;
  };
  kIn.addEventListener('input', updK);
  el.querySelector('#chain-start').addEventListener('click', () => {
    reset();
    running = true;
    const first = nuclei[Math.floor(nuclei.length / 2)];
    first.targeted = true;
    neutrons.push({ x: -5, y: first.y, vx: 2.6 * ((first.x + 5) / Math.hypot(first.x + 5, 0.01)), vy: 0, target: first, gen: 0, life: 900 });
    frame();
  });
  el.querySelector('#chain-reset').addEventListener('click', reset);
  updK();
  reset();
}

/* ------------------------------------------------------------------ */
function setupFriedlander(el) {
  const input = el.querySelector('#fr-dist');
  const psiAt = makeOverpressureFn(15, { mode: 'optimum' });
  const draw = () => {
    const d = Number(input.value) / 1000;
    const Ps = psiAt(d);
    el.querySelector('#fr-out').textContent = `${fmtDist(d)} → pico ≈ ${fmtSig(Ps, 2)} psi · frente a ${fmtNum(shockSpeed(Ps) * 1000, 0)} m/s`;
    const b = 1.2;
    const pts = [[-0.2, 0], [0, 0]];
    for (let t = 0; t <= 3.5; t += 0.02) pts.push([t, Ps * (1 - t) * Math.exp(-b * t)]);
    lineChart(el.querySelector('#fr-chart'), {
      series: [{ name: 'sobrepressão', points: pts }],
      xDomain: [-0.2, 3.5], yDomain: [Math.min(-0.15 * Ps, -0.5), Ps * 1.08],
      xLabel: 'tempo / duração da fase positiva (t / t₊)', yLabel: 'p (psi)', legend: false, height: 240,
      xFmt: (v) => fmtNum(v, 1), yFmt: (v) => fmtSig(v, 2),
      tooltip: (xv, v) => `t/t₊ = ${fmtNum(xv, 2)}<br>p = ${v[0] == null ? '—' : `${fmtSig(v[0], 2)} psi`}${v[0] < 0 ? '<br><i>fase negativa (sucção)</i>' : ''}`,
    });
  };
  input.addEventListener('input', draw);
  draw();
}

/* ------------------------------------------------------------------ */
function setupDecay(el) {
  const pts = [];
  for (let e = 0; e <= 3.2; e += 0.04) { const t = 10 ** e; pts.push([t, 1000 * decayFactor(t)]); }
  lineChart(el.querySelector('#decay-chart'), {
    series: [{ name: 'taxa de dose', points: pts }],
    xDomain: [1, 1500], yDomain: [0.1, 1000], xLog: true, yLog: true, legend: false, height: 260,
    xLabel: 'horas após a explosão', yLabel: 'rad/h (partindo de 1000 em H+1)',
    xFmt: (v) => (v < 1 ? fmtNum(v, 2) : fmtNum(v, 0)), yFmt: (v) => fmtSig(v, 2),
    dots: [1, 7, 49, 343].map((t, i) => ({ x: t, y: 1000 * decayFactor(t), text: ['1 h', '7 h', '2 dias', '2 sem.'][i], color: 'var(--series-2)', r: 5 })),
    tooltip: (xv, v) => `${xv < 48 ? `${fmtNum(xv, 1)} h` : `${fmtNum(xv / 24, 1)} dias`}<br>${v[0] == null ? '—' : `${fmtSig(v[0], 2)} rad/h`}`,
  });
}

/* ------------------------------------------------------------------ */
function setupScaling(el) {
  const Ws = [];
  for (let e = -2; e <= 5.001; e += 0.05) Ws.push(10 ** e);
  const opt = { mode: 'optimum' };
  const series = [
    { name: 'Bola de fogo', f: (W) => CONFIG.fireball.R1_km * W ** CONFIG.fireball.exponent },
    { name: '5 psi', f: (W) => blastRadius(5, W, opt) },
    { name: '3º grau', f: (W) => CONFIG.thermal.R1_km.third * W ** CONFIG.thermal.exponent },
    { name: '500 rem', f: (W) => CONFIG.radiation.R1_km_500rem * W ** CONFIG.radiation.exponent },
  ].map((s) => ({ name: s.name, points: Ws.map((W) => [W, s.f(W)]) }));
  lineChart(el.querySelector('#scale-chart'), {
    series, xLog: true, yLog: true, xDomain: [0.01, 1e5], yDomain: [0.005, 200], directLabels: true, height: 340,
    xLabel: 'potência (kt)', yLabel: 'raio (km)',
    xFmt: (v) => (v < 1 ? `${fmtNum(v * 1000, 0)} t` : v < 1000 ? `${fmtNum(v, 0)} kt` : `${fmtNum(v / 1000, 0)} Mt`),
    yFmt: (v) => (v < 1 ? `${fmtNum(v * 1000, 0)} m` : `${fmtNum(v, 0)} km`),
    tooltip: (xv, vals, ss) => `<b>${fmtYield(xv)}</b><br>${vals.map((v, i) => `<i class="tip-sw" style="background:${ss[i].color}"></i>${ss[i].name}: ${v == null ? '—' : fmtDist(v)}`).join('<br>')}`,
  });
  const fx = computeEffects({ yieldKt: 1000, burst: { mode: 'optimum' } });
  el.querySelector('#formula-box').innerHTML = `
    <h3>Fórmulas usadas no simulador (de <code>src/config.js</code>)</h3>
    <ul>
      <li>Bola de fogo: R = ${fmtNum(CONFIG.fireball.R1_km, 3)} km · W<sup>${fmtNum(CONFIG.fireball.exponent, 3)}</sup> (×${fmtNum(CONFIG.fireball.surfaceFactor, 3)} no solo)</li>
      <li>Choque (altura ótima): R = R₁ · W<sup>1/3</sup> com R₁ = 0,22 km (20 psi), 0,53 km (5 psi), 1,4 km (1 psi); no solo ×${fmtNum(CONFIG.blast.groundFactor, 3)}</li>
      <li>Térmica: R = R₁ · W<sup>${fmtNum(CONFIG.thermal.exponent, 3)}</sup> com R₁ = ${fmtNum(CONFIG.thermal.R1_km.third, 3)} km (3º), ${fmtNum(CONFIG.thermal.R1_km.second, 3)} km (2º), ${fmtNum(CONFIG.thermal.R1_km.first, 3)} km (1º)</li>
      <li>Radiação inicial (500 rem): R = ${fmtNum(CONFIG.radiation.R1_km_500rem, 3)} km · W<sup>${fmtNum(CONFIG.radiation.exponent, 3)}</sup></li>
      <li>Velocidade do choque: U = c₀ √(1 + 6p/7P₀), c₀ = 340 m/s — 1 psi em ${fmtTime(fx.arrivalAt(fx.radius.blast1))} para 1 Mt</li>
      <li>Fallout: D(t) = D₁ · t<sup>−${fmtNum(CONFIG.fallout.decayExponent, 3)}</sup>; contornos elípticos ∝ W<sub>fissão</sub><sup>0,5</sup></li>
    </ul>`;
}

/* ------------------------------------------------------------------ */
function setupPulse(el) {
  const P = []; const F = [];
  for (let e = -1.3; e <= 1.6; e += 0.02) { const t = 10 ** e; P.push([t, thermalPulsePower(t)]); F.push([t, thermalPulseFraction(t)]); }
  lineChart(el.querySelector('#pulse-chart'), {
    series: [{ name: 'potência P/Pmáx', points: P }, { name: 'energia já emitida', points: F }],
    xDomain: [0.05, 40], yDomain: [0, 1], xLog: true, directLabels: true, height: 220,
    xLabel: 't / tmáx', yLabel: 'fração',
    xFmt: (v) => fmtSig(v, 2), yFmt: (v) => `${fmtNum(v * 100, 0)}%`,
    tooltip: (xv, v) => `t = ${fmtSig(xv, 2)}·t<sub>máx</sub><br>P = ${fmtNum((v[0] ?? 0) * 100, 0)}% · emitido ${fmtNum((v[1] ?? 0) * 100, 0)}%`,
  });
}

function setupDLF(el) {
  const pts = [];
  for (let e = -2; e <= 2; e += 0.04) { const r = 10 ** e; pts.push([r, dynamicLoadFactor(r)]); }
  lineChart(el.querySelector('#dlf-chart'), {
    series: [{ name: 'FCD', points: pts }],
    xDomain: [0.01, 100], yDomain: [0, 2.1], xLog: true, legend: false, height: 220,
    xLabel: 'td / T (duração da carga ÷ período natural)', yLabel: 'fator de carga dinâmica',
    xFmt: (v) => fmtSig(v, 1), yFmt: (v) => fmtNum(v, 1),
    dots: [['vidro', 0.5 / 0.02], ['madeira', 0.5 / 0.12], ['concreto', 0.5 / 0.35], ['aço', 0.5 / 0.6]].map(([n, r]) => ({ x: r, y: dynamicLoadFactor(r), text: n, color: 'var(--series-2)', r: 4 })),
    tooltip: (xv, v) => `td/T = ${fmtSig(xv, 2)}<br>FCD = ${fmtSig(v[0] ?? 0, 3)}`,
  });
}
