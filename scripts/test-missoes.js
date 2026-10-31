'use strict';

// O canto das missões a partir do OCR de duas capturas reais:
//  - missoes-ocr.json: recorte do seguidor com 4 missões (captura do utilizador);
//  - missoes-masmorra-1440.ocr.json: a zona inteira lida ao vivo a 2560×1440, numa masmorra.

const assert = require('assert');
const M = require('../src/missoes');

const r = M.organizarMissoes(require('./amostras/missoes-ocr.json'));
assert.deepStrictEqual(r.linhas, [
  '[Lv. 45] The One Who Wit…',
  '4th Ascension',
  'Go to the Dream Crossroad and talk to Asahr',
  '[Lv. 45] Daeva Trapped in a…',
  'Ascend to the next dimension of power as a Daeva',
  'Complete The One Who Witnesses the Nightmare',
  'Spacetime Rift',
  'Find and enter the rift Uru mentioned',
  'Activate the Spacetime Rift (0/1)',
  'Spacetime Rift: Unknown…',
  'Obtain the weapons Uru mentioned',
  "Collect Kobold Worker's Gear",
  "Collect Kobold Laborer's Pickaxe",
]);

// Ao vivo: fora o relógio sem dois pontos ("1347") e o lixo do losango ("-q '").
const m = M.organizarMissoes(require('./amostras/missoes-masmorra-1440.ocr.json'));
assert.strictEqual(m.linhas[0], "Kaisinel's Distorted Dream");
assert.ok(!m.linhas.some((t) => /^\d+$/.test(t)), 'sem o relógio');
assert.ok(m.linhas.some((t) => /^\S*he One Who Witnesses th…$/.test(t)), 'título sem o lixo do ícone');

for (const [antes, depois] of [
  ['[LV. 451 Daeva Trapped in a...', '[Lv. 45] Daeva Trapped in a…'],
  ['• The One Who Witnesses th...', 'The One Who Witnesses th…'],
  ["-q 'The One", 'The One'],
  ['4th Ascension', '4th Ascension'],
  ['(0/4) Collect', '(0/4) Collect'],
]) assert.strictEqual(M.limparLinha(antes), depois);

// Contagens a mudar não são linhas novas; um passo novo é.
const a = { linhas: ['Zona', 'Spacetime Rift', 'Collect Gear (0/4)'] };
assert.deepStrictEqual(M.linhasNovas({ linhas: ['Zona', 'Spacetime Rift', 'Collect Gear (2/4)'] }, a), []);
assert.deepStrictEqual(M.linhasNovas({ linhas: ['Zona', 'Spacetime Rift', 'Return to Uru'] }, a), ['Return to Uru']);
assert.strictEqual(M.chaveMissoes({ linhas: ['Collect Gear (0/4)'] }), M.chaveMissoes({ linhas: ['Collect Gear (3/4)'] }));
assert.ok(M.textoMissoes({ linhas: ['Zona', 'Return to Uru'] }, ['Return to Uru']).includes('- Return to Uru   [NOVO]'));
assert.strictEqual(M.organizarMissoes([]).linhas.length, 0);

console.log('missoes: tudo bem');
