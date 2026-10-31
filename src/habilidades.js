'use strict';

// As habilidades de cada classe, e as de um personagem, pela web oficial da NC.
//
// Não há catálogo de habilidades no Global. O que há é a ficha de um personagem
// (`/api/character/equipment`), que traz a lista INTEIRA da classe — também as
// que ainda não aprendeu: um Gladiador de nível 1 e um de nível 45 trazem as
// mesmas 35 (12 ativas, 10 passivas, 13 estigmas), verificado a 10 Out 2026.
// Por isso o catálogo de uma classe é: procurar um personagem qualquer dessa
// classe e ler-lhe a ficha. Os nomes vêm no idioma pedido; os ícones são os
// mesmos para todos.
//
// Categorias da NC: "Active", "Passive" e "Dp" (os estigmas, que gastam DP).
// Na ficha, `skillLevel` é o nível que o personagem tem (0 = não aprendida) e
// `equip` só quer dizer alguma coisa nos estigmas (as ativas vêm todas a 1).

const { getJSON } = require('./http');

const NC = 'https://aion2.plaync.com';
const PESQUISA = 'https://api-search.plaync.com/aion2global/search/v2/character';

/** Os cinco fragmentos do Global, como a NC lhes chama no parâmetro `region`. */
const REGIOES = { eu: 'Europa', nae: 'América do Norte (Este)', naw: 'América do Norte (Oeste)', la: 'América Latina', as: 'Ásia' };

const CATEGORIAS = ['Active', 'Dp', 'Passive'];

function qs(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return '?' + p.toString();
}

function semEtiquetas(s) {
  // A pesquisa realça o que bateu: "<strong>A</strong>na".
  return String(s || '').replace(/<[^>]*>/g, '');
}

/**
 * As oito classes: { nome (o interno, em inglês), texto (no idioma), pcIds }.
 * `pcIds` são as quatro combinações de raça e género, que é o que a pesquisa filtra.
 */
async function classes(idioma = 'pt-BR', regiao = 'eu') {
  const base = `${NC}/${idioma.toLowerCase()}/api/gameinfo`;
  const [c, p] = await Promise.all([
    getJSON(`${base}/classes${qs({ lang: idioma, region: regiao })}`),
    getJSON(`${base}/pcdata${qs({ lang: idioma, region: regiao })}`),
  ]);
  if (!c || !Array.isArray(c.classList) || !p || !Array.isArray(p.pcDataList)) {
    throw new Error('NC: a lista de classes mudou de forma');
  }
  return c.classList.map((x) => ({
    id: x.id,
    nome: x.name,
    texto: x.text || x.name,
    // "Gladiator" ↔ "GLADIATOR"; o Espiritualista é "Elementalist" nos dois lados.
    pcIds: p.pcDataList.filter((d) => String(d.className).toUpperCase() === String(x.name).toUpperCase()).map((d) => d.id),
  }));
}

/** Procura personagens pelo nome num fragmento; as duas raças, uma de cada vez (a NC não aceita as duas juntas). */
async function procurarPersonagens(nome, { regiao = 'eu', idioma = 'pt-BR', pcIds = null, tamanho = 20 } = {}) {
  const achados = [];
  for (const raca of [1, 2]) {
    const j = await getJSON(
      PESQUISA + qs({ keyword: nome, page: 1, size: tamanho, race: raca, region: regiao, localeInfo: idioma, pcId: pcIds ? pcIds.join(',') : '' }),
    );
    for (const r of (j && j.list) || []) {
      achados.push({
        personagem: decodeURIComponent(r.characterId),
        servidor: r.serverId,
        servidorNome: r.serverName,
        nome: semEtiquetas(r.name),
        nivel: r.level,
        raca: r.race,
        pcId: r.pcId,
      });
    }
  }
  return achados;
}

function limparHabilidade(s) {
  return {
    id: s.id,
    nome: s.name,
    categoria: s.category,
    icone: s.icon || null,
    nivelNecessario: s.needLevel || 0,
    nivel: s.skillLevel || 0,
    aprendida: s.acquired === 1,
    equipada: s.equip === 1,
  };
}

/** As habilidades de um personagem, tal como a ficha oficial as dá. */
async function habilidadesDoPersonagem({ servidor, personagem }, { idioma = 'pt-BR', regiao = 'eu' } = {}) {
  // A NC às vezes responde sem as habilidades (null) e à seguinte já as traz: tenta-se algumas vezes.
  let lista = null;
  for (let i = 0; i < 6 && !Array.isArray(lista); i++) {
    if (i) await new Promise((r) => setTimeout(r, 800));
    const j = await getJSON(`${NC}/api/character/equipment${qs({ lang: idioma, region: regiao, serverId: servidor, characterId: personagem })}`);
    lista = j && j.skill && j.skill.skillList;
  }
  if (!Array.isArray(lista)) throw new Error('NC: a ficha do personagem não trouxe habilidades');
  return lista.map(limparHabilidade);
}

/**
 * O catálogo de uma classe: as habilidades de um personagem qualquer dela, sem
 * o que é desse personagem (nível, aprendida, equipada). Tenta alguns, porque
 * um personagem apagado responde 200 com a lista vazia.
 */
async function habilidadesDaClasse(classe, { idioma = 'pt-BR', regiao = 'eu' } = {}) {
  if (!classe || !classe.pcIds || !classe.pcIds.length) throw new Error('classe sem pcIds');
  const candidatos = await procurarPersonagens('a', { regiao, idioma, pcIds: classe.pcIds, tamanho: 5 });
  for (const c of candidatos.slice(0, 4)) {
    let lista;
    try {
      lista = await habilidadesDoPersonagem(c, { idioma, regiao });
    } catch {
      continue;
    }
    if (lista.length) {
      return lista
        .map(({ id, nome, categoria, icone, nivelNecessario }) => ({ id, nome, categoria, icone, nivelNecessario }))
        .sort((a, b) => CATEGORIAS.indexOf(a.categoria) - CATEGORIAS.indexOf(b.categoria));
    }
  }
  throw new Error(`não encontrei nenhum ${classe.texto} para ler as habilidades`);
}

module.exports = { REGIOES, CATEGORIAS, classes, procurarPersonagens, habilidadesDoPersonagem, habilidadesDaClasse, semEtiquetas };
