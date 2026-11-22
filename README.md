# ☢ Simulador de Efeitos Nucleares

Aplicativo web **educacional** que mostra os efeitos de uma detonação nuclear sobre um **mapa real**:
onda de choque, pulso térmico, radiação inicial, fallout e danos a construções. Os prédios reais do
OpenStreetMap são renderizados em 3D e **destruídos em tempo (acelerado) real** conforme a onda de choque passa.

> ⚠️ Ferramenta educacional. Valores aproximados baseados em literatura pública (Glasstone & Dolan, 1977; NUKEMAP).
> O app trata **apenas dos efeitos**. Não contém nada sobre o projeto ou o funcionamento interno de armas.

## O que ele faz

- **Mapa real**: MapLibre GL com estilos vetoriais públicos do OpenFreeMap (estilo "Google Maps"), satélite Esri,
  OpenStreetMap padrão, relevo 3D (AWS Terrain Tiles), céu e atmosfera. Busca por nome (Nominatim).
- **Cidade destrutível**: os prédios do próprio mapa são "interceptados" — o app baixa os mesmos blocos
  vetoriais do OpenFreeMap (z14) que o mapa desenha, separa cada prédio, esconde os originais (pelo id) e
  coloca no lugar cópias destrutíveis em WebGL (three.js dentro do MapLibre). Acontece sozinho ao escolher
  o alvo e leva ~1–3 s; o raio é automático (cobre a zona de 3 psi), limitado pela qualidade. Se os blocos
  falharem, a Overpass API é usada como reserva. Na detonação, cada prédio:
  - muda de cor conforme a sobrepressão (≥20, 10–20, 5–10, 3–5, 1–3 psi);
  - colapsa, inclina ou esfarela de acordo com o dano, no instante em que a onda chega;
  - solta destroços em **voxels** com trajetória balística (dezenas de milhares de blocos na GPU);
  - levanta poeira, pega fogo na zona térmica e é chamuscado nas faces voltadas para a explosão.
- **Sequência da detonação**: clarão → bola de fogo turbulenta (shader de ruído) → casca da onda de choque com nuvem de
  condensação → prédios caindo → cogumelo volumétrico em rolagem → pluma de fallout avançando com o vento.
  O som e o tremor da câmera chegam **junto com a onda de choque**, como na realidade.
- **Clique num prédio** (modo Inspecionar) para ver distância, sobrepressão, tempo de chegada, fluência térmica,
  dose de radiação e nível de dano.
- **Resultados**: anéis (raio, área e descrição), contagem de prédios por nível de dano, estimativa grosseira de vítimas,
  contornos de fallout no tempo (regra 7-10), países cruzados pela pluma, comparação de duas armas e legenda com camadas.
- **Modos de escolha da arma**: arsenal histórico (14 armas/testes com curiosidades), potência livre (10 t – 100 Mt)
  e a **Oficina** — um sistema de *crafting* estilizado e fictício, com orçamento, peso, pintura, emblema e "Meu Arsenal".
- **Jogo**: conquistas, desafios de escala ("faça 5 psi chegarem a 2 km com o menor custo") e comparação lado a lado.
- **Abas educativas**: *A Física* (E = mc², curva de energia de ligação, reação em cadeia conceitual, fissão × fusão,
  física dos efeitos, leis de escala com gráficos interativos), *Validação* (modelo × referências publicadas e
  Hiroshima/Nagasaki, com erro percentual e limitações) e *Fontes*.

## 🎬 Modo cinema (fotorrealista)

Botão **🎬 Cinema 3D** no topo do mapa. É um motor 3D próprio (three.js + pós-processamento HDR):

- **Cidades fotorrealistas reais**: Google Photorealistic 3D Tiles (a malha 3D do Google Earth), direto da Google ou via Cesium ion.
- **Iluminação de cinema**: céu físico, neblina atmosférica, hora do dia (dia, fim de tarde, noite), tone mapping ACES, bloom, grão de filme, vinheta, oclusão de ambiente (qualidade alta).
- **Bola de fogo e cogumelo volumétricos** (raymarching com ruído Perlin-Worley, auto-sombreamento, emissão de corpo negro, fuligem), com a saia de poeira nas explosões no solo.
- **Luz da bola de fogo com sombras** sobre a cidade, clarão, refração da onda de choque e nuvem de condensação.
- **Destruição na GPU** da malha fotogramétrica: o que está acima do chão desaba conforme a onda chega, fachadas carbonizam, focos de incêndio, destroços em voxels, poeira e fumaça.
- **Destroços com física de corpo rígido** (Rapier/WebAssembly): os prédios atingidos perto da câmera são fatiados em
  andares e colunas que a onda de choque empurra, caem com a gravidade, colidem e se amontoam em escombros.
- **Poeira volumétrica**: muro de poeira que acompanha a frente de choque e camada de poeira sobre a área destruída.
- **Câmera cinematográfica** que acompanha a onda e recua para enquadrar o cogumelo (qualquer clique devolve o controle).

### Chave das cidades 3D

Sem chave, o modo cinema usa **imagem de satélite + prédios do OpenStreetMap** com o mesmo motor de iluminação e efeitos.
Para as cidades fotorrealistas, escolha uma opção em **Controles → 🎬 Modo cinema** e cole a chave:

1. **Google Maps Platform** — em <https://console.cloud.google.com/>: crie um projeto, ative a **Map Tiles API** e gere uma chave
   em *Credenciais*. Exige conta de faturamento; há cota mensal gratuita (confira os valores atuais). Restrinja a chave ao seu domínio.
2. **Cesium ion** — conta gratuita em <https://ion.cesium.com/>, adicione o recurso **Google Photorealistic 3D Tiles** (ID 2275207)
   no *Asset Depot* e copie um *Access Token*.

A chave fica salva só no navegador (`localStorage`). Alternativamente, copie `.env.example` para `.env.local` e preencha
`VITE_GOOGLE_TILES_KEY` ou `VITE_CESIUM_ION_TOKEN` (o arquivo é ignorado pelo git).

### Desempenho

O modo cinema exige placa de vídeo dedicada para as qualidades **Alta/Ultra** (nuvem volumétrica em resolução maior,
sombras 2048–4096, oclusão de ambiente). Em notebooks e celulares use **Baixa/Média**.

## Como rodar

Requer Node.js 18+.

```bash
npm install
npm run dev        # servidor de desenvolvimento em http://localhost:5173
npm test           # testes da física e da lógica de jogo (Vitest)
npm run build      # gera dist/ — site estático, pode ir para qualquer hospedagem
npm run preview    # serve o dist/ localmente
```

O `dist/` usa caminhos relativos e funciona no GitHub Pages, Netlify ou qualquer servidor estático.
Não é preciso nenhuma chave de API.

### Publicar na Vercel

1. Em vercel.com → **Add New… → Project**, importe este repositório do GitHub.
2. A Vercel detecta o Vite sozinha: *Build Command* `npm run build`, *Output Directory* `dist`. Não mude nada.
3. Clique em **Deploy**. Cada novo push no branch gera uma nova versão.

Não configure variáveis de ambiente com chaves: tudo que começa com `VITE_` vai para o JavaScript
público do site. Para as cidades fotorrealistas, cole a chave no próprio app (fica só no seu
navegador) e, no console do Google/Cesium, restrinja a chave ao domínio `*.vercel.app` do seu projeto.

## Organização do código

```
index.html                 estrutura da página (painéis, abas, aviso fixo)
src/
  config.js                ⭐ TODAS as constantes físicas, com fontes — edite aqui para recalibrar
  main.js                  monta mapa, cena 3D, simulação, interface e páginas
  app.js                   ações: escolher alvo, carregar prédios, detonar, comparar, inspecionar
  state.js                 estado global e preferências
  physics/                 modelo físico puro (testável, sem DOM)
    blast.js               sobrepressão, altura de explosão, tempo de chegada (Rankine–Hugoniot)
    thermal.js  radiation.js  fireball.js  fallout.js  casualties.js
    effects.js             agrega todos os efeitos de uma detonação
  map/                     MapLibre: estilos, relevo, camadas 2D, geodésia
  services/                prédios do mapa (blocos vetoriais), Overpass (reserva), Nominatim, Open-Meteo
  render/                  three.js: cidade destrutível, voxels, partículas, bola de fogo,
                           cogumelo, onda de choque, efeitos no chão, ogiva estilizada (SVG)
  cinema/                  modo cinema: CinemaView (motor), worlds (Google/Cesium/satélite+OSM),
                           volumetric (nuvem por raymarching), destruction (shader da malha),
                           atmosphere (céu/hora do dia), effects (neblina, refração do choque),
                           physicsDebris (escombros com física Rapier, carregada sob demanda)
  sim/                     orquestração da animação e som sintetizado
  game/                    Oficina, Meu Arsenal, desafios, conquistas
  ui/                      painéis, resultados, gráficos SVG, notificações
  pages/                   Armas, Oficina, Desafios, Conquistas, A Física, Validação, Fontes
  data/                    armas históricas, energias de referência, nuclídeos
  styles/                  CSS (tema escuro, responsivo)
tests/                     Vitest: leis de escala, calibração, fallout, desafios solucionáveis
```

## Modelo físico (resumo)

| Efeito | Lei usada | Referência 1 kt |
|---|---|---|
| Onda de choque | R = R₁ · W^(1/3); no solo ×0,75 | 20 psi 0,22 km · 5 psi 0,53 km · 1 psi 1,4 km |
| Bola de fogo | R = 0,044 km · W^0,4 | — |
| Térmica | R ≈ R₁ · W^0,41 | 3º grau 0,63 km |
| Radiação inicial (500 rem) | R ≈ 0,70 km · W^0,19 | cresce devagar: absorção exponencial no ar |
| Velocidade do choque | U = c₀ √(1 + 6p / 7P₀) | → 340 m/s longe do centro |
| Fallout | elipses tipo WSEG-10 simplificado, D ∝ t^−1,2 | regra 7-10 |
| Vítimas | OTA (1979) por faixa de psi + térmica + radiação | estimativa grosseira |

Detalhes, fontes e a comparação com valores publicados estão nas abas **A Física** e **Validação** e em `src/config.js`.

## Serviços externos (públicos, sem chave)

- Mapas: [OpenFreeMap](https://openfreemap.org), [OpenStreetMap](https://www.openstreetmap.org/copyright), Esri World Imagery, AWS Terrain Tiles
- Prédios: blocos vetoriais do [OpenFreeMap](https://openfreemap.org) (os mesmos do mapa); reserva: [Overpass API](https://overpass-api.de)
- Busca e país: [Nominatim](https://nominatim.org) — respeitamos o limite de 1 requisição/s
- Vento: [Open-Meteo](https://open-meteo.com)

## Desempenho

O seletor **Qualidade** limita o número de prédios, voxels e partículas (Baixa é a padrão no celular).
Cidades densas com raio de 3–5 km podem ter dezenas de milhares de prédios: prefira 1–2 km em máquinas modestas.
Requer WebGL 2 (todos os navegadores atuais). Sem WebGL 2, os anéis e resultados 2D continuam funcionando.

## Limitações

Terreno plano, atmosfera padrão, vento único, limiares médios de dano por tipo de construção, alturas de prédios
frequentemente estimadas no OSM e estimativa de vítimas com incerteza de fator 2 ou mais. Veja a aba **Validação**.
