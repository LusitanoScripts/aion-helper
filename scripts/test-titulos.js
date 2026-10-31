'use strict';

// Comparar títulos: o OCR de duas capturas reais (carta "Even Better" e painel
// "Equipped Effect" com "Hot Potato"), postas num ecrã de 2560×1440 (scripts/amostras/titulos-ocr.json).

const assert = require('assert');
const T = require('../src/titulos');

const r = T.compararTitulos(require('./amostras/titulos-ocr.json'));
assert.ok(r, 'achou a carta e o painel');
assert.strictEqual(r.escolhido.nome, 'Even Better');
assert.strictEqual(r.equipado.nome, 'Hot Potato');
// O ícone do título saiu do OCR como "ZOA" (76 px de altura) e não se cola a "Penetration".
assert.deepStrictEqual(
  r.diferencas.map((d) => [d.nome, d.delta]),
  [
    ['Back Attack Critical Hit', 50],
    ['Attack Bonus', 20],
    ['Power Shard Damage Bonus', -26],
    ['Penetration', -210],
  ],
);
assert.ok(r.y > 400 + 287, 'a faixa fica por baixo dos botões');

// O mesmo atributo nos dois: só a diferença; percentagens à parte dos valores fixos.
const L = (t, x, y, h = 16) => ({ t, x1: x, x2: x + t.length * 9, y1: y, y2: y + h });
const r2 = T.compararTitulos([
  L('Equipped Effect', 1000, 100), L('Old One', 1000, 140, 20), L('Attack Bonus', 1000, 180), L('30', 1300, 180), L('HP +2%', 1000, 210),
  L('New One', 200, 300, 20), L('Attack Bonus 50', 200, 340), L('HP +900', 200, 370), L('Equip Effect', 220, 420, 22), L('Equip Title', 500, 420, 22),
]);
assert.deepStrictEqual(r2.diferencas.map((d) => [d.nome, d.pct, d.delta]), [['HP', false, 900], ['Attack Bonus', false, 20], ['HP', true, -2]]);

// Sem a janela dos títulos no ecrã: nada.
assert.strictEqual(T.compararTitulos([L('Attack Bonus 20', 10, 10)]), null);
assert.deepStrictEqual(T.atributo('Cooldown Reduction +3%'), { nome: 'Cooldown Reduction', valor: 3, pct: true });
// Ecrã real (cliente em inglês): a grelha de cartas lado a lado e o painel com um efeito por categoria.
// Antes juntava o texto de 3 cartas numa linha e comparava com o 1.º bloco — saía ao contrário.
{
  const I = require('../src/imagem');
  const img = I.lerPNG(require('fs').readFileSync(require('path').join(__dirname, 'amostras', 'titulos-grelha.png')));
  // O OCR guardado tem por cima o texto da faixa antiga (y 430–525): fora.
  const linhas = require('./amostras/titulos-grelha-ocr.json').filter((l) => !(l.y1 > 430 && l.y1 < 525 && l.x1 > 160 && l.x1 < 700));
  const g = T.compararTitulos(linhas, img);
  assert.ok(g && g.categoriaPorIcone);
  assert.strictEqual(g.escolhido.nome, 'Ill-Fated Encounter'); // o OCR leu "111-Fated"
  assert.strictEqual(g.equipado.nome, 'The Road Goes Ever On');
  assert.deepStrictEqual(g.diferencas.map((d) => [d.nome, d.delta]), [['Critical Attack', 17], ['Attack Bonus', -20], ['Accuracy Bonus', -40]]);
  // Os ícones: espada da carta mais parecida com a espada equipada; escudo com o escudo.
  const h = 15;
  const ataque = T.assinaturaIcone(img, 2136 - h * 5.3, 325.5 + h * 1.9, h * 8.5);
  const defesa = T.assinaturaIcone(img, 2135 - h * 5.3, 574 + h * 1.9, h * 8.5);
  for (const [x, y, certo, errado] of [[607, 301, ataque, defesa], [1882, 306, ataque, defesa], [1240, 38, defesa, ataque]]) {
    const c = T.assinaturaIcone(img, x, y, h * 6.2);
    assert.ok(T.semelhancaIcone(c, certo) > T.semelhancaIcone(c, errado) + 0.08, `ícone em ${x},${y}`);
  }
}
console.log('titulos: tudo bem');
