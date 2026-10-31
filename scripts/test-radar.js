'use strict';

// Modo recolha: os losangos do radar em três capturas reais a 1440p —
// radar-1440.png (com a dica "Orichalcum · Distance 55m"), radar-fafnite-1440.png
// (cortada à direita) e radar-masmorra-1440.png (só o mapa, sem recursos).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require('../src/imagem');
const R = require('../src/radar');

const amostra = (n) => I.lerPNG(fs.readFileSync(path.join(__dirname, 'amostras', n)));

// A zona do radar numa janela de 2560×1440 em 0,0 — medida no ecrã inteiro.
assert.deepStrictEqual(R.zonaDoRadar([0, 0, 2560, 1440]), [2200, 133, 331, 221]);
// A 1080p a interface encolhe por igual, encostada ao canto de cima à direita.
assert.deepStrictEqual(R.zonaDoRadar([0, 0, 1920, 1080]), [1650, 100, 248, 166]);

// 1) Fafnite Deposit: o mapa começa em (651,108) na captura.
{
  const mapa = I.recortar(amostra('radar-1440.png'), 651, 108, 331, 221);
  const t0 = Date.now();
  const rs = R.encontrarRecursos(mapa);
  const ms = Date.now() - t0;
  assert.strictEqual(rs.length, 6, `6 losangos (deu ${rs.length})`);
  assert.ok(rs.every((r) => r.claro));
  const centro = R.centroDe(331, 221);
  const d = rs.map((r) => R.descrever(r, centro, R.METROS_POR_PX)).sort((a, b) => a.metros - b.metros);
  // O Orichalcum da dica, a 55 m, é o que está por baixo à direita.
  assert.ok(d.some((r) => r.metros === 55 && r.seta === '↓'), JSON.stringify(d.map((r) => [r.metros, r.seta])));
  assert.deepStrictEqual(d[0].seta, '←'); // o mais perto está mesmo à esquerda
  assert.ok(ms < 50, `rápido (${ms} ms)`);
}

// 2) A mesma zona noutra altura; a captura corta o radar à direita (x 71…387).
{
  const img = amostra('radar-fafnite-1440.png');
  const rs = R.encontrarRecursos(I.recortar(img, 71, 88, img.largura - 71, 221));
  assert.strictEqual(rs.length, 4, `4 losangos (deu ${rs.length})`);
}

// 3) Masmorra (mapa escuro, ícones vermelhos e cinzentos): nada.
assert.strictEqual(R.encontrarRecursos(amostra('radar-masmorra-1440.png')).length, 0);

// A dica do jogo (OCR) dá a distância verdadeira, para acertar a escala.
assert.strictEqual(R.distanciaDaDica([{ t: 'Orichalcum' }, { t: 'Ore' }, { t: 'Altitude | Distance 55m' }]), 55);
assert.strictEqual(R.distanciaDaDica([{ t: 'Distância: 120 m' }]), 120);
assert.strictEqual(R.distanciaDaDica([{ t: 'Orichalcum' }]), null);

// O rasto: só conta como novo o que aparece depois da primeira leitura, e um
// losango que desliza (o jogador anda) ou some por um instante não é novo.
{
  const rasto = new R.Rasto();
  assert.deepStrictEqual(rasto.ver([{ x: 10, y: 10 }, { x: 100, y: 50 }]), []);
  assert.deepStrictEqual(rasto.ver([{ x: 14, y: 12 }, { x: 103, y: 50 }]), []);
  assert.deepStrictEqual(rasto.ver([{ x: 18, y: 14 }]), []); // o segundo tapado
  assert.deepStrictEqual(rasto.ver([{ x: 20, y: 15 }, { x: 105, y: 51 }]), []); // voltou
  assert.deepStrictEqual(rasto.ver([{ x: 22, y: 16 }, { x: 105, y: 51 }, { x: 200, y: 200 }]), [{ x: 200, y: 200 }]);
  for (let i = 0; i < 5; i++) rasto.ver([]);
  assert.deepStrictEqual(rasto.ver([{ x: 22, y: 16 }]), [{ x: 22, y: 16 }]); // esquecido, volta a ser novo
}

console.log('radar: ok');
