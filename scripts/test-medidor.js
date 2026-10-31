'use strict';

// Medidor de DPS: números e tempos da janela "Análise de combate" (Ctrl+X no
// jogo), a máquina que corta as lutas e a gravação em lutas.json.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../src/medidor');

// Números como o jogo os escreve, nos vários idiomas.
assert.strictEqual(M.numero('79,72K'), 79720);
assert.strictEqual(M.numero('1.42M'), 1420000);
assert.strictEqual(M.numero('1.234,5K'), 1234500);
assert.strictEqual(M.numero('35,49%'), 35.49);
assert.strictEqual(M.numero('300'), 300);
assert.strictEqual(M.numero('1,234'), 1234); // milhares em inglês
assert.strictEqual(M.numero('abc'), null);
assert.strictEqual(M.numero('2,1b'), 2100000000);

assert.strictEqual(M.tempo('00:40'), 40);
assert.strictEqual(M.tempo('1:02:03'), 3723);
assert.strictEqual(M.tempo('0040'), 40); // OCR sem os dois pontos
assert.strictEqual(M.tempo('xx'), null);

// Uma leitura por segundo; t em ms.
const L = (alvo, tempo, total) => ({ alvo, tempo, total, dps: null, habilidades: null });
const t0 = Date.UTC(2026, 9, 31, 20, 0, 0);
const T = (s) => t0 + s * 1000;

// (a) 20 s a bater, depois parado: acaba ao fim de 5 s sem mexer.
{
  const luta = new M.Luta();
  let fim = null;
  for (let s = 0; s <= 20; s++) fim = luta.ler(L('Vakron', s, s * 1000), T(s)).terminou || fim;
  assert.strictEqual(fim, null);
  assert.strictEqual(luta.ler(L('Vakron', 20, 20000), T(21)).estado, 'a decorrer');
  for (let s = 21; s <= 24; s++) assert.strictEqual(luta.ler(L('Vakron', 20, 20000), T(s)).terminou, null);
  const r = luta.ler(L('Vakron', 20, 20000), T(25));
  assert.ok(r.terminou, 'acaba ao fim de 5 s parado');
  assert.strictEqual(r.terminou.alvo, 'Vakron');
  assert.strictEqual(r.terminou.total, 20000);
  assert.strictEqual(r.terminou.duracao, 20);
  assert.strictEqual(r.terminou.dps, 1000);
  assert.strictEqual(r.terminou.inicio, new Date(T(1)).toISOString());
  assert.strictEqual(r.estado, 'parada');
  // A seguir, a mesma janela parada não abre luta nova.
  assert.strictEqual(luta.ler(L('Vakron', 20, 20000), T(26)).estado, 'parada');
}

// (b) o tempo volta a 0: acaba logo.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 10; s++) luta.ler(L('Dummy', s, s * 500), T(s));
  const r = luta.ler(L('Dummy', 0, 0), T(11));
  assert.ok(r.terminou);
  assert.strictEqual(r.terminou.total, 5000);
}

// (c) o alvo muda: acaba a anterior e começa outra.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 8; s++) luta.ler(L('Thamon', s, s * 100), T(s));
  // Só à 2.ª leitura seguida com o nome novo (uma letra mal lida não fecha a luta).
  assert.strictEqual(luta.ler(L('Vakron', 1, 300), T(9)).terminou, null);
  const r = luta.ler(L('Vakron', 2, 600), T(10));
  assert.strictEqual(r.terminou.alvo, 'Thamon');
  assert.strictEqual(r.estado, 'a decorrer');
  for (let s = 3; s <= 9; s++) luta.ler(L('Vakron', s, s * 300), T(8 + s));
  assert.strictEqual(luta.fechar(T(30)).alvo, 'Vakron');
}

// (d) uma leitura de lixo (×100) e outra a descer: ignoradas.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 6; s++) luta.ler(L('X', s, s * 1000), T(s));
  luta.ler(L('X', 7, 700000), T(7));
  luta.ler(L('X', 7, 2000), T(7.5));
  for (let s = 8; s <= 12; s++) luta.ler(L('X', s, s * 1000), T(s));
  const f = luta.fechar(T(13));
  assert.strictEqual(f.total, 12000);
  assert.ok(f.curva.every(([, tot]) => tot <= 12000));
}

// (e) luta curta (3 s) não conta.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 3; s++) luta.ler(L('X', s, s * 1000), T(s));
  for (let s = 4; s <= 10; s++) assert.strictEqual(luta.ler(L('X', 3, 3000), T(s)).terminou, null);
}

// (f) a janela desaparece a meio: a luta fecha com o que havia, ao fim de 5 s sem ela.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 10; s++) luta.ler(L('X', s, s * 100), T(s));
  assert.strictEqual(luta.ler(null, T(11)).terminou, null, 'uma falha não fecha');
  const r = luta.ler(null, T(15));
  assert.strictEqual(r.terminou.total, 1000);
  assert.strictEqual(r.estado, 'parada');
}

// Revisão — uma leitura falhada (ou Alt+Tab) a meio não parte a luta em duas.
{
  const luta = new M.Luta();
  const feitas = [];
  for (let s = 1; s <= 10; s++) luta.ler(L('X', s, s * 1000), T(s));
  luta.ler(null, T(11));
  for (let s = 12; s <= 20; s++) luta.ler(L('X', s, s * 1000), T(s));
  for (let s = 21; s <= 26; s++) {
    const f = luta.ler(L('X', 20, 20000), T(s)).terminou;
    if (f) feitas.push(f);
  }
  assert.strictEqual(feitas.length, 1);
  assert.strictEqual(feitas[0].total, 20000);
}

// Revisão — pausa de mais de 5 s no mesmo alvo: a 2.ª luta conta só o dano novo.
{
  const luta = new M.Luta();
  const feitas = [];
  const v = (r) => r.terminou && feitas.push(r.terminou);
  for (let s = 1; s <= 10; s++) v(luta.ler(L('X', s, s * 1000), T(s)));
  for (let s = 11; s <= 16; s++) v(luta.ler(L('X', 10, 10000), T(s)));
  for (let s = 17; s <= 26; s++) v(luta.ler(L('X', s - 6, 10000 + (s - 16) * 500), T(s)));
  v({ terminou: luta.fechar(T(30)) });
  assert.strictEqual(feitas.length, 2);
  assert.strictEqual(feitas[0].total, 10000);
  assert.strictEqual(feitas[1].total, 5000, 'não volta a contar os 10000 da 1.ª');
  assert.ok(Math.abs(feitas[1].dps - 500) <= 60, 'DPS da 2.ª ≈ 500, deu ' + feitas[1].dps);
}

// Revisão — valor gigante logo no início (antes de haver mediana): não prende a luta.
{
  const luta = new M.Luta();
  luta.ler(L('X', 1, 100), T(1));
  luta.ler(L('X', 2, 100000), T(2));
  for (let s = 3; s <= 12; s++) luta.ler(L('X', s, s * 100), T(s));
  let fim = null;
  for (let s = 13; s <= 30 && !fim; s++) fim = luta.ler(L('X', 12, 1200), T(s)).terminou;
  assert.ok(fim, 'a luta acaba');
  assert.strictEqual(fim.total, 1200);
}

// Revisão — o jogo recomeça sem se ler o 00:00: fecha a luta e abre outra.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 10; s++) luta.ler(L('X', s, s * 1000), T(s));
  let fim = null;
  for (let s = 11; s <= 16; s++) fim = luta.ler(L('X', s - 10, (s - 10) * 300), T(s)).terminou || fim;
  assert.ok(fim);
  assert.strictEqual(fim.total, 10000);
  assert.strictEqual(luta.estado, 'a decorrer');
}

// Revisão — total ilegível durante 6 s: a luta fecha.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 10; s++) luta.ler(L('X', s, s * 100), T(s));
  let fim = null;
  for (let s = 11; s <= 16 && !fim; s++) fim = luta.ler(L('X', s, null), T(s)).terminou;
  assert.ok(fim);
  assert.strictEqual(fim.total, 1000);
}

// Revisão — o nome do alvo mal lido uma vez não fecha a luta.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 10; s++) luta.ler(L(s === 5 ? 'Vakr0n' : 'Vakron', s, s * 100), T(s));
  const f = luta.fechar(T(11));
  assert.strictEqual(f.alvo, 'Vakron');
  assert.strictEqual(f.total, 1000);
}

// Revisão — sem o relógio do jogo: o dano de antes de a app ver não entra no DPS.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 20; s++) luta.ler(L('X', null, 5000 + s * 100), T(s));
  const f = luta.fechar(T(21));
  assert.ok(Math.abs(f.dps - 100) <= 10, 'DPS ≈ 100, deu ' + f.dps);
  assert.ok(f.curva.every(([s], i) => i === 0 || s > f.curva[i - 1][0]), 'curva sempre a avançar');
}

// Relógio do jogo a falhar numa leitura: a curva não anda para trás.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 10; s++) luta.ler(L('X', s === 6 ? null : s, s * 100), T(s));
  const f = luta.fechar(T(11));
  assert.ok(f.curva.every(([s], i) => i === 0 || s > f.curva[i - 1][0]));
  assert.strictEqual(f.duracao, 10);
}

// A janela parada com o resultado da última luta quando a app arranca: não é luta nova.
{
  const luta = new M.Luta();
  for (let s = 1; s <= 20; s++) {
    const r = luta.ler(L('Divine Auldor', 184, 1660000), T(s));
    assert.strictEqual(r.terminou, null);
    assert.strictEqual(r.estado, 'parada');
  }
  // Mas quando o jogo começa outra, conta.
  for (let s = 21; s <= 30; s++) luta.ler(L('Divine Auldor', s - 20, (s - 20) * 1000), T(s));
  assert.strictEqual(luta.fechar(T(31)).total, 10000);
}

// Resumo: 10 s a 100/s e 5 s a 1000/s.
{
  const curva = [];
  for (let s = 0; s <= 10; s++) curva.push([s, s * 100]);
  for (let s = 11; s <= 15; s++) curva.push([s, 1000 + (s - 10) * 1000]);
  const r = M.resumo(curva);
  assert.strictEqual(r.duracao, 15);
  assert.strictEqual(r.dps, Math.round(6000 / 15));
  assert.strictEqual(r.picoDps, 1000);
}

// A janela "Combat Analysis" do jogo (cliente em inglês, OCR pt-PT), capturas reais.
{
  const ocr = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'amostras', n + '.ocr.json'), 'utf8'));

  // Achar a janela no ecrã inteiro (1440p): o retângulo cobre o título e os valores.
  const r = M.acharJanela(ocr('medidor-ecra-1440'));
  assert.ok(r, 'acha a janela');
  const [x, y, w, h] = r;
  assert.ok(x <= 273 && y <= 31 && x + w >= 640 && y + h >= 180, 'cobre a janela: ' + r);
  assert.ok(x + w < 800 && y + h < 320, 'não apanha meio ecrã: ' + r);
  assert.strictEqual(M.acharJanela([{ x1: 10, y1: 10, x2: 90, y2: 25, t: 'Expedition' }]), null);
  // Outros idiomas do jogo.
  assert.ok(M.acharJanela([{ x1: 10, y1: 10, x2: 150, y2: 28, t: 'Análise de comb...' }]));

  // Em luta: alvo, tempo, total e DPS.
  for (const n of ['medidor-luta', 'medidor-luta-1440']) {
    assert.deepStrictEqual(M.lerJanela(ocr(n)), { alvo: 'Divine Auldor', tempo: 184, total: 1660000, dps: 9050, habilidades: null }, n);
  }
  // Na própria leitura do ecrã inteiro, o resto do ecrã não atrapalha.
  assert.strictEqual(M.lerJanela(ocr('medidor-ecra-1440')).total, 1660000);

  // Antes da luta: a linha do alvo não existe e o OCR não lê o "0 (0)".
  assert.deepStrictEqual(M.lerJanela(ocr('medidor-vazio')), { alvo: null, tempo: null, total: null, dps: null, habilidades: null });

  // Sem a janela: null.
  assert.strictEqual(M.lerJanela([{ x1: 0, y1: 0, x2: 50, y2: 15, t: 'Expedition' }]), null);

  // Cliente em português (vídeo): tempo colado ao alvo, e "Danos totales".
  const pt = [
    { x1: 100, y1: 100, x2: 400, y2: 115, t: 'Medição: Espantalho de Treinamento 00:00' },
    { x1: 100, y1: 125, x2: 190, y2: 140, t: 'Danos totales' },
    { x1: 300, y1: 125, x2: 400, y2: 140, t: '79,72K (79,72K)' },
  ];
  assert.deepStrictEqual(M.lerJanela(pt), { alvo: 'Espantalho de Treinamento', tempo: 0, total: 79720, dps: 79720, habilidades: null });
  // Valor colado ao rótulo numa só linha do OCR.
  assert.strictEqual(M.lerJanela([{ x1: 0, y1: 0, x2: 300, y2: 15, t: 'Total Damage 812 (40)' }]).total, 812);
}

// Gravação em lutas.json.
{
  const { Lutas, MAXIMO } = require('../src/lutas');
  assert.strictEqual(MAXIMO, 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutas-'));
  const fich = path.join(dir, 'lutas.json');
  const feita = (n, extra = {}) => ({ alvo: 'Vakron', inicio: new Date(T(n)).toISOString(), duracao: 30, total: 30000 + n, dps: 1000, picoDps: 1500, curva: [[0, 0], [30, 30000 + n]], habilidades: null, ...extra });

  const g = new Lutas(fich);
  const a = g.adicionar(feita(1), { personagem: 'LusitanoGlad' });
  assert.ok(a.id);
  assert.strictEqual(a.personagem, 'LusitanoGlad');
  assert.strictEqual(a.build, null);
  g.adicionar(feita(2), { personagem: 'Outro' });
  assert.strictEqual(g.adicionar(feita(3, { duracao: 4 }), {}), null, 'curta não grava');
  assert.strictEqual(g.adicionar(feita(4, { total: 0 }), {}), null, 'total 0 não grava');

  // Volta a ler do disco; mais recente primeiro; filtro por personagem.
  const g2 = new Lutas(fich);
  assert.deepStrictEqual(g2.todas().map((l) => l.total), [30002, 30001]);
  assert.deepStrictEqual(g2.todas('LusitanoGlad').map((l) => l.total), [30001]);

  assert.strictEqual(g2.mudar(a.id, { alvo: 'Vakron (corrigido)', build: 'Build B', total: 1 }).alvo, 'Vakron (corrigido)');
  assert.strictEqual(new Lutas(fich).todas('LusitanoGlad')[0].build, 'Build B');
  assert.strictEqual(new Lutas(fich).todas('LusitanoGlad')[0].total, 30001, 'só alvo e build mudam');
  assert.strictEqual(g2.mudar('nao-existe', { alvo: 'x' }), null);
  assert.strictEqual(g2.apagar(a.id), true);
  assert.strictEqual(g2.apagar(a.id), false);
  assert.strictEqual(new Lutas(fich).todas().length, 1);

  // 501 lutas → ficam 500, sai a mais antiga.
  const g3 = new Lutas(path.join(dir, 'muitas.json'));
  for (let i = 0; i < 501; i++) g3.adicionar(feita(10 + i), {});
  const todas = new Lutas(path.join(dir, 'muitas.json')).todas();
  assert.strictEqual(todas.length, 500);
  assert.ok(!todas.some((l) => l.total === 30010), 'a mais antiga saiu');
  // Uma luta mais antiga do que todas as 500 não entra (nem se anuncia).
  assert.strictEqual(g3.adicionar(feita(0), {}), null);

  // Ficheiro estragado: começa vazio e guarda o mau à parte.
  const mau = path.join(dir, 'mau.json');
  fs.writeFileSync(mau, '{lixo');
  assert.deepStrictEqual(new Lutas(mau).todas(), []);
  assert.strictEqual(fs.readFileSync(mau + '.mau', 'utf8'), '{lixo');
  fs.writeFileSync(mau, JSON.stringify({ versao: 99, lutas: [{}] }));
  assert.deepStrictEqual(new Lutas(mau).todas(), []);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('test-medidor: números, tempos, lutas e gravação OK');
