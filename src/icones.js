'use strict';

// Identificar o item de uma casa pelo ícone, contra os ícones oficiais da NC
// dos itens que existem no mercado.
//
// O que se mediu (captura 2560×1440 do utilizador, 6 Out 2026):
//  · O jogo desenha o ícone a 68 px, centrado na casa de 65 (passa 1,5 px de
//    cada lado). Com esse alinhamento, os pares certos dão diferença 10–13;
//    desalinhado, dava 12–15 e não separava nada.
//  · Comparar só a parte opaca do ícone deixa ganhar ícones finos e quase
//    transparentes (uma capa ganhava a um fragmento de cristal). Compõe-se o
//    ícone por cima da cor de fundo da própria casa e compara-se a casa toda.
//  · Itens da mesma família têm ícones muito parecidos (Pedra Vital com e sem
//    aro, poções de frasco diferente). Esses ganham com margem 8, mas a diferença
//    absoluta denuncia-os: certos ≤ 13,0, o falso mais perto 17,3. Regra:
//    diferença ≤ 15 E margem ≥ 5. Abaixo disso a casa fica "fora do mercado" —
//    um item vinculado nunca pode aparecer com o preço de outro.
//  · Itens diferentes podem partilhar o ícone (as versões "Brilhante"). Nesse
//    caso devolvem-se todos os ids.

const fs = require('fs');
const path = require('path');
const I = require('./imagem');

const LADO_ICONE = 68;
const MINI = 16;
const MAX_DIFERENCA = 15;
const MIN_MARGEM = 5;
const MIN_VARIACAO = 12; // desvio de brilho: vazias 3–7, ocupadas 19+
const TRIAGEM = 12;

/** Desvio-padrão do brilho no interior da casa: separa vazias de ocupadas. */
function variacao(img, cx) {
  let s = 0, s2 = 0, n = 0;
  for (let y = cx.y + 6; y < cx.y + 59; y++) {
    for (let x = cx.x + 6; x < cx.x + 59; x++) {
      const v = I.luz(img, x, y);
      s += v;
      s2 += v * v;
      n++;
    }
  }
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

/** Cor de fundo da casa: cantos onde quase nunca há ícone (nem número). */
function fundo(img, cx) {
  const bg = [0, 0, 0];
  let n = 0;
  for (const [ax, ay] of [[1, 1], [60, 1], [1, 60]]) {
    for (let y = ay; y < ay + 4; y++) {
      for (let x = ax; x < ax + 4; x++) {
        const d = ((cx.y + y) * img.largura + cx.x + x) * 4;
        for (let k = 0; k < 3; k++) bg[k] += img.px[d + k];
        n++;
      }
    }
  }
  return bg.map((v) => v / n);
}

/** Zona do número (canto inferior direito) — não conta para a comparação. */
function eZonaDoNumero(x, y) {
  return y >= 46 && x >= 20;
}

function diferenca(img, cx, ic, bg, ox, oy) {
  let e = 0, n = 0;
  const S = LADO_ICONE;
  for (let y = 0; y < 65; y++) {
    for (let x = 0; x < 65; x++) {
      if (eZonaDoNumero(x, y)) continue;
      const ix = x - ox;
      const iy = y - oy;
      if (ix < 0 || iy < 0 || ix >= S || iy >= S) continue;
      const q = (iy * S + ix) * 4;
      const a = ic.px[q + 3] / 255;
      const d = ((cx.y + y) * img.largura + cx.x + x) * 4;
      e += Math.abs(img.px[d] - (ic.px[q] * a + bg[0] * (1 - a)));
      e += Math.abs(img.px[d + 1] - (ic.px[q + 1] * a + bg[1] * (1 - a)));
      e += Math.abs(img.px[d + 2] - (ic.px[q + 2] * a + bg[2] * (1 - a)));
      n++;
    }
  }
  return e / n / 3;
}

class Catalogo {
  /** @param entradas [{ icone: url, ids: [id...], img: imagem 68×68 }] */
  constructor(entradas) {
    this.entradas = entradas.map((e) => ({ ...e, mini: I.redimensionar(e.img, MINI, MINI) }));
  }

  get tamanho() {
    return this.entradas.length;
  }

  /**
   * { estado: 'vazia' } | { estado: 'item', ids, diferenca, margem } |
   * { estado: 'fora', melhor: { ids, diferenca, margem } } — ocupada mas sem par seguro.
   */
  identificar(img, cx) {
    if (variacao(img, cx) < MIN_VARIACAO) return { estado: 'vazia' };
    const bg = fundo(img, cx);

    // Triagem barata a 16 px: a casa (com o ícone a 68 centrado) reduzida.
    const casaMini = I.redimensionar(I.recortar(img, cx.x - 2, cx.y - 2, LADO_ICONE, LADO_ICONE), MINI, MINI);
    const pre = this.entradas
      .map((e) => {
        let s = 0;
        for (let i = 0; i < MINI * MINI; i++) {
          const a = e.mini.px[i * 4 + 3] / 255;
          for (let k = 0; k < 3; k++) s += Math.abs(casaMini.px[i * 4 + k] - (e.mini.px[i * 4 + k] * a + bg[k] * (1 - a)));
        }
        return { e, s };
      })
      .sort((a, b) => a.s - b.s)
      .slice(0, TRIAGEM);

    // A sério, a 68 px, com folga de ±1–2 px no alinhamento (as colunas ficam a
    // 71,25 px e a casa arredonda-se ao píxel).
    const ord = pre
      .map(({ e }) => {
        let d = Infinity;
        for (const oy of [-3, -2, -1]) for (const ox of [-3, -2, -1, 0]) d = Math.min(d, diferenca(img, cx, e.img, bg, ox, oy));
        return { e, d };
      })
      .sort((a, b) => a.d - b.d);

    const [p, s] = ord;
    const margem = s ? s.d - p.d : 99;
    const res = { ids: p.e.ids, diferenca: +p.d.toFixed(1), margem: +margem.toFixed(1) };
    if (p.d <= MAX_DIFERENCA && margem >= MIN_MARGEM) return { estado: 'item', ...res };
    return { estado: 'fora', melhor: res };
  }
}

/**
 * Carrega (ou descarrega e guarda) os ícones a 68 px. `fichas` = { id: ficha }.
 * Guardam-se já reduzidos: o original tem 256×256 e ~76 KB; reduzido fica ~18 KB
 * em PNG e evita refazer a redução de 419 ícones a cada leitura.
 */
async function carregarCatalogo(fichas, dir, { buscar = fetch, aoProgresso } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const porIcone = new Map();
  for (const [id, f] of Object.entries(fichas)) {
    if (!f || !f.icone) continue;
    if (!porIcone.has(f.icone)) porIcone.set(f.icone, []);
    porIcone.get(f.icone).push(Number(id));
  }
  const entradas = [];
  let feitos = 0;
  let falhas = 0;
  for (const [url, ids] of porIcone) {
    const ficheiro = path.join(dir, path.basename(new URL(url).pathname));
    let img = null;
    try {
      img = I.lerPNG(fs.readFileSync(ficheiro));
    } catch {
      try {
        const r = await buscar(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        img = I.redimensionar(I.lerPNG(Buffer.from(await r.arrayBuffer())), LADO_ICONE, LADO_ICONE);
        fs.writeFileSync(ficheiro, I.escreverPNG(img));
      } catch {
        falhas++;
      }
    }
    if (img) entradas.push({ icone: url, ids, img });
    feitos++;
    if (aoProgresso && feitos % 20 === 0) aoProgresso({ feitos, total: porIcone.size });
  }
  if (aoProgresso) aoProgresso({ feitos, total: porIcone.size, fim: true, falhas });
  return new Catalogo(entradas);
}

module.exports = { Catalogo, carregarCatalogo, variacao, LADO_ICONE, MAX_DIFERENCA, MIN_MARGEM };
