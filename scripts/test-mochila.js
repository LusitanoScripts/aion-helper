'use strict';

// A mochila inteira sobre as duas capturas reais do utilizador, sem rede.
//
// O catálogo de teste tem os 6 ícones que estão de facto na mochila e no
// mercado, e 10 enganadores escolhidos por serem os que mais se aproximaram nas
// medições (a Pedra Vital com aro, a poção de outro frasco, a capa quase
// transparente que "ganhava" a um cristal…). Se algum enganador passar, a regra
// de aceitação deixou de proteger.
//
// O teste contra os 419 ícones do mercado é o `scripts/verify-mochila.js` (rede).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require('../src/imagem');
const Inv = require('../src/inventario');
const { Catalogo } = require('../src/icones');
const { lerMochila } = require('../src/mochila');

const DIR = path.join(__dirname, 'amostras');
const indice = JSON.parse(fs.readFileSync(path.join(DIR, 'icones68', 'indice.json'), 'utf8'));
const nome = {};
for (const e of indice) for (const it of e.itens) nome[it.id] = it.nome;
const catalogo = new Catalogo(
  indice.map((e) => ({
    icone: e.ficheiro,
    ids: e.itens.map((i) => i.id),
    img: I.lerPNG(fs.readFileSync(path.join(DIR, 'icones68', e.ficheiro))),
  })),
);

// Verificado a olho, casa a casa, numa folha lado a lado.
const ESPERADO = {
  '0,1': ['Cristal de Vida', 17],
  '2,1': ['Poção de Vida Superior', 2],
  '4,1': ['Carne Frita com Kukuru', 10],
  '1,2': ['Pergaminho de Resistência a Alteração de Estado', 5],
  '1,6': ['Od', 3],
  '2,6': ['Pedra de Mana Inferior', 3],
};

let n = 0;
for (const [ficheiro, origem] of [
  ['cubo-600x990.png', { x: 208, y: 87 }],
  ['cubo-tooltip-1090x1018.png', { x: 701, y: 66 }],
]) {
  const img = I.lerPNG(fs.readFileSync(path.join(DIR, ficheiro)));
  const r = lerMochila(img, catalogo);
  assert.ok(r, `${ficheiro}: não encontrou a mochila`);
  assert.deepStrictEqual(r.origem, origem, `${ficheiro}: grelha no sítio errado`);
  assert.strictEqual(r.casas.length, 35, `${ficheiro}: ${r.casas.length} casas ocupadas, eram 35`);

  const itens = r.casas.filter((c) => c.estado === 'item');
  const lidos = {};
  for (const c of itens) lidos[`${c.c},${c.r}`] = [c.ids.map((id) => nome[id]), c.quantidade];
  for (const [k, [n1, q]] of Object.entries(ESPERADO)) {
    assert.ok(lidos[k], `${ficheiro}: casa ${k} (${n1}) não foi identificada`);
    assert.ok(lidos[k][0].includes(n1), `${ficheiro}: casa ${k} deu ${lidos[k][0]} em vez de ${n1}`);
    assert.strictEqual(lidos[k][1], q, `${ficheiro}: casa ${k} com ${lidos[k][1]} em vez de ${q}`);
  }
  const extra = Object.keys(lidos).filter((k) => !ESPERADO[k]);
  assert.deepStrictEqual(extra, [], `${ficheiro}: enganadores aceites em ${extra.map((k) => k + ' → ' + lidos[k][0]).join(', ')}`);

  // As quantidades das casas fora do mercado também contam (é o que se mostra).
  const kinah = r.casas.find((c) => c.c === 1 && c.r === 0);
  assert.strictEqual(kinah.texto, '381,3K');
  n++;
}

// ── encontrar a mochila num ecrã inteiro com números soltos à volta ───────
{
  const b = I.lerPNG(fs.readFileSync(path.join(DIR, 'cubo-tooltip-1090x1018.png')));
  let semente = 7;
  const rnd = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
  const W = 2560, H = 1440;
  const tela = { largura: W, altura: H, px: new Uint8Array(W * H * 4) };
  for (let i = 0; i < W * H; i++) {
    const v = 30 + rnd() * 60;
    tela.px.set([v, v * 0.9, v * 0.8, 255], i * 4);
  }
  const colar = (sx, sy, w, h, dx, dy) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((sy + y) * b.largura + sx + x) * 4;
        tela.px.set(b.px.subarray(s, s + 4), ((dy + y) * W + dx + x) * 4);
      }
    }
  };
  colar(0, 0, b.largura, b.altura, 1400, 250);
  for (let k = 0; k < 40; k++) {
    const cx = Inv.casa({ x: 701, y: 66 }, k % 5, k % 7);
    colar(cx.x + 30, cx.y + 48, 35, 14, Math.floor(rnd() * 1300), Math.floor(rnd() * 1400));
  }
  const r = lerMochila(tela, catalogo);
  assert.deepStrictEqual(r && r.origem, { x: 2101, y: 316 }, 'não encontrou a mochila no ecrã com 40 números soltos');
  n++;
}

// ── um ecrã sem mochila não inventa uma ──────────────────────────────────
{
  const W = 800, H = 600;
  const vazio = { largura: W, altura: H, px: new Uint8Array(W * H * 4).fill(40) };
  assert.strictEqual(lerMochila(vazio, catalogo), null);
  n++;
}

// ── o kinah (moeda prateada) conta-se à parte, em todas as capturas ──────
for (const [f, q] of [
  ['cubo-600x990.png', 381300],
  ['cubo-2cartoes-1600x1099.png', 403800],
  ['elmos-1562x941.png', 540800],
  ['cubo-tooltip-1090x1018.png', 381300],
]) {
  const r = lerMochila(I.lerPNG(fs.readFileSync(path.join(DIR, f))), catalogo);
  const moedas = r.casas.filter((c) => c.estado === 'moeda');
  assert.strictEqual(moedas.length, 1, `${f}: ${moedas.length} moedas de kinah`);
  assert.strictEqual(moedas[0].moeda, 'Kinah');
  assert.strictEqual(moedas[0].quantidade, q, `${f}: kinah ${moedas[0].quantidade}`);
  assert.deepStrictEqual([moedas[0].c, moedas[0].r], [1, 0]);
}
n++;

// ── outras resoluções (sintéticas: a captura de 1440p reduzida/ampliada) ──
// Não é igual a uma captura verdadeira (o jogo desenha o texto de raiz em cada
// resolução), mas guarda o que se mediu: a grelha acha-se sempre, nenhum item
// errado, e o kinah reconhece-se.
{
  const orig = I.lerPNG(fs.readFileSync(path.join(DIR, 'cubo-600x990.png')));
  for (const res of [1080, 1200, 1600, 2160]) {
    const r = lerMochila(I.escalar(orig, res / 1440), catalogo, { alturaEcra: res });
    assert.ok(r, `${res}p: não encontrou a mochila`);
    assert.deepStrictEqual(r.origem, { x: 208, y: 87 }, `${res}p: grelha no sítio errado`);
    assert.strictEqual(r.casas.length, 35, `${res}p: ${r.casas.length} casas ocupadas`);
    for (const c of r.casas.filter((x) => x.estado === 'item')) {
      const certo = ESPERADO[`${c.c},${c.r}`];
      assert.ok(certo && c.ids.some((id) => nome[id] === certo[0]), `${res}p: casa ${c.c},${c.r} identificada como ${c.ids.map((id) => nome[id])}`);
    }
    assert.ok(r.casas.filter((x) => x.estado === 'item').length >= 5, `${res}p: poucos itens reconhecidos`);
    assert.ok(r.casas.some((x) => x.moeda === 'Kinah'), `${res}p: kinah não reconhecido`);
  }
  n++;
}

console.log(`test-mochila: ${n} testes passaram`);
