'use strict';

// O olho das mascotes: nomes no texto do OCR (com os erros típicos dele), o alvo,
// as almas do chat a subir, e a coleção dividida pela luz do texto. Usa a lista
// verdadeira de mascotes (pt-BR), que é onde os nomes parecidos se atropelam.

const fs = require('fs');
const path = require('path');
const O = require('../src/olho-mascotes');

let falhas = 0;
function igual(real, esperado, msg) {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    console.error(`✗ ${msg}: deu ${JSON.stringify(real)}, esperava ${JSON.stringify(esperado)}`);
    falhas++;
  }
}

const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'dados', 'mascotes.json'), 'utf8'));
const cat = O.catalogo(j.mascotes.map((m) => ({ id: m.id, nome: m.n['pt-BR'] })));
const id = (nome) => j.mascotes.find((m) => m.n['pt-BR'] === nome).id;
const nomes = (t) => O.nomesNoTexto(t, cat).map((a) => a.nome);
const linha = (t, y = 0, x = 0) => ({ t, x1: x, y1: y, x2: x + 200, y2: y + 20 });

// Nomes certos, com acentos perdidos e com erros de OCR.
igual(nomes('Abelha Mutante'), ['Abelha Mutante'], 'nome exato');
igual(nomes('Anima da Floresta Nv. 12'), ['Ânima da Floresta'], 'sem acento e com nível ao lado');
igual(nomes('Abeiha Mutante'), ['Abelha Mutante'], 'l lido como i');
igual(nomes('Aranha Cinzenta'), ['Aranha Cinzenta'], 'o nome comprido ganha ao curto');
igual(nomes('Aranhas'), [], 'palavra inteira: Aranhas não é Aranha');
igual(nomes('Missão diária concluída'), [], 'texto sem mascote');

// O alvo: o mais certo, e o de cima em caso de empate.
const alvo = O.mascoteDoAlvo([linha('HP 1.234/5.000', 0), linha('Abelha Mutante', 30), linha('Aranha', 80)], cat);
igual(alvo && alvo.id, id('Abelha Mutante'), 'mascote do alvo');

// O chat a subir: a mesma linha não conta duas vezes; uma igual nova conta.
const msg = 'Você obteve [Alma: Abelha Mutante (Vinculado)]';
const l1 = O.almasNoChat([linha('[Grupo] olá', 0), linha(msg, 20)], cat);
igual([...l1.values()].map((e) => e.n), [1], 'uma linha de alma');
const l2 = O.almasNoChat([linha(msg, 0), linha('outra coisa', 20)], cat);
igual(O.almasNovas(l1, l2), [], 'a linha subiu: nada de novo');
const l3 = O.almasNoChat([linha(msg, 0), linha('Abelha Mutante entrou no chat', 10), linha(msg, 20)], cat);
igual(O.almasNovas(l2, l3), [{ id: id('Abelha Mutante'), nome: 'Abelha Mutante', n: 1 }], 'outra alma igual');
igual(O.almasNovas(l3, O.almasNoChat([], cat)), [], 'o chat limpo não tira almas');
igual([...O.almasNoChat([linha('Abelha Mutante disse olá')], cat).keys()], [], 'nome sem "Alma" não é alma');
igual(O.almasNovas(new Map(), O.almasNoChat([linha('You acquired Soul: Abelha Mutante')], cat)).length, 1, 'em inglês');

// A coleção: dois grupos de luz → os claros são "tem"; luz toda igual → não se adivinha.
const col = O.lerColecao([linha('Abelha Mutante', 0), linha('Aranha', 40), linha('Agrint', 80)], cat, (l) => ({ 0: 220, 40: 90, 80: 215 })[l.y1]);
igual(col.map((c) => [c.nome, c.tem]), [['Abelha Mutante', true], ['Aranha', false], ['Agrint', true]], 'coleção pela luz');
const igualLuz = O.lerColecao([linha('Abelha Mutante', 0), linha('Aranha', 40)], cat, () => 200);
igual(igualLuz.map((c) => c.tem), [null, null], 'luz igual: por decidir');

// A leitura contínua: vários ecrãs juntam-se; a luz é a mediana (o rato por cima não engana).
const C = new O.Colecao();
const luzes = { 0: 220, 40: 90 };
C.juntar([linha('Abelha Mutante', 0), linha('Aranha', 40)], cat, (l) => luzes[l.y1]);
luzes[40] = 230; // o rato passou por cima da Aranha (em falta): acendeu
C.juntar([linha('Aranha', 40), linha('Agrint', 80)], cat, (l) => ({ ...luzes, 80: 95 })[l.y1]);
luzes[40] = 92;
igual(C.juntar([linha('Aranha', 40)], cat, (l) => luzes[l.y1]), 0, 'nada de novo no 3.º ecrã');
igual(C.lista().map((c) => [c.nome, c.tem]), [['Abelha Mutante', true], ['Aranha', false], ['Agrint', false]], 'contínua: mediana da luz');

// Zonas em frações da janela.
igual(O.zonaNaJanela({ x: 0.5, y: 0.1, w: 0.25, h: 0.5 }, [100, 0, 2560, 1440]), { x: 1380, y: 144, w: 640, h: 720 }, 'zona na janela');

// A vigia, com um OCR falso: base primeiro, depois só o que é novo.
(async () => {
  let chat = [linha(msg, 0)];
  let topo = [linha('Abelha Mutante', 10)];
  const ocr = {
    ver: async () => ({ jogo: true, janela: [0, 0, 2560, 1440], rodapes: [] }),
    lerZona: async (x, y) => (y === 0 ? topo : chat),
  };
  const alvos = [];
  const almas = [];
  const v = new O.VigiaMascotes({
    ocr,
    cat: () => cat,
    opcoes: () => ({ alvo: true, almas: true }),
    aoAlvo: (a) => alvos.push(a && a.nome),
    aoAlmas: (n) => almas.push(...n.map((x) => x.nome)),
  });
  await v.passo();
  igual(almas, [], 'a primeira leitura do chat é só a base');
  chat = [linha(msg, 0), linha(msg, 20)];
  topo = [];
  await v.passo();
  await v.passo();
  igual(almas, ['Abelha Mutante'], 'alma nova contada uma vez');
  igual(alvos, ['Abelha Mutante', null], 'alvo aparece e some à 2.ª leitura vazia');

  // Tempo de uma volta inteira de nomes (206 mascotes × 30 linhas).
  const t0 = Date.now();
  O.nomesNasLinhas(Array.from({ length: 30 }, (_, i) => linha('Você obteve 3 Pedras de Superação e um Baú', i)), cat);
  const ms = Date.now() - t0;
  if (ms > 300) {
    console.error(`✗ procurar em 30 linhas levou ${ms} ms`);
    falhas++;
  }

  // A vigia não pode ler o próprio aviso como alvo (ficava "Slime" para sempre).
  {
    const catS = O.catalogo([{ id: 7, nome: 'Slime' }]);
    const linhaSlime = { t: 'Slime', x1: 1100, y1: 80, x2: 1160, y2: 100 };
    const vistos = [];
    const vigia = new O.VigiaMascotes({
      ocr: { ver: async () => ({ jogo: true, janela: [0, 0, 2560, 1440] }), lerZona: async () => [linhaSlime] },
      cat: () => catS,
      opcoes: () => ({ alvo: true, almas: false }),
      aoAlvo: (a) => vistos.push(a ? a.nome : null),
      aoAlmas: () => {},
      ignorar: () => [[1090, 70, 440, 170]], // o aviso está exatamente aí
    });
    await vigia.passo();
    if (vistos.length) {
      falhas++;
      console.error('a vigia leu o próprio aviso como alvo:', vistos);
    }
    vigia.ignorar = () => [];
    await vigia.passo();
    if (vistos[0] !== 'Slime') {
      falhas++;
      console.error('sem aviso por cima, devia ver o alvo Slime:', vistos);
    }
  }

  // O contador do jogo no topo da coleção (captura do utilizador, cliente em inglês).
  const contadores = [
    ['Collection Status 84/200', { tem: 84, total: 200 }],
    ['Estado da Coleção 12 / 200', { tem: 12, total: 200 }],
    ['Collect Kobold Worker Gear (0/4)', null], // passo de missão, não é a coleção
    ['Kaisinel 84/200', null],
  ];
  for (const [t, esperado] of contadores) {
    const r = O.contadorColecao([{ t }]);
    if (JSON.stringify(r) !== JSON.stringify(esperado)) {
      falhas++;
      console.error(`contadorColecao(${JSON.stringify(t)}) = ${JSON.stringify(r)}, esperava ${JSON.stringify(esperado)}`);
    }
  }
  const col = new O.Colecao();
  col.juntar([{ t: 'Collection Status 84/200', x1: 0, y1: 0, x2: 10, y2: 10 }], O.catalogo([]), null);
  col.juntar([], O.catalogo([]), null); // um ecrã sem o contador não o apaga
  if (!col.contador || col.contador.tem !== 84) {
    falhas++;
    console.error('Colecao não guardou o contador do jogo');
  }

  if (falhas) {
    console.error(`test-olho-mascotes: ${falhas} falha(s)`);
    process.exit(1);
  }
  console.log(`test-olho-mascotes: tudo certo (30 linhas em ${ms} ms)`);
})();
