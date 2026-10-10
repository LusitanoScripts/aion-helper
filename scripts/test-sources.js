'use strict';

// src/sources.js e src/names.js com a rede falsificada. As respostas são cópias
// reduzidas das reais (6 Out 2026), por isso a forma dos dados é a verdadeira.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const respostas = new Map();
const pedidos = [];
global.fetch = async (url) => {
  pedidos.push(url);
  for (const [padrao, r] of respostas) {
    if (url.includes(padrao)) {
      const corpo = typeof r === 'function' ? r(url) : r;
      if (corpo instanceof Error) throw corpo;
      const status = corpo && corpo.__status ? corpo.__status : 200;
      return { ok: status < 400, status, text: async () => JSON.stringify(corpo) };
    }
  }
  return { ok: false, status: 404, text: async () => '{}' };
};

const sources = require('../src/sources');
const { Cache } = require('../src/cache');
const { Nomes } = require('../src/names');

const linhaReal = {
  item_key: 516530001,
  name: 'Amplify Stone (Unique)',
  category: { id: 46, name: 'Amplify stones', section_id: 'materials', section_name: 'Materials' },
  price: 59997.0,
  listings: 52,
  captured_at: '2026-10-06T11:45:44.977000Z',
  change_pct: 0.2556,
  units_sold: 1509,
  sold_avg_price: 38886.0,
  sold_min_price: 20000.0,
  sold_max_price: 94998.0,
};

async function main() {
  let n = 0;

  // ── paginação: o máximo é 200, e há servidores com 545 itens ─────────────
  respostas.set('/api/items?', (url) => {
    const off = Number(new URL(url).searchParams.get('offset'));
    const lim = Number(new URL(url).searchParams.get('limit'));
    assert.ok(lim <= 200, 'a API recusa limit > 200');
    const total = 545;
    const qtd = Math.max(0, Math.min(lim, total - off));
    return { total, limit: lim, offset: off, items: Array.from({ length: qtd }, (_, i) => ({ ...linhaReal, item_key: off + i + 1 })) };
  });
  const linhas = await sources.itensDoServidor(12101);
  assert.strictEqual(linhas.length, 545);
  assert.strictEqual(new Set(linhas.map((l) => l.id)).size, 545, 'páginas sobrepostas ou em falta');
  assert.ok(pedidos.every((u) => !u.includes('/items?') || u.includes('server=12101')), 'o parâmetro chama-se server, não server_id');
  n++;

  // ── a linha limpa mantém o que as contas precisam ───────────────────────
  const l = sources.limparLinha(linhaReal);
  assert.strictEqual(l.id, 516530001);
  assert.strictEqual(l.nomeEN, 'Amplify Stone (Unique)');
  assert.strictEqual(l.seccaoNome, 'Materials');
  assert.strictEqual(l.sold_avg_price, 38886);
  assert.strictEqual(sources.limparLinha({ ...linhaReal, category: null }).categoria, null);
  n++;

  // ── profundidade traz o número de unidades do topo ──────────────────────
  respostas.set('/depth', { item_key: 1, units: 50, points: [{ status: 'ok', cost: 3075399, unit_avg: 61507.98, units_stacks: 52 }] });
  const prof = await sources.profundidade(1, 11304);
  assert.strictEqual(prof.unidades, 50);
  assert.ok(Math.abs(prof.pontos[0].cost / prof.unidades - prof.pontos[0].unit_avg) < 0.01, 'unit_avg é cost ÷ units');
  n++;

  // ── ficha da NC ─────────────────────────────────────────────────────────
  respostas.set('gameconst/item', (url) => {
    const id = Number(new URL(url).searchParams.get('id'));
    if (id === 999) return { id: 0, name: '', grade: '' }; // id desconhecido: 200 com zeros
    if (id === 500) return { __status: 404 };
    return {
      id,
      name: 'Pedra de Superação (Única)',
      grade: 'Unique',
      gradeName: 'Único',
      icon: 'https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Item_Enchant_Amplify_A_001.png',
      tradable: true,
      categoryName: 'Diversos',
    };
  });
  const f = await sources.fichaNC(516530001);
  assert.strictEqual(f.nome, 'Pedra de Superação (Única)');
  assert.ok(f.icone.startsWith('https://assets.playnccdn.com/'), 'o CSP do index.html só deixa este anfitrião');
  assert.ok(pedidos.some((u) => u.includes('/pt-br/api/gameconst/item') && u.includes('lang=pt-BR')), 'caminho e lang em pt-BR');
  assert.strictEqual(await sources.fichaNC(999), null, 'id desconhecido não vira um item sem nome');
  n++;

  // ── o CSP do index.html bate com o anfitrião dos ícones ─────────────────
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(/img-src[^;]*https:\/\/assets\.playnccdn\.com/.test(html), 'falta assets.playnccdn.com no img-src');
  n++;

  // ── nomes: guarda, não repete, e entrega por lotes ──────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-nomes-'));
  try {
    const cache = new Cache(dir);
    const nomes = new Nomes(cache);
    const ids = Array.from({ length: 30 }, (_, i) => 1000 + i);
    const lotes = [];
    await nomes.completar(ids, (lote, prog) => lotes.push({ qtd: Object.keys(lote).length, ...prog }));
    assert.deepStrictEqual(lotes.map((x) => x.qtd), [25, 5], 'lotes de 25 e o resto no fim');
    assert.ok(lotes[lotes.length - 1].fim);
    assert.strictEqual(Object.keys(nomes.conhecidos(ids)).length, 30);

    const antes = pedidos.length;
    const outra = new Nomes(new Cache(dir)); // como se a app tivesse reiniciado
    assert.strictEqual(outra.emFalta(ids).length, 0, 'os nomes têm de sobreviver ao reinício');
    await outra.completar(ids);
    assert.strictEqual(pedidos.length, antes, 'não volta a pedir o que já sabe');

    // Duas chamadas ao mesmo tempo partilham a mesma corrida.
    const n3 = new Nomes(new Cache(fs.mkdtempSync(path.join(os.tmpdir(), 'aion-nomes-'))));
    const p1 = n3.completar([1, 2, 3]);
    const p2 = n3.completar([1, 2, 3]);
    assert.strictEqual(p1, p2);
    await p1;
    n++;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── nomes noutro idioma: o pedido vai no idioma, e a cache é outra ─────
  {
    const dirIdioma = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-nomes-'));
    try {
      const antes = pedidos.length;
      const en = new Nomes(new Cache(dirIdioma), 'en-US');
      await en.completar([777]);
      const feitos = pedidos.slice(antes);
      assert.ok(feitos.some((u) => u.includes('/en-us/api/gameconst/item') && u.includes('lang=en-US')), 'pedido em en-US');
      assert.ok(fs.existsSync(path.join(dirIdioma, 'nomes-en-US.json')), 'cache própria do idioma');
      assert.ok(!fs.existsSync(path.join(dirIdioma, 'nomes-pt-BR.json')), 'não mistura com o português');
      n++;
    } finally {
      fs.rmSync(dirIdioma, { recursive: true, force: true });
    }
  }

  console.log(`test-sources: ${n} testes passaram`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
