'use strict';

// src/builds.js (guardar, limpar, código de partilha) e src/habilidades.js com a
// rede falsificada. As respostas são cópias reduzidas das reais (10 Out 2026).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const respostas = [];
global.fetch = async (url) => {
  for (const [padrao, r] of respostas) {
    if (url.includes(padrao)) {
      const corpo = typeof r === 'function' ? r(url) : r;
      return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
    }
  }
  return { ok: false, status: 404, text: async () => '{}' };
};

const B = require('../src/builds');
const H = require('../src/habilidades');
const D = require('../src/daevanion');

async function main() {
  let n = 0;

  // ── limpar: o que não tem forma certa sai ───────────────────────────────
  {
    const b = B.limpar({
      classe: 'Gladiator',
      nome: '  ',
      niveis: { 11020000: { nivel: 99, espec: -3 }, abc: { nivel: 2 }, 5: 'x' },
      barra: [11020000, 'x', -1, 1.5, null, 11010000],
      prioridade: { Active: [11020000, 'mau'], Dp: 'nada', Outra: [1] },
      macros: [{ nome: 'm', texto: 't', lixo: 1 }, null],
    });
    assert.strictEqual(b.nome, 'Sem nome');
    assert.deepStrictEqual(b.niveis, { 11020000: { nivel: B.NIVEL_MAX, espec: 0 } });
    assert.strictEqual(b.barra.length, B.BARRAS * B.CASAS);
    assert.deepStrictEqual(b.barra.slice(0, 6), [11020000, null, null, null, null, 11010000]);
    assert.deepStrictEqual(b.prioridade, { Active: [11020000], Dp: [], Passive: [] });
    assert.deepStrictEqual(b.macros, [{ nome: 'm', texto: 't' }]);
    assert.strictEqual(B.limpar({ classe: '<img>' }), null, 'classe com lixo recusada');
    assert.strictEqual(B.limpar(null), null);
    n++;
  }

  // ── código de partilha: ida e volta, sem id nem datas ────────────────────
  {
    const b = B.novaBuild('Templar');
    b.nome = 'Tanque PvE ✓';
    b.barra[0] = 12010000;
    b.niveis[12010000] = { nivel: 12, espec: 3 };
    b.macros = [{ nome: 'abrir', texto: 'A > B' }];
    const codigo = B.exportar(b);
    assert.ok(codigo.startsWith('AH1:'));
    assert.ok(codigo.length < 500, `código curto (${codigo.length})`);
    // Do Discord vem partido em linhas.
    const partido = codigo.slice(0, 20) + '\n  ' + codigo.slice(20);
    const de = B.importar(partido);
    assert.strictEqual(de.nome, 'Tanque PvE ✓');
    assert.strictEqual(de.barra[0], 12010000);
    assert.strictEqual(de.barra.length, B.BARRAS * B.CASAS);
    assert.deepStrictEqual(de.niveis[12010000], { nivel: 12, espec: 3 });
    assert.notStrictEqual(de.id, b.id, 'quem importa fica com uma build sua');
    assert.throws(() => B.importar('olá'), /AH1:/);
    assert.throws(() => B.importar('AH1:@@@'), /partido|classe/);
    assert.throws(() => B.importar('AH1:' + Buffer.from('{"nome":"x"}').toString('base64url')), /classe/);
    n++;
  }

  // ── guardar em disco ─────────────────────────────────────────────────────
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-builds-'));
    try {
      const s = new B.Builds(dir);
      const a = s.guardar(B.novaBuild('Gladiator'));
      a.nome = 'mudada';
      s.guardar(a);
      s.guardar(B.novaBuild('Cleric'));
      const outra = new B.Builds(dir);
      assert.strictEqual(outra.todas().length, 2);
      assert.strictEqual(outra.todas().find((x) => x.id === a.id).nome, 'mudada');
      assert.strictEqual(outra.apagar(a.id).length, 1);
      fs.writeFileSync(path.join(dir, 'builds.json'), '{partido');
      assert.deepStrictEqual(new B.Builds(dir).todas(), [], 'ficheiro partido = sem builds, sem rebentar');
      n++;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── catálogo da classe: pela ficha de um personagem qualquer ─────────────
  {
    respostas.push(['/gameinfo/classes', { classList: [{ id: 2, name: 'Gladiator', text: 'Gladiador' }, { id: 6, name: 'Elementalist', text: 'Espiritualista' }] }]);
    respostas.push(['/gameinfo/pcdata', { pcDataList: [5, 6, 7, 8].map((id) => ({ className: 'GLADIATOR', id })).concat([{ className: 'ELEMENTALIST', id: 21 }]) }]);
    const pesquisas = [];
    respostas.push([
      'api-search.plaync.com',
      (url) => {
        pesquisas.push(new URL(url).searchParams);
        return { list: [{ characterId: 'apagado%3D', name: '<strong>A</strong>', serverId: 1, level: 1, race: 1, pcId: 5 }, { characterId: 'bom%3D', name: '<strong>A</strong>na', serverId: 2, level: 9, race: 1, pcId: 5 }] };
      },
    ]);
    const ficha = (id, cat, nivel) => ({ id, name: 'h' + id, category: cat, icon: 'https://assets.playnccdn.com/x.png', needLevel: 1, skillLevel: nivel, acquired: nivel ? 1 : 0, equip: 1 });
    respostas.push([
      '/api/character/equipment',
      (url) =>
        new URL(url).searchParams.get('characterId') === 'apagado='
          ? { skill: { skillList: [] } } // personagem apagado: 200 com a lista vazia
          : { skill: { skillList: [ficha(3, 'Passive', 0), ficha(1, 'Active', 5), ficha(2, 'Dp', 0)] } },
    ]);

    const cs = await H.classes('pt-BR');
    assert.deepStrictEqual(cs.find((c) => c.nome === 'Elementalist').pcIds, [21], 'Elementalist ↔ ELEMENTALIST');
    const gl = cs.find((c) => c.nome === 'Gladiator');
    const lista = await H.habilidadesDaClasse(gl);
    assert.deepStrictEqual(lista.map((h) => h.categoria), ['Active', 'Dp', 'Passive'], 'ordem ativas, estigmas, passivas');
    assert.ok(!('nivel' in lista[0]), 'o catálogo não leva o nível do personagem emprestado');
    assert.strictEqual(pesquisas[0].get('pcId'), '5,6,7,8');

    const achados = await H.procurarPersonagens('Ana');
    assert.strictEqual(achados[1].nome, 'Ana', 'sem o <strong> do realce');
    assert.strictEqual(achados[1].personagem, 'bom=', 'id descodificado uma vez');
    assert.deepStrictEqual(pesquisas.slice(-2).map((p) => p.get('race')), ['1', '2'], 'as duas raças');
    const minhas = await H.habilidadesDoPersonagem(achados[1]);
    assert.deepStrictEqual(minhas.find((h) => h.id === 1), { id: 1, nome: 'h1', categoria: 'Active', icone: 'https://assets.playnccdn.com/x.png', nivelNecessario: 1, nivel: 5, aprendida: true, equipada: true });
    n++;
  }

  // ── Daevanion: abrir junto de um aberto, fechar em cadeia, somar ────────
  {
    const no = (id, linha, coluna, tipo = 'Stat', efeitos = []) => ({ id, linha, coluna, tipo, grau: 'Common', nome: '', efeitos });
    //   S 1 2
    //   3 . 4      (4 só liga ao 2)
    const nos = [no(0, 1, 1, 'Start'), no(1, 1, 2, 'Stat', ['Ataque +5']), no(2, 1, 3, 'Stat', ['Ataque +10', 'PV +1.5%']), no(3, 2, 1, 'Stat', ['PV +2.5%']), no(4, 2, 3, 'SkillLevel', ['Golpe +1'])];
    assert.deepStrictEqual([...D.abriveis(nos, [])].sort(), [1, 3], 'sem nada aberto: só os vizinhos do início');
    assert.deepStrictEqual([...D.abriveis(nos, [1, 2])].sort(), [3, 4]);
    assert.deepStrictEqual(D.fechar(nos, [1, 2, 4, 3], 1).sort(), [3], 'fechar o 1 desliga o 2 e o 4');
    assert.deepStrictEqual(D.fechar(nos, [1, 2, 4], 4).sort(), [1, 2], 'uma folha fecha sozinha');
    const soma = D.somarEfeitos(nos, [1, 2, 3, 4]);
    const de = (n, u = '') => soma.find((e) => e.nome === n && e.unidade === u);
    assert.strictEqual(de('Ataque').valor, 15);
    assert.strictEqual(de('PV', '%').valor, 4, '1,5% + 2,5% sem erro de vírgula flutuante');
    assert.strictEqual(de('Golpe').habilidade, true);
    n++;
  }

  console.log(`test-builds: ${n} testes passaram`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
