'use strict';

// A ficha de um personagem e os tabuleiros Daevanion, pela web oficial da NC.
//
//  /api/character/info              perfil, atributos, títulos, lista dos tabuleiros
//  /api/character/equipment         equipamento, asas, mascote, habilidades
//  /api/character/equipment/item    um item equipado com tudo (atributos, pedras)
//  /api/character/daevanion/detail  um tabuleiro inteiro: todas as casas da
//                                   grelha, com o que cada nó dá e se está aberto
//
// Os tabuleiros são da classe (Gladiador 11–16, Templário 21–26…; o 5.º número
// ainda não existe no Global a 10 Out 2026). As casas "None" são buracos na
// grelha; os nós ligam-se aos vizinhos de cima, baixo e lados, a partir do
// "Start" — verificado: os 89 nós do Nezekan do Gladiador ligam-se todos assim.

const { getJSON } = require('./http');
const { procurarPersonagens } = require('./habilidades');
const { fichaItem } = require('./sources');

const NC = 'https://aion2.plaync.com';

function qs(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return '?' + p.toString();
}

function base(ref, { idioma = 'pt-BR', regiao = 'eu' } = {}) {
  return { lang: idioma, region: regiao, serverId: ref.servidor, characterId: ref.personagem };
}

function descricoes(l) {
  return (Array.isArray(l) ? l : []).map((e) => e && e.desc).filter(Boolean);
}

// A NC anda instável (13 Out 2026): o MESMO pedido, repetido de segundos a segundos, umas
// vezes traz equipamento/habilidades/atributos e outras vem com null ou tudo a 0 — e às
// vezes com atributos de outra leitura. Ex.: 10 pedidos → equipamento 4×, habilidades 2×.
// Por isso lê-se várias vezes e, em cada secção, fica a resposta que mais se repete.
const RONDAS_MAX = 6;
const PAUSA_MS = 800;

function moda(lista) {
  const conta = new Map();
  for (const v of lista) {
    const k = JSON.stringify(v);
    const c = conta.get(k) || { v, n: 0 };
    c.n++;
    conta.set(k, c);
  }
  let melhor = null;
  for (const c of conta.values()) if (!melhor || c.n > melhor.n) melhor = c;
  return melhor;
}

const temLista = (l) => Array.isArray(l) && l.length > 0;
const semNivelItem = (stats) => stats.filter((s) => s.type !== 'ItemLevel');
const statsVazios = (stats) => !temLista(stats) || semNivelItem(stats).every((s) => !s.value);

async function lerVariasVezes(q) {
  const infos = [];
  const eqs = [];
  for (let i = 0; i < RONDAS_MAX; i++) {
    if (i) await new Promise((r) => setTimeout(r, PAUSA_MS));
    const [info, eq] = await Promise.all([
      getJSON(`${NC}/api/character/info${qs(q)}`).catch((e) => (i === 0 ? Promise.reject(e) : null)),
      getJSON(`${NC}/api/character/equipment${qs(q)}`).catch(() => null),
    ]);
    if (info && info.profile) infos.push(info);
    if (eq) eqs.push(eq);
    const st = infos.map((x) => (x.stat && x.stat.statList) || []).filter((l) => !statsVazios(l)).map(semNivelItem);
    const okStats = st.length && moda(st).n >= 2;
    const okEq = eqs.some((x) => x.equipment && temLista(x.equipment.equipmentList));
    const okSk = eqs.some((x) => x.skill && temLista(x.skill.skillList));
    if (okStats && okEq && okSk) break;
  }
  return { infos, eqs };
}

/**
 * opts.memoria (opcional) = { ler(chave) → {dados, idadeMs} | null, gravar(chave, dados) }:
 * guarda cada secção boa; quando a NC não a manda, usa-se a guardada e diz-se de quando é.
 */
async function ficha(ref, opts = {}) {
  const q = base(ref, opts);
  const { infos, eqs } = await lerVariasVezes(q);
  const info = infos[0];
  if (!info || !info.profile || !info.profile.characterName) throw new Error('A NC não tem esse personagem (apagado ou mudou de nome?)');
  const p = info.profile;

  // Atributos: a leitura não-vazia mais repetida; o nível de item à parte (também varia).
  const leiturasStats = infos.map((x) => (x.stat && x.stat.statList) || []).filter((l) => !statsVazios(l));
  const mStats = leiturasStats.length ? moda(leiturasStats.map(semNivelItem)) : null;
  // De preferência das leituras cujos atributos batem com os escolhidos (as outras às vezes trazem outro valor).
  const chaveStats = mStats ? JSON.stringify(mStats.v) : null;
  const nivelDe = (l) => l.find((s) => s.type === 'ItemLevel');
  const concordam = leiturasStats.filter((l) => JSON.stringify(semNivelItem(l)) === chaveStats).map(nivelDe).filter((s) => s && s.value);
  const niveis = concordam.length ? concordam : infos.map((x) => nivelDe((x.stat && x.stat.statList) || [])).filter((s) => s && s.value);
  const mNivel = niveis.length ? moda(niveis.map((s) => s.value)) : null;
  const listaEq = eqs.map((x) => x.equipment && x.equipment.equipmentList).filter(temLista);
  const listaSk = eqs.map((x) => x.skill && x.skill.skillList).filter(temLista);
  const pw = eqs.map((x) => x.petwing).filter(Boolean);

  const novo = {
    atributos: mStats ? mStats.v : null,
    nivelItem: mNivel ? mNivel.v : null,
    equipamento: listaEq.length ? moda(listaEq).v : null,
    habilidades: listaSk.length ? moda(listaSk).v : null,
  };

  // O que faltou vem da última leitura boa guardada (com a idade, para a ficha avisar).
  const velhos = {};
  const mem = opts.memoria;
  const chave = `ficha-${ref.servidor}-${ref.personagem}`;
  if (mem) {
    let guardado = null;
    try {
      guardado = mem.ler(chave);
    } catch {}
    const g = (guardado && guardado.dados) || {};
    for (const k of Object.keys(novo)) {
      if (novo[k] == null && g[k] && g[k].v != null) {
        novo[k] = g[k].v;
        velhos[k] = Date.now() - g[k].quando;
      }
    }
    const gravar = { ...g };
    const agora = Date.now();
    for (const k of Object.keys(novo)) if (novo[k] != null && velhos[k] == null) gravar[k] = { v: novo[k], quando: agora };
    try {
      mem.gravar(chave, gravar);
    } catch {}
  }
  const faltam = Object.keys(novo).filter((k) => novo[k] == null);
  // Leituras que não batem umas com as outras: a ficha mostra a mais repetida e avisa.
  const duvidas = {};
  const distintos = (l) => [...new Set(l.map((v) => JSON.stringify(v)))].length;
  if (leiturasStats.length && distintos(leiturasStats.map(semNivelItem)) > 1) duvidas.atributos = true;
  const todosNiveis = [...new Set(infos.map((x) => nivelDe((x.stat && x.stat.statList) || [])).filter((x) => x && x.value).map((x) => x.value))];
  if (todosNiveis.length > 1) duvidas.nivelItem = todosNiveis.sort((x, y) => x - y);

  const stats = novo.atributos || [];
  const asa = pw.map((x) => x.wing).find((w) => w && w.id);
  const pet = pw.map((x) => x.pet).find((x) => x && x.id);
  return {
    ref: { servidor: ref.servidor, personagem: ref.personagem },
    nc: { leituras: infos.length, faltam, velhos, duvidas },
    perfil: {
      nome: p.characterName,
      nivel: p.characterLevel,
      classe: p.className,
      pcId: p.pcId,
      poder: p.combatPower,
      nivelItem: novo.nivelItem,
      raca: p.raceName,
      racaId: p.raceId,
      servidor: p.serverName,
      titulo: p.titleName || null,
      tituloGrau: p.titleGrade || null,
      retrato: /^https:\/\/profileimg\.plaync\.com\//.test(p.profileImage || '') ? p.profileImage : null,
    },
    atributos: stats.map((s) => ({ nome: s.name, tipo: s.type, valor: s.value, extra: s.statSecondList || [] })),
    titulos: {
      tem: (info.title && info.title.ownedCount) || 0,
      equipados: ((info.title && info.title.titleList) || []).map((t) => ({ id: t.id, nome: t.name, grau: t.grade, categoria: t.equipCategory, efeitos: descricoes(t.equipStatList), raridade: t.ownedPercent })),
    },
    tabuleiros: ((info.daevanion && info.daevanion.boardList) || []).map((b) => ({ id: b.id, nome: b.name, icone: b.icon, abertos: b.openNodeCount, total: b.totalNodeCount, aberto: b.open === 1 })),
    equipamento: (novo.equipamento || []).map((x) => ({
      casa: x.slotPos,
      casaNome: x.slotPosName,
      id: x.id,
      nome: x.name,
      grau: x.grade,
      encantamento: x.enchantLevel || 0,
      superacao: x.exceedLevel || 0,
      icone: x.icon,
    })),
    asa: asa ? { id: asa.id, nome: asa.name, grau: asa.grade, encantamento: asa.enchantLevel || 0, icone: asa.icon } : null,
    mascote: pet ? { id: pet.id, nome: pet.name, nivel: pet.level, icone: pet.icon } : null,
    habilidades: (novo.habilidades || []).map((s) => ({
      id: s.id,
      nome: s.name,
      categoria: s.category,
      icone: s.icon,
      nivel: s.skillLevel || 0,
      equipada: s.equip === 1,
    })),
  };
}

/** Um item equipado, tal como o jogo o mostra (com o encantamento e as pedras desse personagem). */
async function itemEquipado(ref, { id, encantamento, casa }, opts) {
  const j = await getJSON(`${NC}/api/character/equipment/item${qs({ ...base(ref, opts), id, enchantLevel: encantamento || 0, slotPos: casa })}`);
  if (!j || !j.id) throw new Error('A NC não devolveu esse item');
  return limparItem(j);
}

/** A ficha de um item pelo id, sem personagem (a +0, ou com o encantamento pedido). */
async function item(id, { idioma = 'pt-BR', encantamento = 0 } = {}) {
  const j = await fichaItem(id, idioma, encantamento);
  if (!j) return null;
  // De Taiwan (o Global deixou de dar fichas): textos em inglês, fontes do servidor de lá.
  return { ...limparItem(j), deTaiwan: !!j.deTaiwan };
}

function limparItem(j) {
  const st = (l) => (Array.isArray(l) ? l : []).map((s) => ({ nome: s.name, valor: s.value, minimo: s.minValue || null, extra: s.extra && s.extra !== '0' ? s.extra : null }));
  return {
    id: j.id,
    nome: j.name,
    grau: j.grade,
    grauNome: j.gradeName,
    icone: j.icon,
    categoria: j.categoryName,
    nivel: j.level || 0,
    nivelEquipar: j.equipLevel || 0,
    encantamento: j.enchantLevel || 0,
    encantamentoMax: j.maxEnchantLevel || 0,
    transacionavel: !!j.tradable,
    raca: j.raceName || null,
    classes: j.classNames || [],
    principais: st(j.mainStats),
    secundarios: st(j.subStats),
    pedras: (Array.isArray(j.magicStoneStat) ? j.magicStoneStat : []).map((p) => ({ nome: p.name, valor: p.value, grau: p.grade, icone: p.icon })),
    casasPedras: j.magicStoneSlotCount || 0,
    casasDivinas: j.godStoneSlotCount || 0,
    origens: j.sources || [],
    aparencias: j.costumes || [],
  };
}

/** Um tabuleiro inteiro de um personagem. */
async function tabuleiro(ref, idTabuleiro, opts) {
  const j = await getJSON(`${NC}/api/character/daevanion/detail${qs({ ...base(ref, opts), boardId: idTabuleiro })}`);
  if (!j || !Array.isArray(j.nodeList)) throw new Error('A NC não devolveu o tabuleiro');
  return {
    id: idTabuleiro,
    nos: j.nodeList
      .filter((n) => n.type !== 'None')
      .map((n) => ({ id: n.nodeId, linha: n.row, coluna: n.col, tipo: n.type, grau: n.grade, nome: n.name || '', efeitos: descricoes(n.effectList), aberto: n.open === 1 })),
  };
}

/**
 * Os tabuleiros de uma classe, sem o que é do personagem que serviu de molde.
 * Usa o personagem de nível mais alto que a pesquisa encontrar: é quem tem a
 * certeza de ter a lista de tabuleiros toda.
 */
async function tabuleirosDaClasse(classe, opts = {}) {
  const achados = (await procurarPersonagens('e', { ...opts, pcIds: classe.pcIds, tamanho: 30 })).sort((a, b) => b.nivel - a.nivel);
  for (const c of achados.slice(0, 3)) {
    let f;
    try {
      f = await ficha(c, opts);
    } catch {
      continue;
    }
    if (!f.tabuleiros.length) continue;
    const out = [];
    for (const t of f.tabuleiros) {
      const d = await tabuleiro(c, t.id, opts);
      out.push({ id: t.id, nome: t.nome, icone: t.icone, nos: d.nos.map(({ aberto, ...resto }) => resto) });
    }
    return out;
  }
  throw new Error(`não encontrei nenhum ${classe.texto} para ler os tabuleiros`);
}

module.exports = { ficha, item, itemEquipado, tabuleiro, tabuleirosDaClasse, limparItem };
