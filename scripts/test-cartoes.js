'use strict';

// Cartões de item e notas, sobre as capturas reais e o que o OCR do Windows leu
// delas (guardado em scripts/amostras/*.ocr.json — o teste não precisa do OCR).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I = require('../src/imagem');
const C = require('../src/cartoes');
const { Notas } = require('../src/notas');

const DIR = path.join(__dirname, 'amostras');
const ler = (nome) => ({
  img: I.lerPNG(fs.readFileSync(path.join(DIR, nome + '.png'))),
  linhas: JSON.parse(fs.readFileSync(path.join(DIR, nome + '.ocr.json'), 'utf8')),
});

let n = 0;

// ── dois cartões lado a lado (o item e o equipado, para comparar) ──────────
{
  const { img, linhas } = ler('cubo-2cartoes-1600x1099');
  const cs = C.encontrarCartoes(img, linhas);
  assert.deepStrictEqual(cs.map((c) => c.nome), ['Botas do Caos', 'Botas do Perseguidor']);
  assert.ok(cs.every((c) => c.raridade === 'Raro' && c.tipo === 'Botas'));
  // A borda de baixo está em y=678 nos dois (medido); pela cor, não pelo texto —
  // logo abaixo há nomes de jogadores que o OCR também lê.
  assert.deepStrictEqual(cs.map((c) => c.fundo), [678, 678]);
  assert.ok(cs.every((c) => c.fundoPelaCor));
  // A borda esquerda real é 48 e 533.
  assert.ok(Math.abs(cs[0].x - 48) <= 2 && Math.abs(cs[1].x - 533) <= 2);
  n++;
}

// ── cartão Comum: o OCR não lê a raridade (cinzento sobre cinzento) ─────
// Captura do jogo ao vivo (6 Out): o "Elmo do Forasteiro" ficava sem faixa. O
// cartão acha-se pelo rodapé (píxeis), não pela linha da raridade.
{
  const { img, linhas } = ler('elmos-1562x941');
  const cs = C.encontrarCartoes(img, linhas);
  assert.deepStrictEqual(cs.map((c) => c.nome), ['Elmo da Linha de Combate', 'Elmo do Forasteiro']);
  assert.strictEqual(cs[0].raridade, 'Raro');
  assert.strictEqual(cs[1].raridade, null, 'o OCR não leu a raridade, e não se inventa');
  assert.ok(Math.abs(cs[1].x - 544) <= 2 && Math.abs(cs[1].fundo - 632) <= 2);
  n++;
}

// ── nome cortado pelo jogo ────────────────────────────────────────────────
{
  const { img, linhas } = ler('cubo-tooltip-1090x1018');
  const cs = C.encontrarCartoes(img, linhas);
  assert.strictEqual(cs.length, 1);
  assert.strictEqual(cs[0].nome, 'Pergaminho de Bendição (Vincu');
  assert.ok(cs[0].cortado);
  assert.strictEqual(cs[0].fundo, 465);
  n++;
}

// ── sem cartão aberto não inventa um ──────────────────────────────────────
{
  const { img, linhas } = ler('cubo-600x990');
  assert.deepStrictEqual(C.encontrarCartoes(img, linhas), []);
  n++;
}

// ── casar o nome lido com os itens do mercado ─────────────────────────────
{
  const itens = [
    { id: 1, nome: 'Pergaminho de Bendição Superior' },
    { id: 2, nome: 'Pergaminho de Bendição (Vinculado)' },
    { id: 3, nome: 'Pedra de Mana Inferior' },
    { id: 4, nome: 'Botas da Beira do Rio' },
  ];
  assert.deepStrictEqual(C.casarNome('Pedra de Mana Inferior', false, itens), { ids: [3], como: 'exato' });
  assert.deepStrictEqual(C.casarNome('pedra de mana inferior', false, itens), { ids: [3], como: 'exato' });
  // Cortado: só os que começam assim — não o "Superior".
  assert.deepStrictEqual(C.casarNome('Pergaminho de Bendição (Vincu', true, itens), { ids: [2], como: 'prefixo' });
  // O OCR troca uma letra: ainda casa, e di-lo.
  assert.deepStrictEqual(C.casarNome('Pedra de Mana Inferlor', false, itens), { ids: [3], como: 'aproximado' });
  // Um item que não está no mercado não é forçado para o mais parecido.
  assert.strictEqual(C.casarNome('Botas do Caos', false, itens), null);
  assert.strictEqual(C.casarNome('Botas da Beira', false, itens), null, 'sem corte, um prefixo não basta');
  n++;
}

// ── notas: pelo nome, e um nome cortado encontra a do inteiro ─────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-notas-'));
  try {
    const notas = new Notas(dir);
    notas.escrever('Pergaminho de Bendição (Vinculado)', 'usar antes do boss');
    notas.escrever('Botas do Caos', 'guardar para o Perseguidor');
    assert.strictEqual(notas.de('botas do caos').texto, 'guardar para o Perseguidor');
    assert.strictEqual(notas.de('Pergaminho de Bendição (Vincu', true).texto, 'usar antes do boss');
    assert.strictEqual(notas.de('Pergaminho de Bendição (Vincu', false), null);
    // Sobrevive ao reinício, e texto vazio apaga.
    const outra = new Notas(dir);
    assert.strictEqual(outra.todas().length, 2);
    outra.escrever('Botas do Caos', '   ');
    assert.strictEqual(new Notas(dir).de('Botas do Caos'), null);
    n++;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── preço da loja no rodapé, e onde vender ────────────────────────────────
{
  const { ondeVender } = require('../src/loja');
  const lojas = (f) => {
    const { img, linhas } = ler(f);
    return C.encontrarCartoes(img, linhas).map((c) => c.loja);
  };
  // O equipado (o 2.º cartão) não se vende: não tem preço, e não se inventa.
  assert.deepStrictEqual(lojas('cubo-2cartoes-1600x1099'), [{ unidade: 92, total: 92 }, null]);
  assert.deepStrictEqual(lojas('elmos-1562x941'), [{ unidade: 92, total: 92 }, null]);
  // Pilha: "10(680)'" — 10 cada, 680 a pilha, e o apóstrofo é a moeda.
  assert.deepStrictEqual(lojas('cubo-tooltip-1090x1018'), [{ unidade: 10, total: 680 }]);
  // Os atributos (Defesa 95, 61.1%) estão acima do rodapé e não são o preço.
  assert.strictEqual(ondeVender(477777, 92).onde, 'mercado');
  assert.strictEqual(ondeVender(95, 92).onde, 'loja', 'depois da taxa o mercado dá 87, menos que a loja');
  assert.strictEqual(ondeVender(100, 92).onde, 'loja', 'ganhar 0 depois de pôr à venda não compensa (margem de 10%)');
  assert.strictEqual(ondeVender(null, 92).onde, 'loja');
  assert.strictEqual(ondeVender(1000, null), null);
  n++;
}

// ── cartões a 1080p (sintético: captura e caixas do OCR reduzidas a 0,75) ─
// As medidas do cartão escalam pela largura do rodapé (469 px a 1440p).
{
  const { img, linhas } = ler('elmos-1562x941');
  const f = 0.75;
  const peq = I.escalar(img, f);
  const lin = linhas.map((l) => ({ ...l, x1: Math.round(l.x1 * f), y1: Math.round(l.y1 * f), x2: Math.round(l.x2 * f), y2: Math.round(l.y2 * f) }));
  const cs = C.encontrarCartoes(peq, lin);
  assert.deepStrictEqual(cs.map((c) => c.nome), ['Elmo da Linha de Combate', 'Elmo do Forasteiro']);
  assert.ok(Math.abs(C.escalaDoRodape({ esquerda: 0, direita: Math.round(469 * f) - 1 }) - f) < 0.01);
  assert.deepStrictEqual(cs[0].loja, { unidade: 92, total: 92 });
  n++;
}

console.log(`test-cartoes: ${n} testes passaram`);
