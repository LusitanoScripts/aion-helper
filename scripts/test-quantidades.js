'use strict';

// Leitura das quantidades na captura real do utilizador (2560×1440, recorte de
// 600×990). As respostas certas foram lidas a olho na própria imagem.
//
// Sem batota: cada casa é lida com moldes tirados SÓ das outras casas. Ler uma
// casa com o molde feito dela própria dava 100% e não provava nada.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require('../src/imagem');
const Inv = require('../src/inventario');

const AMOSTRA = path.join(__dirname, 'amostras', 'cubo-600x990.png');
const ORIGEM = { x: 208, y: 87 };

// Por linha, 5 colunas. null = casa sem número (equipamento, ou item único).
const VERDADE = [
  ['14,4K', '381,3K', '1', '874', '59'],
  ['17', '174', '2', '58', '10'],
  ['14', '5', '46', '67', '11'],
  ['68', '106', '8', '1', '975'],
  ['4', '10', '32', null, null],
  [null, '12', null, null, null],
  [null, '3', '3', '1', '3'],
  [null, null, null, null, null], // casas vazias
];

const img = I.lerPNG(fs.readFileSync(AMOSTRA));

// Moldes: cada glifo de cada casa, etiquetado pelo caráter certo.
const porCasa = [];
for (let r = 0; r < VERDADE.length; r++) {
  for (let c = 0; c < 5; c++) {
    const cx = Inv.casa(ORIGEM, c, r);
    const gs = Inv.glifos(Inv.faixa(img, cx));
    const certo = VERDADE[r][c];
    const moldes = [];
    if (certo) {
      assert.strictEqual(gs.length, certo.length, `casa ${c},${r}: ${gs.length} glifos para "${certo}"`);
      gs.forEach((g, i) => moldes.push({ c: certo[i], bits: g.bits }));
    }
    porCasa.push({ c, r, cx, certo, gs, moldes });
  }
}

let certas = 0;
let total = 0;
let falsosNumeros = 0;
let piorConfianca = Infinity;
const erros = [];
for (const casa of porCasa) {
  const outros = porCasa.filter((o) => o !== casa).flatMap((o) => o.moldes);
  const lido = Inv.lerQuantidade(img, casa.cx, outros);
  if (!casa.certo) {
    if (lido) {
      falsosNumeros++;
      erros.push(`casa ${casa.c},${casa.r}: sem número mas leu "${lido.texto}"`);
    }
    continue;
  }
  total++;
  if (lido && lido.texto === casa.certo) {
    certas++;
    piorConfianca = Math.min(piorConfianca, lido.confianca);
  } else {
    erros.push(`casa ${casa.c},${casa.r}: "${casa.certo}" lido como "${lido && lido.texto}"`);
  }
}

const caracteres = [...new Set(porCasa.flatMap((c) => c.moldes.map((m) => m.c)))].sort().join('');
console.log(`caracteres com molde: ${caracteres}`);
console.log(`quantidades: ${certas}/${total} certas · casas sem número lidas como número: ${falsosNumeros} · pior margem ${piorConfianca} px`);
for (const e of erros) console.log('  ✗', e);

// ── prova independente: outra captura, lida só com os moldes da primeira ──
// (6 Out, mais tarde: quantidades que os moldes nunca viram, e linhas 6+ onde os
// algarismos caem 1 px mais abaixo — era aí que um "2" se lia "3").
{
  const { MOLDES } = require('../src/mochila');
  const img3 = I.lerPNG(fs.readFileSync(path.join(__dirname, 'amostras', 'cubo-2cartoes-1600x1099.png')));
  const V3 = [
    ['31,1K', '403,8K', '1', '874', '59'],
    ['17', '171', '2', '78', '10'],
    ['14', '5', '38', '59', '11'],
    ['68', '106', '8', '1', '975'],
    ['5', '10', '32', null, null],
    [null, '12', null, null, null],
    [null, '3', '3', '1', '3'],
    [null, '1', null, '1', '1'],
    [null, null, '4', '2', '5'],
    [null, '2', null, null, null],
    [null, null, null, null, null],
  ];
  let ok3 = 0;
  const mal3 = [];
  for (let r = 0; r < V3.length; r++) {
    for (let c = 0; c < 5; c++) {
      const q = Inv.lerQuantidade(img3, Inv.casa({ x: 1196, y: 106 }, c, r), MOLDES);
      const lido = q ? q.texto : null;
      if (lido === V3[r][c]) ok3++;
      else mal3.push(`casa ${c},${r}: "${V3[r][c]}" lido como "${lido}"`);
    }
  }
  console.log(`prova independente: ${ok3}/${V3.length * 5} casas certas`);
  for (const e of mal3) console.log('  ✗', e);
  assert.strictEqual(mal3.length, 0, 'leituras erradas na captura independente');
}

// ── segunda prova independente: a captura dos elmos (jogo ao vivo, 6 Out) ──
// O "0" de "540,8K" encostava à borda brilhante da moeda e lia-se "K".
{
  const { MOLDES } = require('../src/mochila');
  const img4 = I.lerPNG(fs.readFileSync(path.join(__dirname, 'amostras', 'elmos-1562x941.png')));
  const V4 = [
    ['33,2K', '540,8K', '1', '1,5K', '59'],
    ['17', '171', '2', '78', '10'],
    ['16', '5', '33', '54', '21'],
    ['68', '106', '19', '1', '975'],
    ['6', '10', '32', null, null],
    [null, '12', null, null, null],
    [null, '3', '3', '1', '3'],
    [null, '1', null, '1', '1'],
    [null, null, '4', '2', '5'],
  ];
  const mal4 = [];
  for (let r = 0; r < V4.length; r++) {
    for (let c = 0; c < 5; c++) {
      const q = Inv.lerQuantidade(img4, Inv.casa({ x: 1207, y: 92 }, c, r), MOLDES);
      if ((q ? q.texto : null) !== V4[r][c]) mal4.push(`casa ${c},${r}: "${V4[r][c]}" lido como "${q && q.texto}"`);
    }
  }
  console.log(`prova independente 2: ${V4.length * 5 - mal4.length}/${V4.length * 5} casas certas`);
  for (const e of mal4) console.log('  ✗', e);
  assert.strictEqual(mal4.length, 0, 'leituras erradas na captura dos elmos');
}

assert.strictEqual(Inv.valorDe('381,3K'), 381300);
assert.strictEqual(Inv.valorDe('14,4K'), 14400);
assert.strictEqual(Inv.valorDe('975'), 975);
assert.strictEqual(Inv.valorDe('1,2M'), 1200000);
assert.strictEqual(Inv.valorDe('3,K'), null);

if (process.argv.includes('--moldes')) {
  // Guarda um molde por variante distinta de cada caráter.
  const vistos = new Map();
  for (const m of porCasa.flatMap((c) => c.moldes)) {
    const k = m.c + '|' + Inv.chaveBits(m.bits);
    if (!vistos.has(k)) vistos.set(k, { c: m.c, bits: Inv.chaveBits(m.bits) });
  }
  const destino = path.join(__dirname, '..', 'src', 'moldes-1440.json');
  fs.writeFileSync(destino, JSON.stringify({ origem: path.basename(AMOSTRA), moldes: [...vistos.values()] }, null, 0));
  console.log(`moldes gravados: ${vistos.size} em ${path.relative(process.cwd(), destino)}`);
}

assert.strictEqual(erros.length, 0, 'há leituras erradas');
