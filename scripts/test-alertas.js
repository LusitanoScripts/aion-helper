'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Alertas } = require('../src/alertas');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-alertas-'));
try {
  const a = new Alertas(dir);
  a.definir({ itemId: 516530001, nome: 'Pedra de Superação (Única)', servidor: 12301, nomeServidor: 'Israphel', limite: 40000 });
  const precos = (mapa) => (srv) => (srv === 12301 ? new Map(Object.entries(mapa).map(([k, v]) => [Number(k), v])) : null);

  // Acima do limite: nada.
  assert.deepStrictEqual(a.verificar(precos({ 516530001: 59997 })), []);
  // Desce para 35K: avisa uma vez.
  const v1 = a.verificar(precos({ 516530001: 35000 }));
  assert.strictEqual(v1.length, 1);
  assert.strictEqual(v1[0].atual, 35000);
  // Continua a 35K: não volta a avisar (de 15 em 15 min o dia todo seria spam).
  assert.deepStrictEqual(a.verificar(precos({ 516530001: 35000 })), []);
  // Desce ainda mais: avisa outra vez.
  assert.strictEqual(a.verificar(precos({ 516530001: 30000 })).length, 1);
  // Sobe acima e volta a cair: rearmou, avisa.
  assert.deepStrictEqual(a.verificar(precos({ 516530001: 50000 })), []);
  assert.strictEqual(a.verificar(precos({ 516530001: 39000 })).length, 1);
  // Sobrevive ao reinício (o estado "já avisei" também, senão avisava ao abrir a app).
  const b = new Alertas(dir);
  assert.strictEqual(b.todos().length, 1);
  assert.deepStrictEqual(b.verificar(precos({ 516530001: 39000 })), []);
  // Definir outra vez muda o limite em vez de duplicar; apagar tira.
  b.definir({ itemId: 516530001, nome: 'x', servidor: 12301, nomeServidor: 'Israphel', limite: 20000 });
  assert.strictEqual(b.todos().length, 1);
  assert.strictEqual(b.todos()[0].limite, 20000);
  b.apagar(516530001, 12301);
  assert.strictEqual(b.todos().length, 0);
  console.log('test-alertas: 1 teste passou');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
