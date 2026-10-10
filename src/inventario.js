'use strict';

// Leitura da mochila ("Cubo") a partir de uma imagem do ecrã.
//
// Geometria medida numa captura a 2560×1440 (6 Out 2026), nas casas vazias,
// que são limpas: casas de 65×65, colunas a cada 71,25 px, linhas a cada 74.
// A mochila tem sempre 5 colunas. A origem (canto da primeira casa) muda com a
// janela e com o recorte, por isso não está aqui: vem da calibração.
//
// Quantidades: algarismos brancos com contorno preto, 10 px de altura,
// encostados ao canto inferior direito da casa. A letra é sempre a mesma,
// píxel a píxel, por isso compara-se com moldes em vez de usar OCR — o OCR do
// Windows lia "381,3K" como "381r3K" e saltava metade das casas.

const GEOMETRIA_1440 = { lado: 65, passoX: 71.25, passoY: 74, colunas: 5 };

// A faixa do texto dentro da casa (medida): linhas 50..61 (inclui a vírgula,
// que desce 2 px), colunas 10..64.
const TEXTO = { y0: 50, y1: 62, x0: 10, x1: 65 };

function casa(origem, c, r, g = GEOMETRIA_1440) {
  return { x: Math.round(origem.x + g.passoX * c), y: Math.round(origem.y + g.passoY * r), lado: g.lado };
}

/** Píxel de algarismo: claro e sem cor (o texto é branco; os ícones raramente são cinzento-claro puro). */
function eTexto(img, x, y) {
  const d = (y * img.largura + x) * 4;
  const R = img.px[d], G = img.px[d + 1], B = img.px[d + 2];
  // Numa imagem reescalada (outra resolução levada a 1440p) os traços finos ficam
  // mais escuros — o "1" desaparecia. img.limiarTexto deixa baixar o limiar aí.
  return (R + G + B) / 3 > (img.limiarTexto || 170) && Math.max(R, G, B) - Math.min(R, G, B) < 50;
}

/** Matriz 0/1 da faixa de texto de uma casa: linhas × colunas. */
function faixa(img, cx) {
  const m = [];
  for (let y = cx.y + TEXTO.y0; y < cx.y + TEXTO.y1; y++) {
    const lin = [];
    for (let x = cx.x + TEXTO.x0; x < cx.x + TEXTO.x1; x++) lin.push(eTexto(img, x, y) ? 1 : 0);
    m.push(lin);
  }
  return limparFinos(m);
}

/**
 * Apaga, na linha de cima da faixa, os píxeis sem nada por baixo. O ícone está
 * por cima do número e o brilho dele entra pela linha 0: visto na moeda do kinah,
 * que colava dois píxeis ao "0" de "540,8K" e ele lia-se "K". Os algarismos têm o
 * topo com 2 px de grossura, por isso não perdem nada.
 * (Apagar TODOS os píxeis finos partia os traços diagonais do "4" e do "7".)
 */
function limparFinos(m) {
  if (!m.length) return m;
  const out = m.map((l) => l.slice());
  for (let x = 0; x < out[0].length; x++) if (out[0][x] && !(m[1] && m[1][x])) out[0][x] = 0;
  return out;
}

/**
 * Corta a faixa em glifos por manchas ligadas (8 vizinhos). Cortar por colunas
 * vazias não serve: a letra do jogo encosta os algarismos ("14,4K" não tem uma
 * única coluna vazia entre o 4, a vírgula e o outro 4).
 *
 * O número está encostado à direita: lê-se da direita para a esquerda e pára
 * num vazio de 4+ colunas (o que está mais à esquerda é o desenho do ícone).
 * Manchas com menos de 3 píxeis são ruído do ícone. Devolve [{ x0, x1, bits }]
 * por ordem de leitura; `bits` só tem os píxeis da própria mancha.
 */
function glifos(m) {
  const H = m.length;
  const W = m[0].length;
  const rotulo = m.map((l) => l.map(() => 0));
  const manchas = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y][x] || rotulo[y][x]) continue;
      const id = manchas.length + 1;
      const pts = [];
      const pilha = [[x, y]];
      rotulo[y][x] = id;
      while (pilha.length) {
        const [px, py] = pilha.pop();
        pts.push([px, py]);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || !m[ny][nx] || rotulo[ny][nx]) continue;
            rotulo[ny][nx] = id;
            pilha.push([nx, ny]);
          }
        }
      }
      if (pts.length < 3) continue;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const topo = Math.min(...ys);
      const alt = Math.max(...ys) - topo + 1;
      const larg = Math.max(...xs) - Math.min(...xs) + 1;
      // Forma de caráter: algarismo/letra ocupa as 10 linhas (de 0–1 até 8+);
      // a vírgula é pequena, estreita e está em baixo. Tudo o resto é o ícone.
      const algarismo = topo <= 1 && alt >= 8 && larg <= 9;
      const virgula = topo >= 7 && alt <= 5 && larg <= 3;
      if (!algarismo && !virgula) continue;
      manchas.push({ x0: Math.min(...xs), x1: Math.max(...xs), pts });
    }
  }
  manchas.sort((a, b) => b.x1 - a.x1);
  // O número acaba encostado à direita da casa (medido: x1 entre 49 e 52 na faixa).
  if (!manchas.length || manchas[0].x1 < W - 10) return [];
  const out = [];
  let limite = Infinity;
  for (const g of manchas) {
    if (out.length && limite - g.x1 > 4) break;
    // Uma mancha por baixo de outra já aceite (sobreposta em x) é parte dela.
    const dono = out.find((o) => g.x1 >= o.x0 && g.x0 <= o.x1);
    if (dono) {
      dono.pts.push(...g.pts);
      dono.x0 = Math.min(dono.x0, g.x0);
      dono.x1 = Math.max(dono.x1, g.x1);
    } else out.push(g);
    limite = Math.min(limite, g.x0);
  }
  return out
    .sort((a, b) => a.x0 - b.x0)
    .map((g) => {
      const bits = Array.from({ length: H }, () => new Array(g.x1 - g.x0 + 1).fill(0));
      for (const [x, y] of g.pts) bits[y][x - g.x0] = 1;
      return { x0: g.x0, x1: g.x1, bits };
    });
}

function chaveBits(bits) {
  return bits.map((l) => l.join('')).join('/');
}

/** Primeira linha com algum píxel aceso. */
function topoDe(bits) {
  const t = bits.findIndex((l) => l.some(Boolean));
  return t < 0 ? 0 : t;
}

/**
 * Diferença entre um glifo e um molde: píxeis diferentes, encostados à direita
 * e **alinhados pelo topo de cada um**. O jogo põe os algarismos a frações de
 * píxel, e da linha 6 da mochila para baixo eles caem 1 px mais abaixo na casa
 * (medido). Com a faixa fixa, um "2" descido um píxel parecia um "3".
 */
function distancia(bits, molde) {
  const ta = topoDe(bits);
  const tb = topoDe(molde);
  const h = Math.max(bits.length - ta, molde.length - tb);
  const w = Math.max(bits[0].length, molde[0].length);
  let d = 0;
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w; i++) {
      const a = (bits[y + ta] || [])[bits[0].length - w + i] || 0;
      const b = (molde[y + tb] || [])[molde[0].length - w + i] || 0;
      if (a !== b) d++;
    }
  }
  return d;
}

/**
 * O glifo reduzido a uma grelha fixa de 8×12 (frações acesas por quadrado),
 * alinhado pela sua própria caixa, mais a proporção e a altura. É o que se
 * compara numa imagem reescalada de outra resolução: aí os contornos desfocam e
 * a comparação píxel a píxel falhava (1080p sintético: 4/35 → 27/35 com isto).
 */
function grelhaDoGlifo(bits) {
  const ys = [];
  const xs = [];
  bits.forEach((l, y) => l.forEach((b, x) => b && (ys.push(y), xs.push(x))));
  if (!ys.length) return null;
  const y0 = Math.min(...ys), y1 = Math.max(...ys), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const H = y1 - y0 + 1;
  const W = x1 - x0 + 1;
  const GW = 8, GH = 12;
  const g = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const ya = y0 + (j * H) / GH, yb = y0 + ((j + 1) * H) / GH;
      const xa = x0 + (i * W) / GW, xb = x0 + ((i + 1) * W) / GW;
      let s = 0, n = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          const w = (Math.min(y + 1, yb) - Math.max(y, ya)) * (Math.min(x + 1, xb) - Math.max(x, xa));
          s += (bits[y] && bits[y][x] ? 1 : 0) * w;
          n += w;
        }
      }
      g[j * GW + i] = s / n;
    }
  }
  return { g, asp: W / H, H };
}

const grelhasDosMoldes = new WeakMap();
function distanciaTolerante(bits, molde, moldes) {
  let cache = grelhasDosMoldes.get(moldes);
  if (!cache) grelhasDosMoldes.set(moldes, (cache = new Map()));
  let b = cache.get(molde);
  if (!b) cache.set(molde, (b = grelhaDoGlifo(molde.bits)));
  const a = grelhaDoGlifo(bits);
  if (!a || !b) return 99;
  let d = 0;
  for (let k = 0; k < a.g.length; k++) d += Math.abs(a.g[k] - b.g[k]);
  return d + Math.abs(a.asp - b.asp) * 6 + Math.abs(a.H - b.H) * 0.8;
}

/**
 * Lê a quantidade de uma casa. `moldes` = [{ c: '7', bits }].
 * Numa imagem reescalada (`img.reescalada`) usa a comparação tolerante.
 * Devolve { texto, valor, confianca } — ou null se a casa não tem número.
 * confianca = pior margem entre o melhor molde e o segundo de outro caráter
 * (0 = empate, a leitura não vale nada).
 */
function lerQuantidade(img, cx, moldes) {
  const gs = glifos(faixa(img, cx));
  if (!gs.length) return null;
  let texto = '';
  let confianca = Infinity;
  let pior = 0;
  for (const g of gs) {
    const ord = moldes
      .map((m) => ({ c: m.c, d: img.reescalada ? distanciaTolerante(g.bits, m, moldes) : distancia(g.bits, m.bits) }))
      .sort((a, b) => a.d - b.d);
    const melhor = ord[0];
    const outro = ord.find((o) => o.c !== melhor.c);
    texto += melhor.c;
    pior = Math.max(pior, melhor.d);
    confianca = Math.min(confianca, outro ? outro.d - melhor.d : 99);
  }
  return { texto, valor: valorDe(texto), confianca, distancia: pior };
}

// Onde acaba o número dentro da casa, pelo último caráter (medido nas duas
// capturas: o "1" acaba mais cedo, o "4" e o "K" mais tarde). O resto fica a 60,5.
const FIM_DO_NUMERO = { 1: 59, 4: 61.25, K: 61.5 };
const TOPO_DO_NUMERO = 50;

/**
 * Encontra a grelha da mochila numa imagem do ecrã inteiro, sem calibração.
 *
 * Procurar a grelha pelas separações entre casas não chega: as linhas repetem-se
 * de 74 em 74 e nada distingue a primeira (medido: acertava no x e errava o y).
 * O que a denuncia são os números das pilhas — algarismos com uma forma fixa,
 * sempre no mesmo sítio da casa. Por isso:
 *   1. máscara de píxeis de texto do ecrã todo, manchas com forma de algarismo;
 *   2. manchas lado a lado, à mesma altura, formam um número;
 *   3. cada número vota na casa onde estaria; ganha a fase da grelha (x mod
 *      71,25, y mod 74) com mais votos, e fica a janela de 5 colunas com mais
 *      números dentro (há números noutros sítios do ecrã: o chat, o HUD…);
 *   4. a origem final é a média dos votos — as colunas ficam a 71,25 px, por
 *      isso cada número sozinho erra até 1 px e a média acerta.
 * Devolve { origem: {x,y}, numeros, linhas } ou null se não há grelha à vista.
 */
function localizar(img, g = GEOMETRIA_1440) {
  const { largura: W, altura: H } = img;
  const mascara = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (eTexto(img, x, y)) mascara[y * W + x] = 1;

  // Manchas com forma de algarismo (8 vizinhos).
  const visto = new Uint8Array(W * H);
  const glifosEcra = [];
  const pilha = [];
  for (let i = 0; i < W * H; i++) {
    if (!mascara[i] || visto[i]) continue;
    let x0 = W, x1 = -1, y0 = H, y1 = -1, n = 0;
    pilha.push(i);
    visto[i] = 1;
    while (pilha.length) {
      const p = pilha.pop();
      const px = p % W;
      const py = (p - px) / W;
      n++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      if (n > 200) continue; // demasiado grande para ser um algarismo: deixa de crescer
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (mascara[q] && !visto[q]) {
            visto[q] = 1;
            pilha.push(q);
          }
        }
      }
    }
    const alt = y1 - y0 + 1;
    const larg = x1 - x0 + 1;
    if (n <= 200 && alt >= 9 && alt <= 11 && larg >= 2 && larg <= 9 && n >= 8) glifosEcra.push({ x0, x1, y0 });
  }

  // Números: glifos à mesma altura (±1) e a 0–4 px uns dos outros.
  glifosEcra.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const numeros = [];
  const usado = new Set();
  for (let i = 0; i < glifosEcra.length; i++) {
    if (usado.has(i)) continue;
    let fim = glifosEcra[i];
    usado.add(i);
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (let j = 0; j < glifosEcra.length; j++) {
        const o = glifosEcra[j];
        if (usado.has(j) || Math.abs(o.y0 - fim.y0) > 1) continue;
        if (o.x0 > fim.x1 && o.x0 - fim.x1 <= 6) {
          usado.add(j);
          fim = o;
          mudou = true;
        }
      }
    }
    numeros.push({ x1: fim.x1, y0: Math.min(glifosEcra[i].y0, fim.y0) });
  }
  if (numeros.length < 2) return null;

  // Cada número vota na casa onde estaria.
  const votos = numeros.map((n) => ({ x: n.x1 - 60.5, y: n.y0 - TOPO_DO_NUMERO }));
  const mod = (v, m) => ((v % m) + m) % m;
  let melhor = null;
  for (const v of votos) {
    const fx = mod(v.x, g.passoX);
    const fy = mod(v.y, g.passoY);
    const apoio = votos.filter((w) => {
      const dx = Math.abs(mod(w.x - fx + g.passoX / 2, g.passoX) - g.passoX / 2);
      const dy = Math.abs(mod(w.y - fy + g.passoY / 2, g.passoY) - g.passoY / 2);
      return dx <= 2.5 && dy <= 1.5;
    });
    if (!melhor || apoio.length > melhor.apoio.length) melhor = { fx, fy, apoio };
  }

  // Janela de 5 colunas com mais números; linhas contíguas a partir da primeira com números.
  const col = (v) => Math.round((v.x - melhor.fx) / g.passoX);
  const lin = (v) => Math.round((v.y - melhor.fy) / g.passoY);
  const cols = [...new Set(melhor.apoio.map(col))];
  let janela = null;
  for (const c0 of cols) {
    for (const ini of [c0 - 4, c0 - 3, c0 - 2, c0 - 1, c0]) {
      const dentro = melhor.apoio.filter((v) => col(v) >= ini && col(v) < ini + g.colunas);
      if (!janela || dentro.length > janela.dentro.length) janela = { ini, dentro };
    }
  }
  const dentro = janela.dentro;
  if (dentro.length < 2) return null;
  // Agrupa por linha e corta em buracos de 3+ linhas sem números (outro painel por baixo).
  const linhasCom = [...new Set(dentro.map(lin))].sort((a, b) => a - b);
  const grupos = [[linhasCom[0]]];
  for (const l of linhasCom.slice(1)) {
    const ult = grupos[grupos.length - 1];
    if (l - ult[ult.length - 1] <= 3) ult.push(l);
    else grupos.push([l]);
  }
  const grupo = grupos.sort((a, b) => dentro.filter((v) => b.includes(lin(v))).length - dentro.filter((v) => a.includes(lin(v))).length)[0];
  const finais = dentro.filter((v) => grupo.includes(lin(v)));
  const c0 = janela.ini;
  const r0 = grupo[0];

  const ox = finais.reduce((s, v) => s + (v.x - (col(v) - c0) * g.passoX), 0) / finais.length;
  const oy = finais.reduce((s, v) => s + (v.y - (lin(v) - r0) * g.passoY), 0) / finais.length;
  return {
    origem: { x: Math.round(ox), y: Math.round(oy) },
    numeros: finais.length,
    linhas: grupo[grupo.length - 1] - r0 + 1,
  };
}

/**
 * Afina o x com o último caráter de cada número lido (o "1" acaba 1,5 px antes
 * do "4"). Só se faz depois de localizar, que é quando já se sabe o que se leu.
 */
function afinarX(img, origem, moldes, linhas, g = GEOMETRIA_1440) {
  const desvios = [];
  for (let r = 0; r < linhas; r++) {
    for (let c = 0; c < g.colunas; c++) {
      const cx = casa(origem, c, r, g);
      const gs = glifos(faixa(img, cx));
      if (!gs.length) continue;
      const q = lerQuantidade(img, cx, moldes);
      if (!q || q.valor == null) continue;
      const esperado = FIM_DO_NUMERO[q.texto.slice(-1)] ?? 60.5;
      const real = gs[gs.length - 1].x1 + TEXTO.x0 + (cx.x - (origem.x + g.passoX * c));
      desvios.push(real - esperado);
    }
  }
  if (!desvios.length) return origem;
  const media = desvios.reduce((a, b) => a + b, 0) / desvios.length;
  return { x: Math.round(origem.x + media), y: origem.y };
}

/** "381,3K" → 381300 (o jogo arredonda: é um mínimo, não o número exato). */
function valorDe(texto) {
  const m = /^(\d+)(?:,(\d))?([KM]?)$/.exec(texto);
  if (!m) return null;
  const base = Number(m[1] + (m[2] ? '.' + m[2] : ''));
  return Math.round(base * ({ K: 1e3, M: 1e6 }[m[3]] || 1));
}

module.exports = { GEOMETRIA_1440, TEXTO, casa, faixa, glifos, chaveBits, distancia, lerQuantidade, valorDe, localizar, afinarX };
