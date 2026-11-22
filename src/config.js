/**
 * CONFIG — todas as constantes físicas e de calibração do simulador.
 * ---------------------------------------------------------------------------
 * Edite aqui para recalibrar o modelo. Cada bloco cita a fonte pública usada.
 *
 * Fontes principais:
 *  [G&D]  Glasstone, S. & Dolan, P. J. (1977). The Effects of Nuclear Weapons,
 *         3ª ed. U.S. DoD / ERDA. (Cap. 2: bola de fogo; Cap. 3: onda de choque;
 *         Cap. 7: radiação térmica; Cap. 8: radiação inicial; Cap. 9: fallout.)
 *  [NUK]  Wellerstein, A. NUKEMAP — https://nuclearsecrecy.com/nukemap/
 *  [OTA]  U.S. Congress, Office of Technology Assessment (1979).
 *         The Effects of Nuclear War. https://ota.fas.org/reports/7906.pdf
 *  [FM89] U.S. Army FM 8-9, Part I, Cap. 3 — https://nuke.fas.org/guide/usa/doctrine/dod/fm8-9/1ch3.htm
 *
 * Convenções: potência W em quilotons (kt); distâncias em km salvo indicação.
 * "R1" = raio de referência para 1 kt.
 */
export const CONFIG = {
  /* ------------------------------------------------------------------ */
  units: {
    KT_TO_J: 4.184e12,          // 1 kt de TNT = 4,184 × 10¹² J (definição convencional)
    C: 299_792_458,             // velocidade da luz (m/s)
    MEV_TO_J: 1.602176634e-13,  // 1 MeV em joules
  },

  yield: {
    minKt: 0.01,     // 10 toneladas
    maxKt: 100_000,  // 100 Mt
    defaultKt: 15,
  },

  /* ------------------------------------------------------------------ */
  /** Bola de fogo — raio máximo R = R1 · W^0,4  [G&D Cap. 2; NUKEMAP] */
  fireball: {
    R1_km: 0.044,        // ≈ 145 ft para 1 kt
    exponent: 0.4,
    // Explosão de superfície: reflexão no solo aumenta a bola de fogo
    // (aprox. fator 2^(1/3) ≈ 1,26, como se a energia fosse "dobrada" num hemisfério).
    surfaceFactor: 1.26,
    // Tempo até o raio máximo (apenas para animação): ~1 s para 20 kt, ~10 s para 1 Mt [FM89, G&D]
    tMax_s_1kt: 0.17,
    tMaxExponent: 0.59,
  },

  /* ------------------------------------------------------------------ */
  /**
   * Onda de choque (sobrepressão de pico) — lei de escala cúbica [G&D §3.60]:
   *     R(P, W) = R1(P) · W^(1/3)
   * Tabela de R1 (km) para explosão AÉREA em ALTURA ÓTIMA (envoltória das curvas
   * de altura de explosão de G&D, Fig. 3.73), calibrada como no NUKEMAP:
   *     20 psi ≈ 0,22 km   5 psi ≈ 0,53 km   1 psi ≈ 1,4 km
   * Os demais pontos foram interpolados/extrapolados em escala log-log.
   */
  blast: {
    table1kt: [
      // [psi, R1 km]
      [200, 0.0515],
      [100, 0.0793],
      [50, 0.123],
      [20, 0.22],   // calibração
      [10, 0.341],
      [5, 0.53],    // calibração
      [3, 0.722],
      [2, 0.922],
      [1, 1.40],    // calibração
      [0.5, 2.6],
      [0.2, 6.2],
    ],
    // Explosão no solo: raios ~20–30% menores que na altura ótima [G&D Fig. 3.73/3.74]
    groundFactor: 0.75,
    // Altura ótima para cada sobrepressão ≈ k · R_ótimo(P). Com k = 0,45, a altura ótima
    // para 5 psi com 15 kt fica ≈ 590 m (Hiroshima: ~580–600 m).
    optimumHeightRatio: 0.45,
    // Acima de ~3× a altura ótima, aquela sobrepressão não chega ao solo (heurística).
    maxHeightRatio: 3.0,
    ambientPsi: 14.7,       // pressão atmosférica ao nível do mar (psi)
    soundSpeed_kms: 0.34,   // velocidade do som (km/s) ≈ 340 m/s
    // Velocidade da frente de choque (Rankine–Hugoniot, ar γ=1,4) [G&D eq. 3.55.1]:
    //     U = c0 · sqrt(1 + 6p / (7 P0))
    shockSpeedCoef: 6 / 7,
    // Níveis desenhados no mapa
    rings: [20, 10, 5, 3, 1],
  },

  /* ------------------------------------------------------------------ */
  /**
   * Radiação térmica — escala aproximada R = R1 · W^0,41 (ajuste empírico usado em
   * calculadoras públicas; a fluência necessária cresce levemente com W) [G&D Cap. 7].
   */
  thermal: {
    exponent: 0.41,
    R1_km: {
      third: 0.63,   // queimadura de 3º grau (~8 cal/cm² para 1 kt)
      second: 0.80,  // 2º grau (~5 cal/cm²)
      first: 1.10,   // 1º grau (~2,7 cal/cm²)
    },
    // Fluência (cal/cm²) no limiar de 3º grau — usada para estimar a fluência num prédio
    // por lei do inverso do quadrado (sem atenuação atmosférica).
    fluenceThird_cal: 8,
    // Explosão de superfície entrega menos energia térmica ao alvo (sombra/absorção do
    // solo): equivale a uma explosão aérea com ~metade da potência [G&D §7.98, aprox.].
    surfaceYieldFactor: 0.5,
    // Fração da energia emitida como radiação térmica (para explicações didáticas)
    thermalFraction: 0.35,
  },

  /* ------------------------------------------------------------------ */
  /**
   * Radiação ionizante inicial (dose de 500 rem, ~LD50 sem tratamento).
   * Cresce MUITO devagar com a potência: a radiação é absorvida exponencialmente
   * pelo ar (comprimento de relaxação de algumas centenas de metros), então
   * multiplicar a energia por 1000 aumenta o raio só ~3,7×. Escala aprox. W^0,19.
   */
  radiation: {
    R1_km_500rem: 0.70,
    exponent: 0.19,
    relaxationLength_km: 0.30, // para estimar a dose num ponto (decaimento exponencial)
  },

  /* ------------------------------------------------------------------ */
  /**
   * Fallout — modelo SIMPLIFICADO inspirado no WSEG-10 e nos contornos idealizados
   * de G&D Cap. 9. Cada contorno de taxa de dose D (rad/h na hora H+1) é uma elipse
   * alongada na direção do vento:
   *     L(D) = cL · Wf^0,5 · D^(-β) · fu      (comprimento a favor do vento, km)
   *     B(D) = aspect · L / fu^2               (largura máxima, km)
   * Wf = potência de fissão (kt); fu = (u / 24 km/h)^0,5 (vento mais forte → pluma
   * mais longa e estreita). Calibrado para que 1 Mt de fissão, vento 24 km/h, gere
   * ~360 km para 1 rad/h e ~30 km para 1000 rad/h (ordem de grandeza de G&D/NUKEMAP).
   */
  fallout: {
    levels: [1000, 100, 10, 1],        // rad/h em H+1
    cL: 11.4,
    beta: 0.36,
    aspect: 0.12,
    refWind_kmh: 24,
    windExpMin: 0.35, windExpMax: 2.2, // limites de fu
    upwindFrac: 0.06,
    // Regra 7-10: taxa de dose cai ~10× a cada 7× no tempo (D ∝ t^-1,2) [G&D §9.145]
    decayExponent: 1.2,
    // Fallout local só se a bola de fogo tocar o solo: fator = (1 - h/Rfb)^1,5
    heightCutoffPower: 1.5,
    // Fração de fissão padrão por tipo
    fissionFraction: { fissao: 1.0, reforcada: 1.0, termonuclear: 0.5 },
  },

  /* ------------------------------------------------------------------ */
  /** Nuvem em cogumelo (somente visual). Ajuste a dados históricos:
   *  ~10 km (15 kt), ~25 km (1 Mt), ~64 km (50 Mt, Tsar Bomba). */
  cloud: {
    topA_km: 5.38, topExp: 0.229,       // altura do topo  H = a · W^b
    capA_km: 0.475, capExp: 0.4245,     // raio do "chapéu" R = a · W^b
  },

  /* ------------------------------------------------------------------ */
  /** Danos a construções por sobrepressão (psi) */
  damage: [
    { level: 5, min: 20, color: '#7f0000', label: 'Destruído', desc: 'Destruição total, inclusive concreto armado' },
    { level: 4, min: 10, color: '#d32f2f', label: 'Colapso', desc: 'Colapso da maioria dos prédios' },
    { level: 3, min: 5, color: '#ff8c00', label: 'Grave', desc: 'Casas residenciais destruídas' },
    { level: 2, min: 3, color: '#ffd400', label: 'Estrutural', desc: 'Danos estruturais graves' },
    { level: 1, min: 1, color: '#fff59d', label: 'Leve', desc: 'Janelas quebradas, danos leves' },
    { level: 0, min: 0, color: '#9e9e9e', label: 'Sem dano', desc: 'Danos insignificantes por onda de choque' },
  ],

  /* ------------------------------------------------------------------ */
  /**
   * Vítimas — estimativa GROSSEIRA.
   * Mortalidade/ferimentos por faixa de sobrepressão: [OTA 1979, Fig. 4 / Tab. 3]
   *   >12 psi: 98% mortos | 5–12: 50% mortos, 40% feridos | 2–5: 5% mortos, 45% feridos
   *   1–2 psi: 25% feridos
   * Térmica e radiação inicial combinadas de forma independente.
   */
  casualties: {
    blast: [
      { min: 12, dead: 0.98, injured: 0.02 },
      { min: 5, dead: 0.50, injured: 0.40 },
      { min: 2, dead: 0.05, injured: 0.45 },
      { min: 1, dead: 0.0, injured: 0.25 },
    ],
    exposedFraction: 0.25,  // fração da população ao ar livre/sem proteção térmica
    thermalThird: { dead: 0.5, injured: 0.5 },
    thermalSecond: { dead: 0.05, injured: 0.8 },
    thermalFirst: { dead: 0, injured: 0.15 },
    radiation500: { dead: 0.5, injured: 0.4 },
    // Perfis de densidade: D(r) = max(piso, D0 · min(1, (rCore / r)^decay))
    densityProfiles: {
      megacidade: { label: 'Megacidade (centro denso)', D0: 12000, rCore: 6, decay: 1.4 },
      urbana: { label: 'Urbana', D0: 5000, rCore: 5, decay: 1.5 },
      suburbana: { label: 'Suburbana', D0: 1500, rCore: 4, decay: 1.5 },
      rural: { label: 'Rural', D0: 50, rCore: 1e9, decay: 1 },
    },
    floorDensity: 30,       // hab/km² mínimo
    m2PerPerson: 45,        // área construída por habitante (modo automático)
  },

  /* ------------------------------------------------------------------ */
  /** Animação */
  anim: {
    shockVisualSeconds: 7,  // duração-alvo da passagem da onda (modo acelerado)
    collapseSeconds: 1.4,   // duração do colapso de um prédio (tempo visual)
    cloudRiseSeconds: 14,   // subida da nuvem (comprimida; na realidade leva minutos)
    falloutSeconds: 6,
    flashSeconds: 0.9,
  },

  /* ------------------------------------------------------------------ */
  /** Dados de prédios (Overpass API) */
  buildings: {
    endpoints: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ],
    // os mesmos blocos vetoriais do mapa-base (OpenFreeMap, z14) — fonte principal dos prédios
    tileJson: 'https://tiles.openfreemap.org/planet',
    defaultRadius_m: 1500,
    // raio automático: cobre a zona de 3 psi (danos estruturais), limitado pela qualidade
    autoRadius: { min_m: 1000, max_m: { baixa: 2500, media: 4000, alta: 6000, ultra: 8000 } },
    maxCount: { baixa: 8000, media: 20000, alta: 40000, ultra: 70000 },
    levelHeight_m: 3.2,
    defaultHeights: {
      house: 6.5, detached: 6.5, residential: 9, apartments: 15, terrace: 8, bungalow: 4,
      commercial: 12, office: 18, retail: 7, industrial: 9, warehouse: 9, garage: 3,
      garages: 3, shed: 2.6, roof: 4, church: 16, cathedral: 28, school: 10, hospital: 18,
      university: 14, hotel: 24, public: 12, civic: 12, train_station: 14, stadium: 20,
      hut: 3, cabin: 4, farm_auxiliary: 5, barn: 7, greenhouse: 4, service: 4,
      construction: 10, yes: 8,
    },
  },

  /** Qualidade gráfica: limites de partículas/voxels */
  quality: {
    baixa: { debris: 15000, cloud: 700, dust: 1200, fire: 500, pixelRatio: 1 },
    media: { debris: 40000, cloud: 1400, dust: 2500, fire: 1000, pixelRatio: 1.5 },
    alta: { debris: 80000, cloud: 2200, dust: 4000, fire: 1800, pixelRatio: 2 },
    ultra: { debris: 140000, cloud: 3200, dust: 6000, fire: 2800, pixelRatio: 2 },
  },

  /* ------------------------------------------------------------------ */
  /**
   * Valores de referência para a aba "Validação". Aproximados e arredondados;
   * cada linha traz a fonte. Edite/complete conforme novas consultas.
   */
  validation: [
    { kt: 15, effect: 'blast5', ref: 1.6, unit: 'km', source: 'Hiroshima (1945): destruição quase total até ≈1,6 km (≈1 milha) — relatórios de 1946 (USSBS; Manhattan District)', burst: 'custom', heightM: 600 },
    { kt: 15, effect: 'thermal3', ref: 2.03, unit: 'km', source: 'Hiroshima: área queimada ≈13 km² ⇒ raio equivalente ≈2,0 km (Prefeitura de Hiroshima)', burst: 'custom', heightM: 600 },
    { kt: 1000, effect: 'fireball', ref: 1.1, unit: 'km', source: 'FM 8-9: bola de fogo de 1 Mt (ar) atinge ~2200 m de diâmetro', burst: 'optimum' },
    { kt: 1000, effect: 'blast10', ref: 4.8, unit: 'km', source: 'OTA (1979): ≈28 mi² com ≥10 psi para 1 Mt a 8.000 ft ⇒ raio ≈4,8 km', burst: 'optimum' },
    { kt: 1000, effect: 'blast5', ref: 6.4, unit: 'km', source: 'OTA (1979), citado em fonte secundária: >5 psi até ≈4 milhas', burst: 'optimum' },
    { kt: 50000, effect: 'fireball', ref: 4.0, unit: 'km', source: 'Tsar Bomba: bola de fogo ≈8 km de diâmetro (AHF, Britannica)', burst: 'optimum' },
    { kt: 50000, effect: 'cloudTop', ref: 64, unit: 'km', source: 'Tsar Bomba: nuvem com 60–67 km de altura (Nuclear Weapon Archive)', burst: 'optimum' },
    { kt: 50000, effect: 'thermal3', ref: 100, unit: 'km', source: 'Tsar Bomba: 3º grau "até 100 km" em ar limpo (estimativa teórica; AHF/Britannica)', burst: 'optimum' },
  ],
};

/** Paleta das camadas de efeito (usada no mapa, na legenda e nos gráficos) */
export const EFFECT_STYLE = {
  fireball: { color: '#ffeb3b', label: 'Bola de fogo' },
  blast20: { color: '#7f0000', label: 'Onda de choque 20 psi' },
  blast10: { color: '#d32f2f', label: 'Onda de choque 10 psi' },
  blast5: { color: '#ff8c00', label: 'Onda de choque 5 psi' },
  blast3: { color: '#ffd400', label: 'Onda de choque 3 psi' },
  blast1: { color: '#fff59d', label: 'Onda de choque 1 psi' },
  rad500: { color: '#76ff03', label: 'Radiação 500 rem' },
  thermal3: { color: '#ff5722', label: 'Térmica 3º grau' },
  thermal2: { color: '#ff9800', label: 'Térmica 2º grau' },
  thermal1: { color: '#ffc107', label: 'Térmica 1º grau' },
};

export const FALLOUT_COLORS = {
  1000: '#b71c1c',
  100: '#e65100',
  10: '#f9a825',
  1: '#c6ff00',
};
