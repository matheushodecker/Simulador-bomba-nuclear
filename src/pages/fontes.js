/** Aba "Fontes". */
export function renderFontes(el, ctx, first) {
  if (!first) return;
  el.innerHTML = `
  <div class="page-wrap">
    <header class="page-hero">
      <h1>📚 Fontes</h1>
      <p>Todo o modelo usa apenas literatura pública e dados abertos.</p>
    </header>
    <section class="page-sec sources">
      <h2>Física dos efeitos</h2>
      <ul>
        <li><b>Glasstone, S. &amp; Dolan, P. J. (1977).</b> <i>The Effects of Nuclear Weapons</i>, 3ª ed. U.S. Department of Defense / Energy Research and Development Administration.
          Texto integral: <a href="https://www.fourmilab.ch/etexts/www/effects/" target="_blank" rel="noopener">fourmilab.ch/etexts/www/effects</a>.
          Base das leis de escala, das curvas de sobrepressão, do pulso térmico, da radiação inicial e da regra 7-10.</li>
        <li><b>Wellerstein, A.</b> <i>NUKEMAP</i>. <a href="https://nuclearsecrecy.com/nukemap/" target="_blank" rel="noopener">nuclearsecrecy.com/nukemap</a> — inspiração e calibração dos raios de referência.</li>
        <li><b>U.S. Congress, Office of Technology Assessment (1979).</b> <i>The Effects of Nuclear War</i>. <a href="https://ota.fas.org/reports/7906.pdf" target="_blank" rel="noopener">ota.fas.org/reports/7906.pdf</a> — mortalidade por faixa de sobrepressão.</li>
        <li><b>U.S. Army FM 8-9</b>, Parte I, Cap. 3 (efeitos nucleares). <a href="https://nuke.fas.org/guide/usa/doctrine/dod/fm8-9/1ch3.htm" target="_blank" rel="noopener">nuke.fas.org</a>.</li>
      </ul>
      <h2>Simulação no ambiente (modo cinema)</h2>
      <ul>
        <li><b>Stam, J. (1999).</b> "Stable Fluids". <i>SIGGRAPH 99</i> — método de fluidos incompressíveis usado no grid da GPU.</li>
        <li><b>Fedkiw, R., Stam, J. &amp; Jensen, H. W. (2001).</b> "Visual Simulation of Smoke". <i>SIGGRAPH 2001</i> — empuxo e confinamento de vorticidade.</li>
        <li><b>Selle, A. et al. (2008).</b> "An Unconditionally Stable MacCormack Method". <i>J. Sci. Comput.</i> 35 — advecção de 2ª ordem com limitador.</li>
        <li><b>Morton, B. R., Taylor, G. I. &amp; Turner, J. S. (1956).</b> "Turbulent gravitational convection from maintained and instantaneous sources". <i>Proc. R. Soc. A</i> 234 — modelo integral da térmica (subida da nuvem).</li>
        <li><b>Hill, M. J. M. (1894).</b> "On a spherical vortex". <i>Phil. Trans. R. Soc. A</i> 185 — vórtice esférico usado para acoplar a térmica ao grid.</li>
        <li><b>Kinney, G. F. &amp; Graham, K. J. (1985).</b> <i>Explosive Shocks in Air</i>, 2ª ed. Springer — duração da fase positiva.</li>
        <li><b>Biggs, J. M. (1964).</b> <i>Introduction to Structural Dynamics</i>. McGraw-Hill — oscilador de 1 grau de liberdade e fator de carga dinâmica.</li>
        <li>Glasstone &amp; Dolan (1977): §2.110 (temperatura da bola de fogo), §2.16 (cor da nuvem), §3.25–3.34 (reflexão de Mach), §3.56 (reflexão normal), §7.85–7.88 (pulso térmico no tempo), cap. 5 (danos por tipo de estrutura).</li>
      </ul>
      <h2>História</h2>
      <ul>
        <li><b>Atomic Heritage Foundation / National Museum of Nuclear Science &amp; History.</b> <a href="https://ahf.nuclearmuseum.org/" target="_blank" rel="noopener">ahf.nuclearmuseum.org</a> — histórico das armas e testes (incl. Tsar Bomba).</li>
        <li><b>Manhattan Engineer District (1946).</b> <i>The Atomic Bombings of Hiroshima and Nagasaki</i>. <a href="https://www.gutenberg.org/ebooks/685" target="_blank" rel="noopener">Project Gutenberg</a>.</li>
        <li><b>U.S. Strategic Bombing Survey (1946).</b> <i>The Effects of Atomic Bombs on Hiroshima and Nagasaki</i>.</li>
        <li><b>Cidade de Hiroshima</b> — publicações sobre os danos da bomba atômica (área queimada ≈13 km²).</li>
        <li><b>Radiation Effects Research Foundation (RERF).</b> <a href="https://www.rerf.or.jp/en/" target="_blank" rel="noopener">rerf.or.jp</a> — estudos de longo prazo com sobreviventes.</li>
        <li><b>Nuclear Weapon Archive</b> (Carey Sublette). <a href="https://nuclearweaponarchive.org/" target="_blank" rel="noopener">nuclearweaponarchive.org</a>.</li>
      </ul>
      <h2>Dados e software</h2>
      <ul>
        <li>Mapa e prédios: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© colaboradores do OpenStreetMap</a> (ODbL), via
          <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, <a href="https://overpass-api.de" target="_blank" rel="noopener">Overpass API</a> e
          <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a>.</li>
        <li>Imagens de satélite: Esri World Imagery (Esri, Maxar, Earthstar Geographics e comunidade GIS).</li>
        <li>Relevo: AWS Terrain Tiles (Mapzen, dados SRTM e outros).</li>
        <li>Vento: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0).</li>
        <li>Renderização: <a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre GL JS</a> e <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a>.
          Ruído simplex GLSL: Ashima Arts / Ian McEwan (MIT).</li>
      </ul>
      <div class="explain-box">
        <b>Propósito.</b> Esta é uma ferramenta educacional para compreender a escala e a natureza dos efeitos de armas nucleares — o mesmo espírito do NUKEMAP.
        Ela não contém, e não deve conter, nenhuma informação sobre o projeto ou o funcionamento interno de armas.
      </div>
    </section>
  </div>`;
}
