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

async function ficha(ref, opts) {
  const q = base(ref, opts);
  const [info, eq] = await Promise.all([getJSON(`${NC}/api/character/info${qs(q)}`), getJSON(`${NC}/api/character/equipment${qs(q)}`)]);
  if (!info || !info.profile || !info.profile.characterName) throw new Error('A NC não tem esse personagem (apagado ou mudou de nome?)');
  const p = info.profile;
  const stats = (info.stat && info.stat.statList) || [];
  // O nível de item vem como atributo, e com o nome por traduzir ("아이템레벨" em todos os idiomas, 10 Out 2026).
  const nivelItem = stats.find((s) => s.type === 'ItemLevel');
  const asa = eq && eq.petwing && eq.petwing.wing;
  const pet = eq && eq.petwing && eq.petwing.pet;
  return {
    ref: { servidor: ref.servidor, personagem: ref.personagem },
    perfil: {
      nome: p.characterName,
      nivel: p.characterLevel,
      classe: p.className,
      pcId: p.pcId,
      poder: p.combatPower,
      nivelItem: nivelItem ? nivelItem.value : null,
      raca: p.raceName,
      racaId: p.raceId,
      servidor: p.serverName,
      titulo: p.titleName || null,
      tituloGrau: p.titleGrade || null,
      retrato: /^https:\/\/profileimg\.plaync\.com\//.test(p.profileImage || '') ? p.profileImage : null,
    },
    atributos: stats.filter((s) => s.type !== 'ItemLevel').map((s) => ({ nome: s.name, tipo: s.type, valor: s.value, extra: s.statSecondList || [] })),
    titulos: {
      tem: (info.title && info.title.ownedCount) || 0,
      equipados: ((info.title && info.title.titleList) || []).map((t) => ({ id: t.id, nome: t.name, grau: t.grade, categoria: t.equipCategory, efeitos: descricoes(t.equipStatList), raridade: t.ownedPercent })),
    },
    tabuleiros: ((info.daevanion && info.daevanion.boardList) || []).map((b) => ({ id: b.id, nome: b.name, icone: b.icon, abertos: b.openNodeCount, total: b.totalNodeCount, aberto: b.open === 1 })),
    equipamento: ((eq && eq.equipment && eq.equipment.equipmentList) || []).map((x) => ({
      casa: x.slotPos,
      casaNome: x.slotPosName,
      id: x.id,
      nome: x.name,
      grau: x.grade,
      encantamento: x.enchantLevel || 0,
      superacao: x.exceedLevel || 0,
      icone: x.icon,
    })),
    asa: asa && asa.id ? { id: asa.id, nome: asa.name, grau: asa.grade, encantamento: asa.enchantLevel || 0, icone: asa.icon } : null,
    mascote: pet && pet.id ? { id: pet.id, nome: pet.name, nivel: pet.level, icone: pet.icon } : null,
    habilidades: ((eq && eq.skill && eq.skill.skillList) || []).map((s) => ({
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
  const j = await getJSON(`${NC}/${idioma.toLowerCase()}/api/gameconst/item${qs({ lang: idioma, id, enchantLevel: encantamento })}`, { intervaloMs: 200 });
  if (!j || !j.id) return null;
  return limparItem(j);
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
