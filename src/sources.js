'use strict';

// As duas origens de dados, e a junção entre elas.
//
//  aion2.exchange/api — preços do mercado por servidor. Aberto, sem token.
//    Mantido por uma pessoa só; a recolha a montante falha às vezes
//    (6 Out: "HTTP 500, error code 7513" durante horas). Daí a cache servir
//    dados velhos com aviso em vez de deixar a app vazia.
//
//  aion2.plaync.com/<lang>/api/gameconst/item — a ficha oficial de um item:
//    nome no idioma pedido, ícone, se é transacionável. Não é documentada nem
//    tem catálogo no Global (só item a item, pelo id). Um id desconhecido
//    responde 200 com tudo a zero.
//
// O que as liga é o id do item: o `item_key` do exchange é o mesmo `id` da NC
// (516530001 = "Amplify Stone (Unique)" = "Pedra de Superação (Única)").
// Nunca juntar pelo nome — o exchange está em inglês e o jogo em português.

const { getJSON } = require('./http');

const EXCHANGE = 'https://aion2.exchange/api';
const NC = 'https://aion2.plaync.com';

/** O português do Global é o do Brasil; é o que o cliente em português mostra. */
const IDIOMA = 'pt-BR';

/**
 * Os idiomas do cliente Global e a etiqueta que a NC quer (verificado a 6 Out:
 * a mesma Pedra de Superação vem como "Amplify Stone (Unique)", "Zenitstein
 * (Einzigartig)", "Piedra de superación (único)", "Pierre de percée (unique)",
 * "突破石(唯一)").
 */
const IDIOMAS = {
  'pt-BR': 'Português',
  'en-US': 'English',
  'de-DE': 'Deutsch',
  'es-ES': 'Español',
  'fr-FR': 'Français',
  'ja-JP': '日本語',
};

const PAGINA = 200; // o máximo que a API aceita (le=200)

function qs(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
}

// ── aion2.exchange ──────────────────────────────────────────────────────────

async function servidores() {
  const j = await getJSON(`${EXCHANGE}/servers`);
  if (!j || !Array.isArray(j.servers)) throw new Error('aion2.exchange: /servers sem lista de servidores');
  return {
    omissao: j.default,
    servidores: j.servers.map((s) => ({
      id: s.server_id,
      nome: s.name,
      regiao: s.region,
      regiaoNome: s.region_name,
      facao: s.faction,
      temDados: !!s.has_data,
    })),
  };
}

/** Todas as linhas de um servidor, página a página. */
async function itensDoServidor(servidor, { janela = '24h' } = {}) {
  const linhas = [];
  for (let offset = 0; ; offset += PAGINA) {
    const j = await getJSON(`${EXCHANGE}/items${qs({ server: servidor, limit: PAGINA, offset, window: janela })}`);
    if (!j || !Array.isArray(j.items)) throw new Error('aion2.exchange: /items sem lista');
    linhas.push(...j.items);
    if (j.items.length < PAGINA || linhas.length >= j.total) break;
  }
  return linhas.map(limparLinha);
}

function limparLinha(i) {
  return {
    id: i.item_key,
    nomeEN: i.name,
    categoria: i.category ? i.category.name : null,
    seccao: i.category ? i.category.section_id : null,
    seccaoNome: i.category ? i.category.section_name : null,
    price: i.price,
    listings: i.listings,
    change_pct: i.change_pct,
    captured_at: i.captured_at,
    units_sold: i.units_sold,
    sold_avg_price: i.sold_avg_price,
    sold_min_price: i.sold_min_price,
    sold_max_price: i.sold_max_price,
  };
}

/** Quantos itens e anúncios tem o mercado de um servidor (o /overview). */
async function tamanho(servidor) {
  const j = await getJSON(`${EXCHANGE}/overview${qs({ server: servidor })}`);
  return { itens: (j && j.items) || 0, anuncios: (j && j.total_listings) || 0 };
}

async function saude() {
  return getJSON(`${EXCHANGE}/health`);
}

async function historico(id, servidor) {
  const j = await getJSON(`${EXCHANGE}/items/${encodeURIComponent(id)}/prices${qs({ server: servidor })}`);
  return Array.isArray(j && j.points) ? j.points : [];
}

/**
 * Quanto custa comprar `unidades` agora (o exchange simula com 50). Em cada ponto:
 * `cost`/`unit_avg` são para exatamente essas 50; `cost_stacks`/`units_stacks` para
 * os lotes inteiros que é preciso levar para lá chegar (não se compra meio lote).
 */
async function profundidade(id, servidor) {
  const j = await getJSON(`${EXCHANGE}/items/${encodeURIComponent(id)}/depth${qs({ server: servidor })}`);
  return { unidades: (j && j.units) || null, pontos: Array.isArray(j && j.points) ? j.points : [] };
}

// ── NC: ficha oficial do item ───────────────────────────────────────────────

async function fichaNC(id, idioma = IDIOMA) {
  const url = `${NC}/${idioma.toLowerCase()}/api/gameconst/item${qs({ lang: idioma, id, enchantLevel: 0 })}`;
  const j = await getJSON(url, { intervaloMs: 200 });
  if (!j || !j.id) return null; // id desconhecido: 200 com tudo a zero
  return {
    id: j.id,
    nome: j.name || null,
    grau: j.grade || null,
    grauNome: j.gradeName || null,
    categoria: j.categoryName || null,
    icone: j.icon || null,
    transacionavel: j.tradable !== false,
    nivel: j.equipLevel || null,
  };
}

module.exports = {
  EXCHANGE,
  NC,
  IDIOMA,
  IDIOMAS,
  servidores,
  itensDoServidor,
  saude,
  tamanho,
  historico,
  profundidade,
  fichaNC,
  limparLinha,
};
