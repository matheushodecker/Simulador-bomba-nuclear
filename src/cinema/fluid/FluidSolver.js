/**
 * Simulação de FLUIDOS da atmosfera na GPU — "stable fluids" (Stam, 1999) em 3D,
 * com termodinâmica de Boussinesq:
 *
 *   ∂u/∂t = −(u·∇)u − ∇p/ρ + b ẑ + f_vort + f_explosão        ∇·u = 0
 *   ∂θ'/∂t = −(u·∇)θ' − Γ(z)·w − resfriamento(θ')               b = g·θ'/θ₀ − g_s·(fumaça + poeira)
 *
 *  - u: velocidade do ar (m/s); θ': excesso de temperatura potencial (K) — a
 *    temperatura é uma variável simulada: o ar quente sobe (empuxo), esfria por
 *    radiação (∝ T⁴, forte na bola de fogo) e por mistura com o ambiente;
 *  - Γ(z): estratificação da atmosfera (troposfera, tropopausa, "tampa" estratosférica),
 *    calibrada para a nuvem estabilizar na altura prevista pelas escalas públicas;
 *  - vorticidade confinada (Fedkiw et al. 2001) para preservar o anel de vórtice;
 *  - vento de fundo variando com a altura (advecção);
 *  - fontes: bola de fogo (calor + detritos), vento da onda de choque e poeira levantada
 *    na frente de choque (o "afterwind" puxa essa poeira para a haste naturalmente);
 *  - núcleo da térmica: num grid de dezenas de metros a bolha quente se dilui por difusão
 *    numérica e para de subir cedo demais. O núcleo (escala abaixo da célula) é então
 *    descrito por um modelo integral de térmica (physics/thermal_rise.js) e acoplado ao
 *    grid como o vórtice esférico de Hill — a circulação toroidal que forma o "chapéu";
 *  - água condensada (canal a): o ar úmido que sobe acima do nível de condensação esfria
 *    por expansão e condensa — é isso que deixa o chapéu branco.
 *
 * O grid 3D (nx × ny × nz) fica "fatiado" numa textura 2D (atlas de fatias), de modo que
 * cada etapa é UMA passada de tela cheia. O domínio acompanha a nuvem e cresce com ela;
 * a remapeação entre domínios acontece dentro da própria advecção semi-lagrangiana.
 */
import * as THREE from 'three';

export const FLUID_PRESETS = {
  off: null,
  g48: { nx: 48, nz: 64, iters: 16, maxSub: 2, label: '48 × 48 × 64' },
  g64: { nx: 64, nz: 96, iters: 22, maxSub: 3, label: '64 × 64 × 96' },
  g96: { nx: 96, nz: 128, iters: 28, maxSub: 3, label: '96 × 96 × 128' },
  g128: { nx: 128, nz: 160, iters: 34, maxSub: 4, label: '128 × 128 × 160' },
};

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
uniform vec3 uN;
uniform vec2 uTiles;
uniform vec2 uAtlas;
uniform vec3 uOrigin;
uniform vec3 uH;

ivec2 atlasOf(ivec3 c) {
  int nx = int(uN.x); int ny = int(uN.y); int tx = int(uTiles.x);
  return ivec2((c.z % tx) * nx + c.x, (c.z / tx) * ny + c.y);
}
vec4 fetchC(sampler2D t, ivec3 c) {
  c = clamp(c, ivec3(0), ivec3(uN) - 1);
  return texelFetch(t, atlasOf(c), 0);
}
vec2 uvOf(float z, vec2 xy) {
  float ty = floor((z + 0.5) / uTiles.x);
  float tx = z - ty * uTiles.x;
  return (vec2(tx, ty) * uN.xy + xy) / uAtlas;
}
vec4 sampleC(sampler2D t, vec3 p) {
  p = clamp(p, vec3(0.5), uN - 0.5);
  float zf = p.z - 0.5;
  float z0 = floor(zf);
  float f = zf - z0;
  float z1 = min(z0 + 1.0, uN.z - 1.0);
  return mix(texture(t, uvOf(z0, p.xy)), texture(t, uvOf(z1, p.xy)), f);
}
bool cellOf(out ivec3 c) {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  ivec2 n = ivec2(uN.xy);
  ivec2 t = fc / n;
  c = ivec3(fc - t * n, t.y * int(uTiles.x) + t.x);
  return c.z < int(uN.z);
}
vec3 worldOf(ivec3 c) { return uOrigin + (vec3(c) + 0.5) * uH; }
`;

const VERT = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const ADVECT = /* glsl */ `
uniform sampler2D tVel;
uniform sampler2D tSrc;
uniform vec3 uOriginPrev;
uniform vec3 uHPrev;
uniform float uDt;
uniform vec2 uWind;
uniform float uDecay;
vec2 windAt(float z) { return uWind * (1.0 + 1.5 * smoothstep(0.0, 10000.0, z)); }
void main() {
  ivec3 c;
  if (!cellOf(c)) { gl_FragColor = vec4(0.0); return; }
  vec3 x = worldOf(c);
  vec3 pp = (x - uOriginPrev) / uHPrev;
  vec3 v = sampleC(tVel, pp).xyz;
  v.xy += windAt(x.z);
  vec3 xb = x - v * uDt;
  vec3 pb = (xb - uOriginPrev) / uHPrev;
  vec4 val = sampleC(tSrc, pb);
  if (pb.x < 0.0 || pb.y < 0.0 || pb.x > uN.x || pb.y > uN.y || pb.z > uN.z) val = vec4(0.0);
  gl_FragColor = val * uDecay;
}
`;

// MacCormack: φ = φ̂ⁿ⁺¹ + ½(φⁿ − φ̂ⁿ), limitado aos extremos dos vizinhos do ponto de origem
const MACCORMACK = /* glsl */ `
uniform sampler2D tVel;
uniform sampler2D tPhi0;   // φⁿ
uniform sampler2D tPhi1;   // φ̂ⁿ⁺¹ (avanço)
uniform sampler2D tPhi2;   // φ̂ⁿ (retorno)
uniform float uDt;
uniform vec2 uWind;
vec2 windAt(float z) { return uWind * (1.0 + 1.5 * smoothstep(0.0, 10000.0, z)); }
void main() {
  ivec3 c;
  if (!cellOf(c)) { gl_FragColor = vec4(0.0); return; }
  vec3 x = worldOf(c);
  vec3 v = fetchC(tVel, c).xyz;
  v.xy += windAt(x.z);
  vec3 pb = (x - v * uDt - uOrigin) / uH;
  vec4 a = fetchC(tPhi1, c);
  vec4 corr = a + 0.5 * (fetchC(tPhi0, c) - fetchC(tPhi2, c));
  // limitador: extremos das 8 células em torno do ponto de origem
  ivec3 b = ivec3(floor(pb - 0.5));
  vec4 lo = vec4(1e9); vec4 hi = vec4(-1e9);
  for (int k = 0; k < 8; k++) {
    vec4 q = fetchC(tPhi0, b + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1));
    lo = min(lo, q); hi = max(hi, q);
  }
  gl_FragColor = clamp(corr, lo, hi);
}
`;

const CURL = /* glsl */ `
uniform sampler2D tVel;
void main() {
  ivec3 c;
  if (!cellOf(c)) { gl_FragColor = vec4(0.0); return; }
  vec3 xp = fetchC(tVel, c + ivec3(1, 0, 0)).xyz; vec3 xm = fetchC(tVel, c - ivec3(1, 0, 0)).xyz;
  vec3 yp = fetchC(tVel, c + ivec3(0, 1, 0)).xyz; vec3 ym = fetchC(tVel, c - ivec3(0, 1, 0)).xyz;
  vec3 zp = fetchC(tVel, c + ivec3(0, 0, 1)).xyz; vec3 zm = fetchC(tVel, c - ivec3(0, 0, 1)).xyz;
  vec3 i2h = 0.5 / uH;
  gl_FragColor = vec4(
    (yp.z - ym.z) * i2h.y - (zp.y - zm.y) * i2h.z,
    (zp.x - zm.x) * i2h.z - (xp.z - xm.z) * i2h.x,
    (xp.y - xm.y) * i2h.x - (yp.x - ym.x) * i2h.y,
    0.0);
}
`;

const FORCES = /* glsl */ `
uniform sampler2D tVel;
uniform sampler2D tSca;
uniform sampler2D tCurl;
uniform float uDt;
uniform float uEps;
uniform float uTheta0;
uniform float uSmokeW;
uniform vec4 uBlast;   // raio da frente (m), largura (m), vento de pico (m/s), ativo
uniform float uGroundDrag;
uniform vec4 uGuide;   // centro da térmica (x, y, z) e raio a (m)
uniform vec4 uGuideV;  // velocidade de subida U (m/s), taxa de acoplamento (1/s), raio da haste (m), subida na haste (m/s)
uniform vec2 uGuideShape; // semi-eixos horizontal e vertical relativos a a (nuvens nucleares são achatadas)
void main() {
  ivec3 c;
  if (!cellOf(c)) { gl_FragColor = vec4(0.0); return; }
  vec3 v = fetchC(tVel, c).xyz;
  vec4 s = fetchC(tSca, c);
  vec3 x = worldOf(c);
  // núcleo da térmica (modelo integral): dentro dele o escoamento segue o vórtice esférico de Hill
  float core = 0.0;
  if (uGuideV.y > 0.0) {
    vec3 d = x - uGuide.xyz;
    float a = uGuide.w;
    float ah = a * uGuideShape.x;
    float av = a * uGuideShape.y;
    // coordenadas normalizadas do esferoide (achatado): o campo continua com divergência nula
    vec3 q = d / vec3(ah, ah, av);
    float rr = length(q);
    core = 1.0 - smoothstep(0.7, 1.0, rr);
    if (core > 0.0) {
      float U = uGuideV.x;
      float rho = length(q.xy);
      // Hill (1894), referencial do solo: sobe pelo eixo, desce pela borda → o "chapéu" enrola
      float uz = U * (1.0 + 1.5 * (1.0 - 2.0 * rho * rho - q.z * q.z));
      vec2 ur = rho > 1e-4 ? q.xy / rho * (1.5 * U * (ah / av) * rho * q.z) : vec2(0.0);
      v = mix(v, vec3(ur, uz), (1.0 - exp(-uGuideV.y * uDt)) * core);
    }
    // haste: corrente ascendente sob a nuvem (os "ventos de retorno" convergem para ela pelo chão)
    if (uGuideV.w > 0.0) {
      // eixo da haste: preso ao marco zero no chão, inclinado até a base do chapéu (cisalhamento do vento)
      vec2 axis = uGuide.xy * clamp(x.z / max(uGuide.z - 0.8 * a, 1.0), 0.0, 1.0);
      float rs = length(x.xy - axis) / uGuideV.z;
      float m = (1.0 - smoothstep(0.5, 1.0, rs)) * (1.0 - smoothstep(uGuide.z - 0.95 * a, uGuide.z - 0.5 * a, x.z));
      v.z = mix(v.z, uGuideV.w, (1.0 - exp(-0.5 * uGuideV.y * uDt)) * m);
    }
  }
  // empuxo de Boussinesq (ar quente sobe, poeira/detritos pesam) — no núcleo ele já está no modelo integral
  v.z += uDt * (9.81 * s.g / uTheta0 - uSmokeW * (s.r + s.b)) * (1.0 - core);
  // confinamento de vorticidade: devolve os redemoinhos perdidos pela difusão numérica
  vec3 w = fetchC(tCurl, c).xyz;
  vec3 gw = vec3(
    length(fetchC(tCurl, c + ivec3(1, 0, 0)).xyz) - length(fetchC(tCurl, c - ivec3(1, 0, 0)).xyz),
    length(fetchC(tCurl, c + ivec3(0, 1, 0)).xyz) - length(fetchC(tCurl, c - ivec3(0, 1, 0)).xyz),
    length(fetchC(tCurl, c + ivec3(0, 0, 1)).xyz) - length(fetchC(tCurl, c - ivec3(0, 0, 1)).xyz)) / (2.0 * uH);
  float gl = length(gw);
  if (gl > 1e-9) {
    // limitado por passo: com passos de tempo grandes o confinamento vira realimentação positiva
    vec3 dv = uDt * uEps * min(uH.x, uH.z) * cross(gw / gl, w);
    float lim = 0.06 * length(v) + 0.2;
    float dl = length(dv);
    v += dl > lim ? dv * (lim / dl) : dv;
  }
  // vento da onda de choque logo atrás da frente (radial, junto ao chão)
  if (uBlast.w > 0.0 && c.z < 3) {
    float r = length(x.xy);
    float d = uBlast.x - r;
    if (d > 0.0 && d < uBlast.y && r > 1.0) {
      float k = 1.0 - d / uBlast.y;
      v.xy = mix(v.xy, (x.xy / r) * uBlast.z * k, 0.6 * k * (1.0 - float(c.z) / 3.0));
    }
  }
  if (c.z == 0) v.xy *= max(0.0, 1.0 - uGroundDrag * uDt);
  gl_FragColor = vec4(v, 0.0);
}
`;

const SCALARS = /* glsl */ `
uniform sampler2D tSca;
uniform sampler2D tVel;
uniform float uDt;
uniform vec3 uStrat;   // Γ troposfera (K/m), Γ acima da tropopausa, altura da tropopausa
uniform vec2 uLid;     // altura da "tampa", Γ da tampa
uniform vec2 uCool;    // coef. radiativo (∝ T³ a cada 1000 K), mistura (1/s)
uniform vec4 uFire;    // altura, raio, temperatura (K de excesso), ativo
uniform vec3 uFireC;   // centro da bola de fogo (m)
uniform float uSurfaceDust;
uniform vec4 uBlast;
uniform float uDustRate;
uniform vec4 uGuide;   // centro e raio da térmica
uniform vec2 uGuideShape;
uniform vec4 uGuideS;  // excesso de temperatura do núcleo (K), água condensada no núcleo, nível de condensação (m), ativo
uniform float uCondRate;
uniform vec3 uDustLift; // coef. de arraste de poeira (1/m), velocidade-limiar (m/s), raio da área com escombros soltos (m)
float gammaAt(float z) { return z < uStrat.z ? uStrat.x : (z < uLid.x ? uStrat.y : uLid.y); }
void main() {
  ivec3 c;
  if (!cellOf(c)) { gl_FragColor = vec4(0.0); return; }
  vec4 s = fetchC(tSca, c);
  vec3 v = fetchC(tVel, c).xyz;
  vec3 x = worldOf(c);
  // estratificação: a parcela que sobe encontra ar ambiente de θ maior
  s.g -= gammaAt(x.z) * v.z * uDt;
  // resfriamento: radiação (forte acima de ~2000 K) + mistura com o ambiente
  float th = max(s.g, 0.0) / 1000.0;
  s.g -= uDt * s.g * (uCool.x * th * th * th + uCool.y);
  s.g = max(s.g, -60.0);
  // bola de fogo: fonte de calor, detritos vaporizados e (no solo) terra
  if (uFire.w > 0.0) {
    float d = length(x - uFireC);
    float k = 1.0 - smoothstep(uFire.y * 0.65, uFire.y, d);
    s.g = max(s.g, uFire.z * k);
    // pouco material opaco dentro da bola de fogo: ela é a superfície que irradia (não fica escondida)
    s.r = max(s.r, 0.25 * k);
    s.b = max(s.b, uSurfaceDust * 0.2 * k);
  }
  // poeira levantada na frente de choque
  if (uBlast.w > 0.0 && c.z < 2) {
    float r = length(x.xy);
    float d = uBlast.x - r;
    vec2 g = vec2(c.xy) + 0.5;
    float edge = clamp(min(min(g.x, uN.x - g.x), min(g.y, uN.y - g.y)) / (uN.x * 0.12), 0.0, 1.0);
    if (d > 0.0 && d < uBlast.y) s.b = min(1.5, s.b + uDustRate * uDt * (1.0 - d / uBlast.y) * edge);
  }
  // núcleo da térmica: mantém o calor e a umidade que o grid grosso dilui numericamente
  float outside = 0.0;
  if (uGuideS.w > 0.0) {
    float rr = length((x - uGuide.xyz) / (uGuide.w * vec3(uGuideShape.xxy)));
    float core = 1.0 - smoothstep(0.45, 0.95, rr);
    s.g = max(s.g, uGuideS.x * core);
    // só um "piso" de umidade condensada: o resto vem da condensação na corrente ascendente,
    // que a circulação do anel de vórtice espalha pelo chapéu
    s.a = max(s.a, uGuideS.y * 0.3 * (1.0 - smoothstep(0.2, 0.6, rr)));
    outside = smoothstep(1.1, 1.7, rr) * uGuideS.w;
  }
  // condensação: o ar úmido da nuvem que sobe acima do nível de condensação expande, esfria e
  // condensa (o "chapéu" branco é sobretudo água/gelo). Evapora quando o ar desce (aquece por
  // compressão) e quando se mistura com o ar seco em volta, fora do chapéu.
  float plume = clamp(s.r * 12.0 + max(s.g, 0.0) / 15.0, 0.0, 1.0);
  if (x.z > uGuideS.z && v.z > 0.0) s.a = min(1.2, s.a + uCondRate * v.z * uDt * plume);
  float evap = 0.0008 + 0.004 * smoothstep(200.0, 800.0, s.g) + 0.0005 * max(-v.z, 0.0) + 0.03 * outside;
  s.a *= max(0.0, 1.0 - evap * uDt);
  // poeira levantada pelo vento junto ao chão (fluxo de saltação ∝ excesso sobre a velocidade-limiar):
  // os "ventos de retorno" que convergem para a haste arrastam os escombros e a terra para cima
  if (c.z < 2 && uDustLift.x > 0.0) {
    float r0 = length(x.xy);
    float exc = max(length(v.xy) - uDustLift.y, 0.0);
    float area = 1.0 - smoothstep(uDustLift.z * 0.75, uDustLift.z, r0);
    s.b = min(1.5, s.b + uDustLift.x * exc * exc * uDt * area * (c.z == 0 ? 1.0 : 0.4));
    // condição de contorno: a camada junto ao chão (dezenas de metros, abaixo da célula) está
    // carregada de poeira e escombros; onde o ar sobe, ela é sugada para dentro da corrente
    if (c.z == 0 && v.z > 0.0) s.b = max(s.b, uDustLift.x * 40.0 * area * smoothstep(0.0, 8.0, v.z));
  }
  s.r *= 1.0 - 0.0015 * uDt;
  s.b *= 1.0 - 0.0035 * uDt;
  gl_FragColor = s;
}
`;

const DIVERGENCE = /* glsl */ `
uniform sampler2D tVel;
void main() {
  ivec3 c;
  if (!cellOf(c)) { gl_FragColor = vec4(0.0); return; }
  float xp = fetchC(tVel, c + ivec3(1, 0, 0)).x; float xm = fetchC(tVel, c - ivec3(1, 0, 0)).x;
  float yp = fetchC(tVel, c + ivec3(0, 1, 0)).y; float ym = fetchC(tVel, c - ivec3(0, 1, 0)).y;
  float zp = fetchC(tVel, c + ivec3(0, 0, 1)).z;
  float zm = c.z == 0 ? -fetchC(tVel, c).z : fetchC(tVel, c - ivec3(0, 0, 1)).z;
  gl_FragColor = vec4((xp - xm) / (2.0 * uH.x) + (yp - ym) / (2.0 * uH.y) + (zp - zm) / (2.0 * uH.z), 0.0, 0.0, 0.0);
}
`;

const PFETCH = /* glsl */ `
uniform sampler2D tP;
float P(ivec3 c, float self) {
  if (c.z < 0) return self;                                       // chão: derivada nula
  if (c.x < 0 || c.y < 0 || c.x >= int(uN.x) || c.y >= int(uN.y) || c.z >= int(uN.z)) return 0.0; // fronteiras abertas
  return texelFetch(tP, atlasOf(c), 0).r;
}
`;

const JACOBI = /* glsl */ `
${PFETCH}
uniform sampler2D tDiv;
void main() {
  ivec3 c;
  if (!cellOf(c)) { gl_FragColor = vec4(0.0); return; }
  float self = texelFetch(tP, atlasOf(c), 0).r;
  vec3 ih2 = 1.0 / (uH * uH);
  float s = (P(c + ivec3(1, 0, 0), self) + P(c - ivec3(1, 0, 0), self)) * ih2.x
          + (P(c + ivec3(0, 1, 0), self) + P(c - ivec3(0, 1, 0), self)) * ih2.y
          + (P(c + ivec3(0, 0, 1), self) + P(c - ivec3(0, 0, 1), self)) * ih2.z;
  float d = texelFetch(tDiv, atlasOf(c), 0).r;
  gl_FragColor = vec4((s - d) / (2.0 * (ih2.x + ih2.y + ih2.z)), 0.0, 0.0, 0.0);
}
`;

const GRADIENT = /* glsl */ `
${PFETCH}
uniform sampler2D tVel;
void main() {
  ivec3 c;
  if (!cellOf(c)) { gl_FragColor = vec4(0.0); return; }
  float self = texelFetch(tP, atlasOf(c), 0).r;
  vec3 v = fetchC(tVel, c).xyz;
  v -= vec3(
    (P(c + ivec3(1, 0, 0), self) - P(c - ivec3(1, 0, 0), self)) / (2.0 * uH.x),
    (P(c + ivec3(0, 1, 0), self) - P(c - ivec3(0, 1, 0), self)) / (2.0 * uH.y),
    (P(c + ivec3(0, 0, 1), self) - P(c - ivec3(0, 0, 1), self)) / (2.0 * uH.z));
  if (c.z == 0 && v.z < 0.0) v.z = 0.0;
  gl_FragColor = vec4(v, 0.0);
}
`;

// coluna por coluna: célula mais alta com fumaça, densidade máxima e velocidade máxima
const EXTENT = /* glsl */ `
uniform sampler2D tSca;
uniform sampler2D tVel;
void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  float top = -1.0; float dens = 0.0; float vmax = 0.0;
  for (int z = 0; z < 256; z++) {
    if (z >= int(uN.z)) break;
    ivec3 c = ivec3(xy, z);
    vec4 s = texelFetch(tSca, atlasOf(c), 0);
    float d = max(s.r, s.a * 0.5);
    if (d > 0.03 || s.g > 20.0) top = float(z);
    dens = max(dens, max(d, s.g > 20.0 ? 0.05 : 0.0));
    vmax = max(vmax, length(texelFetch(tVel, atlasOf(c), 0).xyz));
  }
  gl_FragColor = vec4(top, dens, vmax, 0.0);
}
`;

export class FluidSolver {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{nx:number, nz:number, iters:number, maxSub:number}} preset
   */
  constructor(renderer, preset) {
    this.renderer = renderer;
    this.preset = preset;
    const nx = preset.nx; const ny = preset.nx; const nz = preset.nz;
    const tilesX = Math.ceil(Math.sqrt(nz));
    const tilesY = Math.ceil(nz / tilesX);
    this.n = new THREE.Vector3(nx, ny, nz);
    this.tiles = new THREE.Vector2(tilesX, tilesY);
    this.atlas = new THREE.Vector2(tilesX * nx, tilesY * ny);
    const rt = () => {
      const t = new THREE.WebGLRenderTarget(this.atlas.x, this.atlas.y, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      });
      t.texture.generateMipmaps = false;
      return t;
    };
    this.vel = [rt(), rt()];
    this.sca = [rt(), rt()];
    this.scaTmp = [rt(), rt()];
    this.pres = [rt(), rt()];
    this.div = rt();
    this.curl = rt();
    // meia precisão: legível em praticamente todas as GPUs com WebGL2
    this.extentRT = new THREE.WebGLRenderTarget(nx, ny, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.extentRaw = new Uint16Array(nx * ny * 4);
    this.extentBuf = new Float32Array(nx * ny * 4);
    this.readable = true;

    this.origin = new THREE.Vector3();
    this.h = new THREE.Vector3(1, 1, 1);
    this.originPrev = new THREE.Vector3();
    this.hPrev = new THREE.Vector3(1, 1, 1);

    const common = () => ({
      uN: { value: this.n }, uTiles: { value: this.tiles }, uAtlas: { value: this.atlas },
      uOrigin: { value: this.origin }, uH: { value: this.h },
    });
    const mat = (frag, extra = {}) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMMON + frag, uniforms: { ...common(), ...extra },
      depthTest: false, depthWrite: false,
    });
    const T = () => ({ value: null });
    this.m = {
      advect: mat(ADVECT, {
        tVel: T(), tSrc: T(), uOriginPrev: { value: this.originPrev }, uHPrev: { value: this.hPrev },
        uDt: { value: 0 }, uWind: { value: new THREE.Vector2() }, uDecay: { value: 1 },
      }),
      curl: mat(CURL, { tVel: T() }),
      maccormack: mat(MACCORMACK, { tVel: T(), tPhi0: T(), tPhi1: T(), tPhi2: T(), uDt: { value: 0 }, uWind: { value: new THREE.Vector2() } }),
      forces: mat(FORCES, {
        tVel: T(), tSca: T(), tCurl: T(), uDt: { value: 0 }, uEps: { value: 0.35 }, uTheta0: { value: 300 },
        uSmokeW: { value: 0.4 }, uBlast: { value: new THREE.Vector4() }, uGroundDrag: { value: 0.4 },
        uGuide: { value: new THREE.Vector4(0, 0, 0, 1) }, uGuideV: { value: new THREE.Vector4() },
        uGuideShape: { value: new THREE.Vector2(1.3, 0.75) },
      }),
      scalars: mat(SCALARS, {
        tSca: T(), tVel: T(), uDt: { value: 0 }, uStrat: { value: new THREE.Vector3(0.003, 0.012, 8000) },
        uLid: { value: new THREE.Vector2(10000, 0.15) }, uCool: { value: new THREE.Vector2(0.002, 0.008) },
        uFire: { value: new THREE.Vector4() }, uFireC: { value: new THREE.Vector3() }, uSurfaceDust: { value: 0 },
        uBlast: { value: new THREE.Vector4() }, uDustRate: { value: 0.8 },
        uGuide: { value: new THREE.Vector4(0, 0, 0, 1) }, uGuideS: { value: new THREE.Vector4(0, 0, 1200, 0) },
        uGuideShape: { value: new THREE.Vector2(1.3, 0.75) },
        uCondRate: { value: 0.0004 }, uDustLift: { value: new THREE.Vector3() },
      }),
      divergence: mat(DIVERGENCE, { tVel: T() }),
      jacobi: mat(JACOBI, { tP: T(), tDiv: T() }),
      gradient: mat(GRADIENT, { tP: T(), tVel: T() }),
      extent: mat(EXTENT, { tSca: T(), tVel: T() }),
    };
    this.scene = new THREE.Scene();
    this.cam = new THREE.Camera();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.m.advect);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.time = 0;
    this.extent = null;
  }

  get scalarTexture() { return this.sca[0].texture; }

  _run(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  _swap(pair) { const t = pair[0]; pair[0] = pair[1]; pair[1] = t; }

  /** Zera os campos e define o domínio inicial (ENU, metros). */
  reset(box) {
    const r = this.renderer;
    const prevColor = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of [...this.vel, ...this.sca, ...this.scaTmp, ...this.pres, this.div, this.curl]) { r.setRenderTarget(t); r.clear(); }
    r.setClearColor(prevColor, prevAlpha);
    r.setRenderTarget(null);
    this.setDomain(box);
    this.originPrev.copy(this.origin);
    this.hPrev.copy(this.h);
    this.time = 0;
    this.extent = null;
  }

  /** Domínio: centro horizontal (cx, cy), largura W e altura H (m). */
  setDomain({ cx, cy, W, H }) {
    this.box = { cx, cy, W, H };
    this.origin.set(cx - W / 2, cy - W / 2, 0);
    this.h.set(W / this.n.x, W / this.n.y, H / this.n.z);
  }

  /**
   * Um passo da simulação.
   * @param {number} dt passo físico (s)
   * @param {object} f forçantes: wind[2], blast(Vector4), fire(Vector4), fireC(Vector3), surfaceDust,
   *   strat, lid, cool, dustRate, guide/guideV/guideS (núcleo da térmica, ver FluidController)
   */
  step(dt, f) {
    const m = this.m;
    // 1) advecção (velocidade e escalares) — também remapeia do domínio anterior para o atual
    m.advect.uniforms.uDt.value = dt;
    m.advect.uniforms.uWind.value.set(f.wind[0], f.wind[1]);
    m.advect.uniforms.tVel.value = this.vel[0].texture;
    m.advect.uniforms.tSrc.value = this.vel[0].texture;
    m.advect.uniforms.uDecay.value = 0.999;
    this._run(m.advect, this.vel[1]);
    const sameDomain = this.origin.equals(this.originPrev) && this.h.equals(this.hPrev);
    m.advect.uniforms.tSrc.value = this.sca[0].texture;
    m.advect.uniforms.uDecay.value = 1;
    this._run(m.advect, this.sca[1]);
    if (sameDomain) {
      // retorno: advecta φ̂ⁿ⁺¹ com −u (mesmo domínio), depois corrige e limita
      m.advect.uniforms.uDt.value = -dt;
      m.advect.uniforms.tSrc.value = this.sca[1].texture;
      this._run(m.advect, this.scaTmp[0]);
      m.advect.uniforms.uDt.value = dt;
      const mc = m.maccormack.uniforms;
      mc.tVel.value = this.vel[0].texture; mc.tPhi0.value = this.sca[0].texture;
      mc.tPhi1.value = this.sca[1].texture; mc.tPhi2.value = this.scaTmp[0].texture;
      mc.uDt.value = dt; mc.uWind.value.set(f.wind[0], f.wind[1]);
      this._run(m.maccormack, this.scaTmp[1]);
      const t = this.sca[1]; this.sca[1] = this.scaTmp[1]; this.scaTmp[1] = t;
    }
    this._swap(this.vel);
    this._swap(this.sca);
    this.originPrev.copy(this.origin);
    this.hPrev.copy(this.h);

    // 2) termodinâmica e fontes nos escalares
    const s = m.scalars.uniforms;
    s.tSca.value = this.sca[0].texture; s.tVel.value = this.vel[0].texture; s.uDt.value = dt;
    s.uStrat.value.copy(f.strat); s.uLid.value.copy(f.lid); s.uCool.value.copy(f.cool);
    s.uFire.value.copy(f.fire); s.uFireC.value.copy(f.fireC); s.uSurfaceDust.value = f.surfaceDust;
    s.uBlast.value.copy(f.blast); s.uDustRate.value = f.dustRate;
    s.uDustLift.value.copy(f.dustLift);
    s.uGuide.value.copy(f.guide); s.uGuideS.value.copy(f.guideS); s.uGuideShape.value.copy(f.guideShape);
    this._run(m.scalars, this.sca[1]);
    this._swap(this.sca);

    // 3) vorticidade e forças (empuxo, confinamento, vento da explosão)
    m.curl.uniforms.tVel.value = this.vel[0].texture;
    this._run(m.curl, this.curl);
    const fo = m.forces.uniforms;
    fo.tVel.value = this.vel[0].texture; fo.tSca.value = this.sca[0].texture; fo.tCurl.value = this.curl.texture;
    fo.uDt.value = dt; fo.uBlast.value.copy(f.blast); fo.uEps.value = f.eps ?? 0.35;
    fo.uGuide.value.copy(f.guide); fo.uGuideV.value.copy(f.guideV); fo.uGuideShape.value.copy(f.guideShape);
    this._run(m.forces, this.vel[1]);
    this._swap(this.vel);

    // 4) projeção: ∇²p = ∇·u ; u ← u − ∇p  (escoamento incompressível)
    m.divergence.uniforms.tVel.value = this.vel[0].texture;
    this._run(m.divergence, this.div);
    m.jacobi.uniforms.tDiv.value = this.div.texture;
    const iters = Math.max(8, Math.round(this.preset.iters * (this.budget ?? 1)));
    for (let i = 0; i < iters; i++) {
      m.jacobi.uniforms.tP.value = this.pres[0].texture;
      this._run(m.jacobi, this.pres[1]);
      this._swap(this.pres);
    }
    m.gradient.uniforms.tP.value = this.pres[0].texture;
    m.gradient.uniforms.tVel.value = this.vel[0].texture;
    this._run(m.gradient, this.vel[1]);
    this._swap(this.vel);
    this.renderer.setRenderTarget(null);
    this.time += dt;
  }

  /** Lê (de forma síncrona, mas raramente) a extensão da nuvem para o domínio acompanhá-la. */
  measure() {
    if (!this.readable) return null;
    const m = this.m.extent;
    m.uniforms.tSca.value = this.sca[0].texture;
    m.uniforms.tVel.value = this.vel[0].texture;
    this._run(m, this.extentRT);
    try {
      this.renderer.readRenderTargetPixels(this.extentRT, 0, 0, this.n.x, this.n.y, this.extentRaw);
      for (let i = 0; i < this.extentRaw.length; i++) this.extentBuf[i] = THREE.DataUtils.fromHalfFloat(this.extentRaw[i]);
    } catch (e) {
      console.warn('[fluido] leitura da GPU indisponível; domínio crescerá por estimativa', e);
      this.readable = false;
      return null;
    } finally {
      this.renderer.setRenderTarget(null);
    }
    const b = this.extentBuf;
    let top = -1; let vmax = 0; let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (let y = 0; y < this.n.y; y++) for (let x = 0; x < this.n.x; x++) {
      const k = (y * this.n.x + x) * 4;
      if (b[k] >= 0) {
        top = Math.max(top, b[k]);
        if (b[k + 1] > 0.03) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      vmax = Math.max(vmax, b[k + 2]);
    }
    const o = this.origin; const h = this.h;
    this.extent = {
      top: top < 0 ? 0 : o.z + (top + 1) * h.z,
      xmin: Number.isFinite(x0) ? o.x + x0 * h.x : null, xmax: Number.isFinite(x1) ? o.x + (x1 + 1) * h.x : null,
      ymin: Number.isFinite(y0) ? o.y + y0 * h.y : null, ymax: Number.isFinite(y1) ? o.y + (y1 + 1) * h.y : null,
      vmax,
    };
    return this.extent;
  }

  dispose() {
    for (const t of [...this.vel, ...this.sca, ...this.scaTmp, ...this.pres, this.div, this.curl, this.extentRT]) t.dispose();
    for (const m of Object.values(this.m)) m.dispose();
    this.quad.geometry.dispose();
  }
}
