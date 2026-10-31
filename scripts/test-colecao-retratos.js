'use strict';

// A coleção de mascotes pelos retratos, numa captura real (scripts/amostras/colecao-pets-1440.png:
// recorte da grelha de uma captura 2559×1439, a partir de x=90, y=150 do ecrã).
// Usa os retratos da cache da app (%APPDATA%\aion-helper\cache\retratos); sem eles, salta.

const fs = require('fs');
const path = require('path');
const I = require('../src/imagem');
const CR = require('../src/colecao-retratos');

// As almas ("15/75") a partir do que o OCR fez das tiras limpas — casos vistos na captura.
// [texto do OCR, nível, glifos contados, almas esperadas (null = "não sei")]
for (const [texto, nivel, glifos, esperado] of [
  ['15/75', 2, 6, 15], // um glifo a mais (pelo da mascote) mas texto limpo
  ['1 1/75', 2, 5, 11],
  ['21125', 1, 5, 21], // a barra lida como "1"
  ['1 8125', 1, 5, 18],
  ['5/25', 1, 4, 5],
  ['*JI 5/25', 1, 5, null], // era 15/25: com lixo e glifos a não bater, mais vale não saber
  ['', 1, 5, null],
  ['MAX', 3, 3, null],
]) {
  const r = CR.lerAlmas(texto, nivel, glifos);
  const v = r ? r.tem : null;
  if (v !== esperado) {
    console.error(`lerAlmas(${JSON.stringify(texto)}, ${nivel}, ${glifos}) = ${v}, esperava ${esperado}`);
    process.exit(1);
  }
}

const dir = path.join(process.env.APPDATA || '', 'aion-helper', 'cache', 'retratos');
const j = require('../src/dados/mascotes.json');
const retratos = j.mascotes
  .filter((m) => m.i && fs.existsSync(path.join(dir, m.i)))
  .map((m) => ({ id: m.id, nome: m.n['en-US'], img: I.lerPNG(fs.readFileSync(path.join(dir, m.i))) }));
if (retratos.length < j.mascotes.length * 0.9) {
  console.log(`test-colecao-retratos: saltado (só ${retratos.length} retratos na cache; abre a leitura da coleção uma vez para os descarregar)`);
  process.exit(0);
}
const cat = CR.catalogoRetratos(retratos, I.redimensionar);
const img = I.lerPNG(fs.readFileSync(path.join(__dirname, 'amostras', 'colecao-pets-1440.png')));
const janela = [-90, -150, 2559, 1439]; // o jogo começa 90,150 antes do recorte

const esperado = [
  ['Mumu Worker', 3], ['Tamed Karnif', 3], ['Poison Blood', 3],
  ['Pagati', 3], ['Dratona', 2], ['Swarm', 2],
  ['Aberrant Bee', 2], ['Cadaver Cleaner', 1], ['Drakan Probe', 1],
  ['Tayga', 1], ['Mumu Warrior', 1], ['Superior Fire Spirit', 1],
  // a 5.ª linha: retratos à vista, mas o círculo do nível fica tapado pela borda da lista
  ['Agrint', null], ['Fossa', null], ['Magic Gravi', null],
];
let falhas = 0;
const t0 = Date.now();
const cartas = CR.lerCartas(img, janela, cat);
const ms = Date.now() - t0;
if (cartas.length !== esperado.length) {
  falhas++;
  console.error(`cartas: ${cartas.length}, esperava ${esperado.length}`);
}
cartas.forEach((c, i) => {
  const [nome, nivel] = esperado[i] || [];
  const n = CR.nivelDaCarta(img, c, 1439 / CR.REF_ALTURA);
  if (c.nome !== nome || !c.certa || n !== nivel) {
    falhas++;
    console.error(`carta ${i}: ${c.nome} (d ${c.d}, margem ${c.margem}, certa ${c.certa}) nível ${n} — esperava ${nome} nível ${nivel}`);
  }
});
if (falhas) {
  console.error(`test-colecao-retratos: ${falhas} falha(s)`);
  process.exit(1);
}
console.log(`test-colecao-retratos: 15/15 cartas e níveis certos (${ms} ms)`);
