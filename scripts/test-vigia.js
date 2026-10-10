'use strict';

// A vigia com um OCR falso: o que entra são rodapés e linhas de texto, como os
// que o src/ocr.ps1 devolve; o que sai são as faixas a mostrar.

const assert = require('assert');
const { Vigia, diferencas, nomeDoCartao } = require('../src/vigia');

let n = 0;
const R1 = { esquerda: 1398, direita: 1866, topo: 1042, fundo: 1104 };
const R2 = { esquerda: 1882, direita: 2350, topo: 1066, fundo: 1130 };

// ── diferenças: o mesmo cartão com 1–2 px de diferença continua o mesmo ──
{
  const d = diferencas([R1], [{ ...R1, fundo: R1.fundo + 2 }, R2]);
  assert.strictEqual(d.novos.length, 1);
  assert.deepStrictEqual(d.novos[0], R2);
  assert.strictEqual(d.ficam.length, 1);
  assert.strictEqual(d.foram.length, 0);
  assert.strictEqual(diferencas([R1, R2], []).foram.length, 2);
  n++;
}

// ── nome: letra grande, encostada à borda, a mais acima ───────────────────
{
  const linhas = [
    { x1: 1419, y1: 500, x2: 1700, y2: 518, t: 'Elmo do Forasteiro' },
    { x1: 1419, y1: 535, x2: 1500, y2: 548, t: 'Comum Elmo' }, // letra pequena
    { x1: 1600, y1: 480, x2: 1700, y2: 500, t: 'Cubo' }, // fora da borda
    { x1: 1419, y1: 1200, x2: 1600, y2: 1220, t: 'Abaixo do rodapé' },
  ];
  assert.deepStrictEqual(nomeDoCartao(linhas, R1), { nome: 'Elmo do Forasteiro', cortado: false, topoNome: 500 });
  assert.deepStrictEqual(nomeDoCartao([{ x1: 1419, y1: 500, x2: 1800, y2: 524, t: 'Pergaminho de Bendição (Vincu...' }], R1), {
    nome: 'Pergaminho de Bendição (Vincu',
    cortado: true,
    topoNome: 500,
  });
  assert.strictEqual(nomeDoCartao([], R1), null);
  n++;
}

// ── a vigia: mostra ao abrir, esconde ao fechar, não relê o mesmo cartão ──
async function vigiaFalsa() {
  let ecra = { jogo: true, janela: [0, 0, 2560, 1440], rodapes: [] };
  const leituras = [];
  const mostrados = [];
  const ocr = {
    ver: async () => ecra,
    lerZona: async (x) => {
      leituras.push(x);
      return [{ x1: x + 21, y1: 300, x2: x + 300, y2: 318, t: x === R1.esquerda ? 'Elmo do Forasteiro' : 'Botas do Caos' }];
    },
  };
  const v = new Vigia({
    ocr,
    faixaDe: async (c) => ({ nome: c.nome, x: c.x, y: c.fundo }),
    mostrar: (f) => mostrados.push(f.map((x) => x.nome)),
  });
  v.ligado = true;
  const mudar = (rs) => (ecra = { ...ecra, rodapes: rs });

  mudar([R1]);
  await v.passo();
  assert.deepStrictEqual(mostrados.pop(), ['Elmo do Forasteiro']);
  await v.passo();
  await v.passo();
  assert.strictEqual(leituras.length, 1, 'o mesmo cartão aberto não se relê');
  assert.strictEqual(mostrados.length, 0, 'nada mudou, nada se redesenha');

  mudar([R1, R2]); // o cartão do equipado, para comparar
  await v.passo();
  assert.deepStrictEqual(mostrados.pop(), ['Elmo do Forasteiro', 'Botas do Caos']);

  mudar([]); // fechou: a faixa vai-se logo, não fica a flutuar
  await v.passo();
  assert.deepStrictEqual(mostrados.pop(), []);

  mudar([R1]);
  ecra = { jogo: false }; // alt-tab: o jogo deixou de estar à frente
  await v.passo();
  assert.strictEqual(mostrados.length, 0);
  n++;
}

// ── sem nome: não relê a cada volta, mas volta a tentar ao fim de 1 s ─────
async function semNome() {
  let lidas = 0;
  const ocr = {
    ver: async () => ({ jogo: true, janela: [0, 0, 2560, 1440], rodapes: [R1] }),
    lerZona: async () => {
      lidas++;
      return [];
    },
  };
  const v = new Vigia({ ocr, faixaDe: async () => ({}), mostrar: () => {} });
  v.ligado = true;
  await v.passo();
  await v.passo();
  assert.strictEqual(lidas, 1);
  v.semNome[0].ate = Date.now() - 1; // passou 1 s
  await v.passo();
  assert.strictEqual(lidas, 2);
  n++;
}

(async () => {
  await vigiaFalsa();
  await semNome();
  console.log(`test-vigia: ${n} testes passaram`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
