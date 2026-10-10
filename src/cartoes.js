'use strict';

// Encontrar os cartões de item que o jogo abre ao passar o rato, a partir das
// linhas que o OCR leu, e dizer que item é cada um.
//
// Medido nas capturas do utilizador (2560×1440, 6 Out 2026):
//  · A linha logo abaixo do nome começa SEMPRE pela raridade ("Raro Botas",
//    "Comum Pergaminho"), alinhada à esquerda com o nome. É isso que distingue
//    um cartão de qualquer outro texto no ecrã.
//  · O rodapé do cartão é uma faixa de 65–68 linhas da mesma cor (24,27,34),
//    entre uma linha clara de separação e a borda. O fundo do cartão é onde essa
//    faixa acaba — pelo texto não dá: logo abaixo há nomes de jogadores.
//  · O nome pode vir cortado pelo jogo: "Pergaminho de Bendição (Vincu...".
//  · Na versão em português do Global, "Legend" chama-se "Épico".

const I = require('./imagem');

// A raridade nos idiomas do Global, normalizada (sem acentos, minúsculas).
const RARIDADES = [
  // pt-BR
  'comum', 'raro', 'epico', 'unico', 'lendario', 'mitico', 'especial', 'heroico', 'eterno', 'antigo',
  // en
  'common', 'rare', 'epic', 'unique', 'legendary', 'mythic', 'special', 'heroic', 'eternal', 'ancient',
  // de
  'gewohnlich', 'selten', 'episch', 'einzigartig', 'legendar', 'mythisch', 'speziell', 'heroisch', 'ewig', 'uralt',
  // es
  'comun', 'legendario', 'mitico',
  // fr
  'commun', 'epique', 'legendaire', 'mythique', 'special', 'heroique', 'eternel', 'ancien',
];
const COR_RODAPE = [24, 27, 34];
const LARGURA_CARTAO = 470; // medido: 48 → 518, com a coluna de botões
const MIN_RODAPE = 40;

/**
 * A escala da interface, pela largura do rodapé: 469 px a 1440p. As medidas do
 * cartão (onde está o nome, o tamanho da letra, onde está o preço da loja) são
 * de 1440p e multiplicam-se por isto noutras resoluções.
 */
function escalaDoRodape(r) {
  return (r.direita - r.esquerda + 1) / 469;
}

function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function eCorRodape(img, x, y) {
  const d = (y * img.largura + x) * 4;
  return (
    Math.abs(img.px[d] - COR_RODAPE[0]) <= 4 &&
    Math.abs(img.px[d + 1] - COR_RODAPE[1]) <= 4 &&
    Math.abs(img.px[d + 2] - COR_RODAPE[2]) <= 4
  );
}

/** Fundo do cartão: fim da primeira faixa de rodapé (40+ linhas da cor) abaixo do nome. */
function fundoDoCartao(img, x, yIni) {
  if (x < 0 || x >= img.largura) return null;
  let run = 0;
  for (let y = Math.max(0, yIni); y < img.altura; y++) {
    if (eCorRodape(img, x, y)) run++;
    else {
      if (run >= MIN_RODAPE) return y;
      run = 0;
    }
  }
  return run >= MIN_RODAPE ? img.altura : null;
}

/**
 * Os rodapés de cartão no ecrã, só pelos píxeis: faixas de 300+ px de largura e
 * 40+ linhas da cor (24,27,34). Devolve [{ esquerda, direita, topo, fundo }].
 * Não depende do OCR — é o que encontra o cartão de um item Comum, cuja linha da
 * raridade (cinzento sobre cinzento) o OCR não lê.
 */
function encontrarRodapes(img) {
  const MIN_LARG = 300;
  const corridas = []; // por linha: [x0, x1] das corridas largas
  for (let y = 0; y < img.altura; y++) {
    const lin = [];
    let x0 = -1;
    for (let x = 0; x <= img.largura; x++) {
      const e = x < img.largura && eCorRodape(img, x, y);
      if (e && x0 < 0) x0 = x;
      if (!e && x0 >= 0) {
        if (x - x0 >= MIN_LARG) lin.push([x0, x - 1]);
        x0 = -1;
      }
    }
    corridas.push(lin);
  }
  // Junta linhas com corridas que começam no mesmo sítio (±3 px). O texto e os
  // ícones do rodapé cortam a cor a meio, por isso aceitam-se buracos de até 30
  // linhas: conta a altura total da faixa (40+) e haver 12+ linhas limpas.
  const BURACO = 30;
  const abertas = [];
  const feitas = [];
  const fecha = (a) => {
    if (a.fundo - a.topo >= MIN_RODAPE && a.limpas >= 12) feitas.push(a);
  };
  for (let y = 0; y < img.altura; y++) {
    const usadas = new Set();
    for (const a of abertas) {
      const i = corridas[y].findIndex((c, k) => !usadas.has(k) && Math.abs(c[0] - a.esquerda) <= 3);
      if (i >= 0) {
        usadas.add(i);
        a.fundo = y + 1;
        a.limpas++;
        a.direita = Math.max(a.direita, corridas[y][i][1]);
      }
    }
    for (const a of abertas.splice(0)) {
      if (y - a.fundo > BURACO) fecha(a);
      else abertas.push(a);
    }
    corridas[y].forEach((c, k) => {
      if (!usadas.has(k)) abertas.push({ esquerda: c[0], direita: c[1], topo: y, fundo: y + 1, limpas: 1 });
    });
  }
  for (const a of abertas) fecha(a);
  return feitas.map(({ esquerda, direita, topo, fundo }) => ({ esquerda, direita, topo, fundo }));
}

/**
 * @param linhas [{ x1, y1, x2, y2, t }] do OCR
 * @returns [{ nome, cortado, raridade, tipo, x, y, largura, fundo }] em píxeis da imagem
 *
 * Primeiro os rodapés (pelos píxeis); para cada um, o nome é a linha de letra
 * grande (18+ px) encostada à borda esquerda do cartão (+20 px), a mais acima.
 * A linha da raridade, quando o OCR a lê, só acrescenta informação.
 */
function encontrarCartoes(img, linhas) {
  const out = [];
  for (const r of encontrarRodapes(img)) {
    const k = escalaDoRodape(r);
    const candidatos = linhas
      .filter(
        (l) =>
          Math.abs(l.x1 - (r.esquerda + 21 * k)) <= 10 * k &&
          l.y2 < r.topo &&
          r.topo - l.y1 < 800 &&
          l.y2 - l.y1 >= 16 * k &&
          /[A-Za-zÀ-ÿ]{3}/.test(l.t),
      )
      .sort((a, b) => a.y1 - b.y1);
    const L = candidatos[0];
    if (!L) continue;
    const M = linhas.find((m) => m !== L && Math.abs(m.x1 - L.x1) <= 8 && m.y1 > L.y2 && m.y1 - L.y2 < 30);
    const rar = M && RARIDADES.includes(normalizar(M.t).split(' ')[0]) ? M : null;
    const bruto = L.t.trim();
    out.push({
      nome: bruto.replace(/\s*(\.\.\.|…)$/, ''),
      cortado: /(\.\.\.|…)$/.test(bruto),
      raridade: rar ? rar.t.split(' ')[0] : null,
      tipo: rar ? rar.t.split(' ').slice(1).join(' ') || null : null,
      x: r.esquerda,
      y: Math.max(0, L.y1 - 14),
      largura: Math.max(Math.round(LARGURA_CARTAO * k), r.direita - r.esquerda + 1),
      fundo: r.fundo,
      fundoPelaCor: true,
      loja: precoLoja(linhas, r),
    });
  }
  // Se o rodapé não se vir (tapado, cortado pela margem do ecrã), vale a regra antiga.
  for (const c of encontrarPelaRaridade(img, linhas)) {
    if (!out.some((o) => Math.abs(o.x - c.x) < 30)) out.push(c);
  }
  return out.sort((a, b) => a.x - b.x);
}

/** A regra original: nome seguido da linha da raridade. Fica para quando o rodapé não se vê. */
function encontrarPelaRaridade(img, linhas) {
  const out = [];
  for (const L of linhas) {
    const M = linhas.find(
      (m) => m !== L && Math.abs(m.x1 - L.x1) <= 8 && m.y1 > L.y2 && m.y1 - L.y2 < 30,
    );
    if (!M) continue;
    const [primeira, ...resto] = normalizar(M.t).split(' ');
    if (!RARIDADES.includes(primeira)) continue;
    const bruto = L.t.trim();
    const cortado = /(\.\.\.|…)$/.test(bruto);
    const nome = bruto.replace(/\s*(\.\.\.|…)$/, '');
    // A coluna do meio do rodapé não tem ícones (estão à esquerda) nem o preço (à direita).
    const fundo = fundoDoCartao(img, L.x1 + 200, L.y2 + 100);
    out.push({
      nome,
      cortado,
      raridade: M.t.split(' ')[0],
      tipo: M.t.split(' ').slice(1).join(' ') || null,
      x: Math.max(0, L.x1 - 20),
      y: Math.max(0, L.y1 - 14),
      largura: LARGURA_CARTAO,
      fundo: fundo != null ? fundo : Math.max(...linhas.filter((l) => l.x1 >= L.x1 - 20 && l.x1 <= L.x1 + 440 && l.y1 >= L.y1 && l.y1 - L.y1 < 700).map((l) => l.y2)) + 15,
      fundoPelaCor: fundo != null,
      _ignorar: resto,
    });
  }
  return out.map(({ _ignorar, ...c }) => c);
}

/**
 * Quanto a loja (NPC) paga pelo item: o número no canto inferior direito do
 * rodapé, ao lado da moeda. Medido: "92" nas botas e nos elmos, "10(680)" num
 * pergaminho em pilha — 10 cada, 680 a pilha toda. O OCR às vezes cola um
 * apóstrofo no fim (é a moeda): "10(680)'".
 * Os outros números do cartão (atributos) estão acima do rodapé e não contam.
 * Devolve { unidade, total } ou null.
 */
function precoLoja(linhas, rodape) {
  const n = (s) => Number(String(s).replace(/[.,\s]/g, ''));
  for (const l of linhas) {
    if (l.y1 < rodape.topo - 2 || l.y2 > rodape.fundo + 2) continue;
    if (l.x1 < rodape.esquerda + 250 * escalaDoRodape(rodape)) continue;
    const m = /^(\d[\d.,]*)(?:\((\d[\d.,]*)\))?\W?$/.exec(l.t.trim());
    if (!m) continue;
    const unidade = n(m[1]);
    if (!Number.isFinite(unidade)) continue;
    return { unidade, total: m[2] ? n(m[2]) : unidade };
  }
  return null;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/**
 * Que item é, pelo nome lido. `itens` = [{ id, nome }] (nomes em português da NC).
 *  · exato: o nome normalizado é igual;
 *  · prefixo: o jogo cortou o nome ("…(Vincu...") — todos os que começam assim;
 *  · aproximado: o OCR trocou uma ou duas letras (semelhança ≥ 0,9).
 * Devolve { ids, como } ou null. Um nome que não está na lista não se força.
 */
function casarNome(nome, cortado, itens) {
  const n = normalizar(nome);
  if (!n) return null;
  const exatos = itens.filter((i) => normalizar(i.nome) === n);
  if (exatos.length) return { ids: exatos.map((i) => i.id), como: 'exato' };
  if (cortado) {
    const pref = itens.filter((i) => normalizar(i.nome).startsWith(n));
    if (pref.length) return { ids: pref.map((i) => i.id), como: 'prefixo' };
  }
  let melhor = null;
  for (const i of itens) {
    const m = normalizar(i.nome);
    if (Math.abs(m.length - n.length) > 3) continue;
    const sem = 1 - levenshtein(m, n) / Math.max(m.length, n.length);
    if (sem >= 0.9 && (!melhor || sem > melhor.sem)) melhor = { sem, ids: [i.id] };
  }
  return melhor ? { ids: melhor.ids, como: 'aproximado' } : null;
}

module.exports = { escalaDoRodape, encontrarCartoes, encontrarRodapes, precoLoja, casarNome, normalizar, fundoDoCartao, LARGURA_CARTAO, RARIDADES };
