'use strict';

// A coleção de mascotes do jogo lida pelos RETRATOS, não pelos nomes.
//
// Na janela "Pets" a grelha só mostra o retrato de cada mascote (o nome só
// aparece à direita, para a que estiver escolhida) — ler pelo nome obrigava a
// clicar uma a uma. Mas o retrato da carta é o retrato oficial da NC
// (UT_Vehicle_Portrait_*.png, o mesmo da ficha do item), escalado e recortado
// sempre da mesma maneira. Medido numa captura a 2559×1439 (12 out. 2026):
//
//  - cartas de 154×209 px, colunas em x = 128 / 296 / 464, linhas de 231 em 231;
//  - entre linhas há ~13 linhas de preto puro (luz 0–2) e depois a borda da carta
//    (luz ~40) — é assim que se acham as linhas em qualquer ponto do scroll;
//  - carta normal: retrato a 0,76 (195 px), janela a partir de (20, −6);
//  - carta escolhida: o jogo amplia-a — retrato a 0,95, janela a partir de (44, 20);
//  - fundo atrás do retrato: (24, 28, 44).
//
// Compara-se só os 72% de cima (em baixo estão o nível e o progresso das almas).
// Na captura: 14/14 cartas normais certas, diferença 6–21 contra 33–58 da 2.ª
// mais parecida; a escolhida acerta com a 2.ª transformação. Outras resoluções:
// escala-se tudo pela altura (a interface do jogo escala com a altura) — por medir.

const REF_ALTURA = 1440;
const CARTA = { w: 154, h: 209 };
const COLUNAS = [128, 296, 464];
const PASSO_Y = 231;
const ZONA_Y = [190, 1310]; // a janela da lista (de cima a baixo), a 1440p: abaixo de ~1308 está tapada
const FUNDO = [24, 28, 44];
const TRANSFORMACOES = [
  { nome: 'normal', escala: 0.76, ox: 20, oy: -6 },
  { nome: 'escolhida', escala: 0.95, ox: 44, oy: 20 },
];
const PASSO = 4; // amostragem dos pontos, em px a 1440p
const ACEITA = 28; // diferença média máxima
const MARGEM = 10; // a 2.ª tem de estar pelo menos isto mais longe
// A carta escolhida tem "Equipped" e uma moldura por cima: aceita-se mais longe se a margem for grande.
const ACEITA_LARGA = 42;
const MARGEM_LARGA = 18;

const PONTOS = [];
for (let y = 6; y < CARTA.h * 0.72; y += PASSO) for (let x = 6; x < CARTA.w - 6; x += PASSO) PONTOS.push([x, y]);

/** Assinatura de um retrato (RGBA 256×256 já escalado para `lado`), numa transformação. */
function assinaturaRetrato(ret, t) {
  const L = ret.largura;
  const out = new Float32Array(PONTOS.length * 3);
  PONTOS.forEach(([x, y], k) => {
    const rx = t.ox + x;
    const ry = t.oy + y;
    let a = 0;
    let c = [0, 0, 0];
    if (rx >= 0 && ry >= 0 && rx < L && ry < ret.altura) {
      const i = (ry * L + rx) * 4;
      a = ret.px[i + 3] / 255;
      c = [ret.px[i], ret.px[i + 1], ret.px[i + 2]];
    }
    for (let q = 0; q < 3; q++) out[k * 3 + q] = c[q] * a + FUNDO[q] * (1 - a);
  });
  return out;
}

/**
 * Catálogo de assinaturas: [{ id, nome, sigs: [normal, escolhida] }].
 * `retratos` = [{ id, nome, img }] com a imagem RGBA original (256×256);
 * `redimensionar(img, l, a)` vem do src/imagem.js.
 */
function catalogoRetratos(retratos, redimensionar) {
  return retratos.map((r) => ({
    id: r.id,
    nome: r.nome,
    sigs: TRANSFORMACOES.map((t) => {
      const lado = Math.round(r.img.largura * t.escala);
      return assinaturaRetrato(redimensionar(r.img, lado, lado), t);
    }),
  }));
}

/** Luz média de uma linha horizontal das três colunas. */
function luzLinha(img, ox, oy, k, y) {
  const W = img.largura;
  let soma = 0;
  let n = 0;
  const yy = Math.round(oy + y * k);
  if (yy < 0 || yy >= img.altura) return 255;
  for (const cx of COLUNAS) {
    for (let x = cx + 4; x < cx + CARTA.w - 4; x += 3) {
      const xx = Math.round(ox + x * k);
      if (xx < 0 || xx >= W) continue;
      const i = (yy * W + xx) * 4;
      soma += img.px[i] + img.px[i + 1] + img.px[i + 2];
      n++;
    }
  }
  return n ? soma / (3 * n) : 255;
}

/**
 * Os topos das linhas de cartas visíveis (em px a 1440p, relativos à janela do jogo).
 * Um topo é a primeira linha clara depois de ≥ 8 linhas de preto puro.
 */
function topos(img, ox, oy, k) {
  const achados = [];
  let preto = 0;
  for (let y = ZONA_Y[0]; y < ZONA_Y[1]; y++) {
    const v = luzLinha(img, ox, oy, k, y);
    if (v < 4) {
      preto++;
      continue;
    }
    // > 30: a 1.ª linha depois do preto ainda é transição (~23); a borda da carta é ~41.
    if (preto >= 8 && v > 30) achados.push(y);
    else if (v <= 30) continue; // transição: não zera o preto
    preto = 0;
  }
  if (!achados.length) return [];
  // As linhas estão sempre de PASSO_Y em PASSO_Y: a "fase" mais votada decide, e
  // um topo isolado errado (a moldura ampliada da carta escolhida) não estraga.
  const votos = new Map();
  for (const y of achados) {
    const f = y % PASSO_Y;
    let chave = f;
    for (const c of votos.keys()) if (Math.min(Math.abs(c - f), PASSO_Y - Math.abs(c - f)) <= 2) chave = c;
    votos.set(chave, (votos.get(chave) || 0) + 1);
  }
  const fase = [...votos.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const out = [];
  for (let y = fase; y < ZONA_Y[1]; y += PASSO_Y) if (y >= ZONA_Y[0] - 12) out.push(y);
  return out;
}

function assinaturaCarta(img, ox, oy, k, cx, cy) {
  const W = img.largura;
  const out = new Float32Array(PONTOS.length * 3);
  PONTOS.forEach(([x, y], n) => {
    const xx = Math.round(ox + (cx + x) * k);
    const yy = Math.round(oy + (cy + y) * k);
    const i = (Math.min(img.altura - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))) * 4;
    for (let q = 0; q < 3; q++) out[n * 3 + q] = img.px[i + q];
  });
  return out;
}

function distancia(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * As cartas visíveis e quem é cada uma.
 * `img` = imagem do ecrã; `janela` = [x, y, w, h] do jogo dentro da imagem.
 * Devolve [{ linha, coluna, x, y, w, h (na imagem), id, nome, d, margem, certa }].
 */
function lerCartas(img, janela, cat) {
  const [jx, jy, , jh] = janela;
  const k = jh / REF_ALTURA;
  const out = [];
  const tops = topos(img, jx, jy, k);
  tops.forEach((ty, linha) => {
    // Só cartas com a parte comparada inteira à vista.
    if (ty + CARTA.h * 0.72 > ZONA_Y[1]) return;
    COLUNAS.forEach((cx, coluna) => {
      const sig = assinaturaCarta(img, jx, jy, k, cx, ty);
      let a = null;
      let b = null;
      for (const m of cat) {
        const d = Math.min(...m.sigs.map((s) => distancia(sig, s)));
        if (!a || d < a.d) {
          if (!a || a.id !== m.id) b = a;
          a = { id: m.id, nome: m.nome, d };
        } else if (!b || d < b.d) b = { id: m.id, nome: m.nome, d };
      }
      if (!a) return;
      const margem = b ? b.d - a.d : 99;
      out.push({
        linha,
        coluna,
        x: Math.round(jx + cx * k),
        y: Math.round(jy + ty * k),
        w: Math.round(CARTA.w * k),
        h: Math.round(CARTA.h * k),
        id: a.id,
        nome: a.nome,
        d: Math.round(a.d * 10) / 10,
        margem: Math.round(margem * 10) / 10,
        certa: (a.d <= ACEITA && margem >= MARGEM) || (a.d <= ACEITA_LARGA && margem >= MARGEM_LARGA),
      });
    });
  });
  return out;
}

/**
 * O nível da mascote pelo algarismo do círculo em baixo à esquerda (só existe nas
 * obtidas). Medido a 1440p: "1" branco 53 px numa caixa 6×18, "2" branco 84 px
 * 13×19, "3" ciano 95 px 12×20 (61 na carta escolhida, ampliada). Exige-se a
 * forma e não só a cor, porque a arte também tem píxeis claros.
 * `c` é uma carta de lerCartas (x, y na imagem); `k` = altura do jogo / 1440.
 */
function nivelDaCarta(img, c, k) {
  const W = img.largura;
  const brancos = [];
  const cianos = [];
  for (let y = Math.round(c.y + 184 * k); y < c.y + 210 * k; y++) {
    for (let x = Math.round(c.x + 1 * k); x < c.x + 20 * k; x++) {
      if (x < 0 || y < 0 || x >= W || y >= img.altura) continue;
      const i = (y * W + x) * 4;
      const r = img.px[i];
      const g = img.px[i + 1];
      const b = img.px[i + 2];
      if (r > 170 && g > 170 && b > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 50) brancos.push([x, y]);
      else if (g > 150 && b > 150 && r < 130) cianos.push([x, y]);
    }
  }
  const caixa = (a) => {
    if (!a.length) return { w: 0, h: 0, n: 0 };
    const xs = a.map((p) => p[0]);
    const ys = a.map((p) => p[1]);
    return { w: (Math.max(...xs) - Math.min(...xs) + 1) / k, h: (Math.max(...ys) - Math.min(...ys) + 1) / k, n: a.length / (k * k) };
  };
  const ci = caixa(cianos);
  if (ci.n >= 40 && ci.n <= 130 && ci.h >= 13 && ci.h <= 23 && ci.w >= 7 && ci.w <= 15) return 3;
  const br = caixa(brancos);
  if (br.h < 15 || br.h > 22) return null;
  if (br.n >= 38 && br.n <= 70 && br.w <= 9) return 1;
  if (br.n > 70 && br.n <= 110 && br.w >= 10 && br.w <= 16) return 2;
  return null;
}

// ── almas ("15/75" em baixo à direita da carta) ──────────────────────────────
// O OCR do Windows lê mal este texto por cima da arte. Limpa-se primeiro: só os
// píxeis de branco puro (o texto é branco 255 com contorno escuro; a arte quase
// nunca é), numa faixa apertada (x 78–146, y 177–194 a 1440p — acima disso o
// pelo branco de algumas mascotes encosta), ampliado ×4, e as tiras de todas as
// cartas numa só imagem → um OCR por ecrã. O denominador vem do nível (1 → 25,
// 2 → 75; o 3 é o máximo, "MAX" em ciano): se o OCR perder a barra ("21125"),
// corta-se o denominador conhecido e a contagem de glifos diz onde estava a barra.
// Captura de 12 out.: 8/8 certas.

const TIRA = { x0: 78, x1: 146, y0: 177, y1: 194, escala: 4, espaco: 16 };
const ALMAS_POR_NIVEL = { 1: 25, 2: 75 };

/** A tira limpa (booleans, a 1440p) e quantos glifos tem. */
function tiraAlmas(img, c, k) {
  const W = img.largura;
  const tw = TIRA.x1 - TIRA.x0;
  const th = TIRA.y1 - TIRA.y0;
  const bits = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const xx = Math.round(c.x + (TIRA.x0 + x) * k);
      const yy = Math.round(c.y + (TIRA.y0 + y) * k);
      if (xx < 0 || yy < 0 || xx >= W || yy >= img.altura) continue;
      const i = (yy * W + xx) * 4;
      if (img.px[i] > 225 && img.px[i + 1] > 225 && img.px[i + 2] > 225) bits[y * tw + x] = 1;
    }
  }
  let glifos = 0;
  let dentro = false;
  for (let x = 0; x < tw; x++) {
    let n = 0;
    for (let y = 0; y < th; y++) n += bits[y * tw + x];
    if (n >= 2 && !dentro) glifos++;
    dentro = n >= 2;
  }
  return { bits, glifos, w: tw, h: th };
}

/** As tiras umas por baixo das outras, pretas sobre branco, ampliadas: a imagem para o OCR. */
function montarTiras(tiras) {
  const E = TIRA.escala;
  const tw = TIRA.x1 - TIRA.x0;
  const th = TIRA.y1 - TIRA.y0;
  const passo = th * E + TIRA.espaco;
  const largura = tw * E + 40;
  const altura = tiras.length * passo + TIRA.espaco;
  const px = new Uint8Array(largura * altura * 4).fill(255);
  tiras.forEach((t, n) => {
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        if (!t.bits[y * tw + x]) continue;
        for (let dy = 0; dy < E; dy++) {
          for (let dx = 0; dx < E; dx++) {
            const o = ((TIRA.espaco + n * passo + y * E + dy) * largura + 20 + x * E + dx) * 4;
            px[o] = px[o + 1] = px[o + 2] = 0;
          }
        }
      }
    }
  });
  return { img: { largura, altura, px }, passo };
}

/** Em que tira caiu cada linha do OCR → texto por tira. */
function textoPorTira(linhas, passo, n) {
  const out = Array.from({ length: n }, () => '');
  for (const l of linhas || []) {
    const i = Math.floor(((l.y1 + l.y2) / 2 - TIRA.espaco) / passo);
    if (i >= 0 && i < n) out[i] += String(l.t || '');
  }
  return out;
}

/** "15/75" (ou o que o OCR fez dele) → { tem, precisa } ou null. */
function lerAlmas(texto, nivel, glifos) {
  const t = String(texto || '').replace(/\s+/g, '');
  const precisa = ALMAS_POR_NIVEL[nivel] || null;
  const m = /(\d{1,3})\/(\d{2,3})/.exec(t);
  if (m && (!precisa || +m[2] === precisa)) {
    // Limpo ("15/75") aceita-se; com lixo à volta ("*JI 5/25" era 15/25) só se a
    // contagem de glifos bater — mais vale "não sei" (relê-se a seguir) que um número errado.
    if (m[0] === t || m[1].length === glifos - 3) return { tem: +m[1], precisa: +m[2] };
    return null;
  }
  if (!precisa) return null;
  const d = t.replace(/[^0-9]/g, '');
  const den = String(precisa);
  if (!d.endsWith(den)) return null;
  const resto = d.slice(0, -den.length);
  // Com a barra lida como algarismo ("21125") há glifos-2 algarismos antes do fim; sem ela, glifos-3.
  let num = null;
  if (glifos >= 4 && resto.length === glifos - 2) num = resto.slice(0, -1);
  else if (glifos >= 4 && resto.length === glifos - 3) num = resto;
  if (num == null || !num.length || +num > precisa) return null;
  return { tem: +num, precisa };
}

/**
 * Junta às cartas o que o OCR leu na grelha: o nível (o número no círculo, em
 * baixo à esquerda) e o progresso das almas ("15/75" ou "MAX", em baixo à direita).
 * Uma carta com nível ou progresso é uma mascote obtida.
 */
function juntarTexto(cartas, linhas) {
  for (const c of cartas) {
    const baixo = c.y + c.h * 0.78;
    for (const l of linhas || []) {
      const mx = (l.x1 + l.x2) / 2;
      const my = (l.y1 + l.y2) / 2;
      if (mx < c.x || mx > c.x + c.w || my < baixo || my > c.y + c.h + 6) continue;
      const t = String(l.t || '').replace(/\s+/g, '');
      const p = /(\d{1,3})\/(\d{1,3})/.exec(t);
      if (p) c.almas = { tem: +p[1], precisa: +p[2] };
      else if (/MAX/i.test(t)) c.max = true;
      const n = /^([123])(?!\d|\/)/.exec(t);
      if (n && mx < c.x + c.w * 0.35) c.nivel = +n[1];
    }
    c.obtida = !!(c.nivel || c.almas || c.max) || null;
  }
  return cartas;
}

module.exports = { catalogoRetratos, lerCartas, nivelDaCarta, tiraAlmas, montarTiras, textoPorTira, lerAlmas, ALMAS_POR_NIVEL, juntarTexto, topos, TRANSFORMACOES, CARTA, COLUNAS, REF_ALTURA };
