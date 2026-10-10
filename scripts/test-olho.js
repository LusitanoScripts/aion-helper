'use strict';

// O olho do lado do Windows (src/ocr.ps1, C#) tem de achar os mesmos rodapés
// que o src/cartoes.js. Ele trabalha sobre uma cópia do ecrã reduzida a metade
// (para pesar menos ao lado do jogo: ~8% de um núcleo a 4 vigias por segundo),
// por isso aceita-se 2 px de diferença. Precisa do PowerShell (Windows).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require('../src/imagem');
const C = require('../src/cartoes');
const { OCR } = require('../src/ocr');

(async () => {
  const o = new OCR();
  try {
    for (const f of ['elmos-1562x941', 'cubo-2cartoes-1600x1099', 'cubo-tooltip-1090x1018', 'cubo-600x990']) {
      const p = path.join(__dirname, 'amostras', f + '.png');
      const cs = await o.pedir('RODAPES ' + p);
      const js = C.encontrarRodapes(I.lerPNG(fs.readFileSync(p)));
      assert.strictEqual(cs.length, js.length, `${f}: ${cs.length} rodapés no C#, ${js.length} no JS`);
      for (const r of js) {
        const par = cs.find((c) => Math.abs(c.esquerda - r.esquerda) <= 2);
        assert.ok(par, `${f}: o C# não achou o rodapé em x=${r.esquerda}`);
        for (const k of ['esquerda', 'direita', 'topo', 'fundo']) {
          assert.ok(Math.abs(par[k] - r[k]) <= 2, `${f}: ${k} ${par[k]} contra ${r[k]}`);
        }
      }
    }
    console.log('test-olho: o C# reduzido acha os mesmos rodapés nas 4 capturas');
  } finally {
    o.parar();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
