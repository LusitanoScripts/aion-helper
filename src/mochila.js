'use strict';

// Ler a mochila inteira de uma imagem do ecrã: encontrar a grelha, e em cada
// casa a quantidade (src/inventario.js) e o item (src/icones.js).

const Inv = require('./inventario');
const { variacao } = require('./icones');

const MOLDES = require('./moldes-1440.json').moldes.map((m) => ({
  c: m.c,
  bits: m.bits.split('/').map((l) => [...l].map(Number)),
}));

const MAX_LINHAS = 15;

// A moeda do kinah, recortada de uma captura do utilizador (casa 1,0 do Cubo).
// É a mesma moeda prateada que aparece ao lado do preço da loja nos cartões.
// Medido em 3 capturas: a interface é desenhada igual ao píxel — kinah 0,0, a
// moeda dourada 13,4, qualquer outra casa 38+. Corta-se em 6.
const fs = require('fs');
const path = require('path');
const I = require('./imagem');
const KINAH = I.lerPNG(fs.readFileSync(path.join(__dirname, 'moedas', 'kinah.png')));
const MAX_DIF_MOEDA = 6;

/** Diferença média entre a casa e a moeda, sem a zona do número. */
function difMoeda(img, cx, molde) {
  let e = 0;
  let n = 0;
  for (let y = 0; y < 65; y++) {
    for (let x = 0; x < 65; x++) {
      if (y >= 44 && x >= 10) continue;
      const a = ((cx.y + y) * img.largura + cx.x + x) * 4;
      const b = (y * molde.largura + x) * 4;
      for (let k = 0; k < 3; k++) e += Math.abs(img.px[a + k] - molde.px[b + k]);
      n++;
    }
  }
  return e / n / 3;
}

/**
 * @returns null se não há mochila à vista; senão
 *   { origem, casas: [{ c, r, x, y, estado, ids?, quantidade?, texto?, diferenca?, margem? }] }
 *   estado: 'item' (identificado) | 'fora' (ocupada, sem par no mercado) — as vazias não vêm.
 */
/**
 * As medidas (casas, algarismos, moeda) são de 1440p. Noutra resolução, a imagem
 * é levada à escala de 1440p antes de se ler. Tenta-se primeiro a escala da
 * altura do ecrã (se se souber) e depois as resoluções comuns; fica a primeira
 * onde se encontra a mochila. Testado só com versões sintéticas das capturas do
 * utilizador (1080p 27/35, 1200p 33/35, 1600p 32/35, 4K 35/35 quantidades) —
 * daí a leitura vir marcada como experimental fora de 1440p.
 */
function lerMochila(img, catalogo, { alturaEcra = null } = {}) {
  const fatores = [...new Set([alturaEcra ? 1440 / alturaEcra : 1, 1, 1440 / 1080, 1440 / 1200, 1440 / 1600, 1440 / 2160].map((f) => +f.toFixed(4)))];
  for (const f of fatores) {
    const im = f === 1 ? img : Object.assign(I.escalar(img, f), { reescalada: true, limiarTexto: 150 });
    const r = lerMochilaA1440(im, catalogo);
    if (r) return { ...r, escala: f, img: im };
  }
  return null;
}

function lerMochilaA1440(img, catalogo) {
  const loc = Inv.localizar(img);
  if (!loc) return null;
  const origem = Inv.afinarX(img, loc.origem, MOLDES, loc.linhas);
  const g = Inv.GEOMETRIA_1440;
  const casas = [];
  for (let r = 0; r < MAX_LINHAS; r++) {
    let ocupadas = 0;
    for (let c = 0; c < g.colunas; c++) {
      const cx = Inv.casa(origem, c, r);
      if (cx.x < 2 || cx.y < 3 || cx.x + 66 > img.largura || cx.y + 66 > img.altura) continue;
      if (variacao(img, cx) < 12) continue;
      ocupadas++;
      const q = Inv.lerQuantidade(img, cx, MOLDES);
      let id = catalogo ? catalogo.identificar(img, cx) : { estado: 'fora' };
      if (id.estado === 'vazia') continue;
      // Reescalada, a moeda desfoca: kinah 5,7–9,2 e a dourada 15,5–17,4 (medido); corta-se em 12.
      const maxMoeda = img.reescalada ? 12 : MAX_DIF_MOEDA;
      if (id.estado === 'fora' && difMoeda(img, cx, KINAH) <= maxMoeda) id = { estado: 'moeda', moeda: 'Kinah' };
      casas.push({
        c,
        r,
        x: cx.x,
        y: cx.y,
        estado: id.estado,
        moeda: id.moeda,
        ids: id.estado === 'item' ? id.ids : undefined,
        melhor: id.melhor,
        diferenca: id.diferenca,
        margem: id.margem,
        // Sem número = 1 (equipamento e itens soltos não mostram quantidade).
        quantidade: q && q.valor != null ? q.valor : 1,
        texto: q ? q.texto : null,
      });
    }
    // Uma linha inteira vazia depois de haver itens = acabou a parte ocupada.
    if (!ocupadas && r >= loc.linhas) break;
  }
  return { origem, casas };
}

module.exports = { lerMochila, MOLDES, difMoeda, KINAH };
