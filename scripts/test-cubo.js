'use strict';

// Hidden Cubes: o cubo na captura real (cubo-mundo-541x706.png, recorte de
// 2560×1440 em Altgard) — inteira e reduzida a metade píxel sim píxel não, que é
// como a vigia fotografa o ecrã — e nenhum alarme nas outras capturas do jogo
// (mochila, cartões, coleção, radar, títulos, barra de habilidades) nem nos
// enfeites de Halloween de Altgard (candeeiros e abóboras rosa, em bando).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require('../src/imagem');
const C = require('../src/cubo');

const DIR = path.join(__dirname, 'amostras');
const amostra = (n) => I.lerPNG(fs.readFileSync(path.join(DIR, n)));

// O que o StretchBlt com COLORONCOLOR faz: fica um píxel em cada dois.
function metade(img) {
  const w = img.largura >> 1;
  const h = img.altura >> 1;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (2 * y * img.largura + 2 * x) * 4;
      px.set(img.px.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return { largura: w, altura: h, px };
}

// 1) O cubo sobre a água, a (208,112), 19×19 px.
{
  const img = amostra('cubo-mundo-541x706.png');
  const inteira = C.encontrarCubos(img, 1);
  assert.strictEqual(inteira.length, 1, `um cubo (deu ${inteira.length})`);
  assert.ok(Math.hypot(inteira[0].x - 208, inteira[0].y - 112) < 3, JSON.stringify(inteira));
  const t0 = Date.now();
  const meia = C.encontrarCubos(metade(img), 0.5);
  assert.strictEqual(meia.length, 1, `um cubo a metade (deu ${meia.length})`);
  assert.ok(Math.hypot(meia[0].x * 2 - 208, meia[0].y * 2 - 112) < 4, JSON.stringify(meia));
  assert.ok(Date.now() - t0 < 50);
}

// 1b) Dois cubos reais que a cor apertada NÃO apanha (um ao sol colado à pedra,
// outro de lado com halo): acham-se pelo rótulo "Hidden Cube" que o jogo escreve
// por cima (OCR só do verde-água, guardado em .rotulos.json) e, por baixo dele,
// pela cor em modo solto — a metade, como a vigia.
{
  const img = amostra('cubos-pedras-1239x1306.png');
  const linhas = JSON.parse(fs.readFileSync(path.join(DIR, 'cubos-pedras-1239x1306.rotulos.json'), 'utf8'));
  const rs = C.rotulosDeCubo(linhas);
  assert.strictEqual(rs.length, 1);
  assert.ok(Math.hypot(rs[0].x - 935, rs[0].y - 324) < 5, JSON.stringify(rs));
  const soltos = C.encontrarCubos(metade(img), 0.5, { solto: true }).map((m) => [Math.round(m.x * 2), Math.round(m.y * 2)]);
  assert.ok(soltos.some(([x, y]) => Math.hypot(x - 928, y - 371) < 6), 'o cubo por baixo do rótulo: ' + JSON.stringify(soltos));
  assert.ok(soltos.some(([x, y]) => Math.hypot(x - 310, y - 620) < 6), 'o cubo de lado: ' + JSON.stringify(soltos));
  // A máscara verde-água apanha a cor do rótulo e não a relva escura à volta.
  const p = (x, y) => (y * img.largura + x) * 4;
  assert.ok(C.verdeAgua(img.px, p(900, 323)));
  assert.ok(!C.verdeAgua(img.px, p(915, 322)));
}

// O rótulo com os erros habituais do OCR, e o que não é rótulo.
for (const t of ['Hidden Cube', 'HiddenCube', 'Hldden Cube', 'H1dden Cu6e', 'Cubo Oculto']) {
  assert.strictEqual(C.rotulosDeCubo([{ x1: 0, y1: 0, x2: 10, y2: 10, t }]).length, 1, t);
}
for (const t of ['Saint of Altgard', 'Hidden', 'LusitanoGlad', 'Soul Codex: Reset (Bound)']) {
  assert.strictEqual(C.rotulosDeCubo([{ x1: 0, y1: 0, x2: 10, y2: 10, t }]).length, 0, t);
}

// 2) Nenhum cubo nas outras capturas, inteiras ou a metade (com as regras
// apertadas; as dos cubos acima têm os seus testes).
const COM_CUBOS = ['cubo-mundo-541x706.png', 'cubos-pedras-1239x1306.png'];
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.png') && !COM_CUBOS.includes(f))) {
  const img = amostra(f);
  assert.deepStrictEqual(C.encontrarCubos(img, 1), [], f);
  assert.deepStrictEqual(C.encontrarCubos(metade(img), 0.5), [], f + ' (metade)');
}

// 3) O seguidor: só avisa depois de duas leituras seguidas, uma vez por cubo,
// com a câmara a mexer; um clarão de uma leitura não conta.
{
  const s = new C.Seguidor();
  assert.deepStrictEqual(s.ver([{ x: 100, y: 100, lado: 20 }]).novos, []);
  let r = s.ver([{ x: 130, y: 110, lado: 20 }, { x: 900, y: 500, lado: 30 }]); // o 2.º é um clarão
  assert.strictEqual(r.novos.length, 1);
  assert.strictEqual(r.novos[0].x, 130);
  r = s.ver([{ x: 150, y: 115, lado: 21 }]);
  assert.strictEqual(r.novos.length, 0);
  assert.strictEqual(r.confirmados.length, 1);
  // Some atrás de uma rocha uma leitura e volta: não volta a avisar.
  s.ver([]);
  r = s.ver([{ x: 160, y: 118, lado: 21 }]);
  assert.strictEqual(r.novos.length, 0);
  assert.strictEqual(r.confirmados.length, 1);
  // Fora de vista muito tempo: esquecido; se voltar, avisa outra vez.
  for (let i = 0; i < 3; i++) s.ver([]);
  s.ver([{ x: 160, y: 118, lado: 21 }]);
  assert.strictEqual(s.ver([{ x: 162, y: 118, lado: 21 }]).novos.length, 1);
}


console.log('cubo: ok');
