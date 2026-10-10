'use strict';

// As builds de habilidades: guardadas num ficheiro, e partilhadas por um código
// de texto que se cola no Discord.
//
// Uma build guarda só ids de habilidades. Nomes e ícones vêm do catálogo da
// classe (src/habilidades.js), no idioma de quem a abre: um código feito com o
// jogo em português abre em inglês com os nomes em inglês.
//
// Tudo o que entra (do ficheiro, do renderer ou de um código colado) passa por
// `limpar`, que deita fora o que não tem a forma certa em vez de confiar.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BARRAS = 4;
const CASAS = 12; // por barra, como no jogo
// Limites do editor. Nenhum dos dois está confirmado no jogo: o QuestLog mostra
// níveis até 16 e até 3 especializações. Folgados de propósito — um limite baixo
// demais impedia de escrever uma build verdadeira; um alto demais não estraga nada.
const NIVEL_MAX = 30;
const ESPEC_MAX = 5;
const MAX_BUILDS = 200;
const PREFIXO = 'AH1:';

const CATEGORIAS = ['Active', 'Dp', 'Passive'];

function texto(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function idValido(v) {
  return Number.isInteger(v) && v > 0 && v < 1e10;
}

function inteiro(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

function novaBuild(classe = 'Gladiator') {
  const agora = Date.now();
  return limpar({ id: crypto.randomUUID(), nome: 'Nova build', classe, criada: agora, mudada: agora });
}

/** Devolve uma build com a forma certa, ou null se nem classe tiver. */
function limpar(b) {
  if (!b || typeof b !== 'object') return null;
  const classe = texto(b.classe, 40);
  if (!/^[A-Za-z]+$/.test(classe)) return null;

  const niveis = {};
  for (const [k, v] of Object.entries(b.niveis && typeof b.niveis === 'object' ? b.niveis : {})) {
    const id = Number(k);
    if (!idValido(id) || !v || typeof v !== 'object') continue;
    niveis[id] = { nivel: inteiro(v.nivel, 1, NIVEL_MAX), espec: inteiro(v.espec, 0, ESPEC_MAX) };
  }

  const barra = Array.from({ length: BARRAS * CASAS }, (_, i) => {
    const v = Array.isArray(b.barra) ? b.barra[i] : null;
    return idValido(v) ? v : null;
  });

  const prioridade = {};
  for (const c of CATEGORIAS) {
    const l = b.prioridade && Array.isArray(b.prioridade[c]) ? b.prioridade[c] : [];
    prioridade[c] = l.filter(idValido).slice(0, 40);
  }

  // Daevanion: { idTabuleiro: [ids dos nós abertos] }.
  const daevanion = {};
  for (const [k, v] of Object.entries(b.daevanion && typeof b.daevanion === 'object' ? b.daevanion : {})) {
    const id = Number(k);
    if (!idValido(id) || !Array.isArray(v)) continue;
    const nos = [...new Set(v.filter(idValido))].slice(0, 400);
    if (nos.length) daevanion[id] = nos;
  }

  const macros = (Array.isArray(b.macros) ? b.macros : [])
    .filter((m) => m && typeof m === 'object')
    .slice(0, 30)
    .map((m) => ({ nome: texto(m.nome, 60), texto: texto(m.texto, 2000) }));

  return {
    id: typeof b.id === 'string' && /^[\w-]{8,64}$/.test(b.id) ? b.id : crypto.randomUUID(),
    nome: texto(b.nome, 80).trim() || 'Sem nome',
    classe,
    etiqueta: texto(b.etiqueta, 30),
    niveis,
    barra,
    prioridade,
    macros,
    daevanion,
    notas: texto(b.notas, 4000),
    criada: Number(b.criada) || Date.now(),
    mudada: Number(b.mudada) || Date.now(),
  };
}

/** O código de partilha: a build sem o que é só de quem a fez (id, datas). */
function exportar(b) {
  const { id, criada, mudada, ...resto } = limpar(b);
  // Casas vazias no fim não precisam de ir no código.
  let fim = resto.barra.length;
  while (fim && resto.barra[fim - 1] == null) fim--;
  resto.barra = resto.barra.slice(0, fim);
  return PREFIXO + Buffer.from(JSON.stringify(resto), 'utf8').toString('base64url');
}

/** Lê um código colado (aceita espaços e quebras de linha pelo meio, do Discord). */
function importar(codigo) {
  const s = String(codigo || '').replace(/\s+/g, '');
  if (!s.startsWith(PREFIXO)) throw new Error('Isto não é um código de build do Aion Helper (começa por AH1:).');
  let b;
  try {
    b = JSON.parse(Buffer.from(s.slice(PREFIXO.length), 'base64url').toString('utf8'));
  } catch {
    throw new Error('O código está partido — falta-lhe um bocado?');
  }
  const limpa = limpar({ ...b, id: undefined, criada: undefined, mudada: undefined });
  if (!limpa) throw new Error('O código não diz de que classe é a build.');
  return limpa;
}

class Builds {
  constructor(dir) {
    this.ficheiro = path.join(dir, 'builds.json');
    let lidas = [];
    try {
      lidas = JSON.parse(fs.readFileSync(this.ficheiro, 'utf8'));
    } catch {
      lidas = [];
    }
    this.lista = (Array.isArray(lidas) ? lidas : []).map(limpar).filter(Boolean);
  }

  todas() {
    return this.lista.map((b) => ({ ...b }));
  }

  gravar() {
    fs.mkdirSync(path.dirname(this.ficheiro), { recursive: true });
    fs.writeFileSync(this.ficheiro + '.part', JSON.stringify(this.lista, null, 1));
    fs.renameSync(this.ficheiro + '.part', this.ficheiro);
  }

  /** Cria ou substitui (pelo id). Devolve a build como ficou guardada. */
  guardar(b) {
    const limpa = limpar(b);
    if (!limpa) throw new Error('build sem classe');
    limpa.mudada = Date.now();
    const i = this.lista.findIndex((x) => x.id === limpa.id);
    if (i >= 0) this.lista[i] = limpa;
    else {
      if (this.lista.length >= MAX_BUILDS) throw new Error(`Já tens ${MAX_BUILDS} builds; apaga alguma primeiro.`);
      this.lista.push(limpa);
    }
    this.gravar();
    return { ...limpa };
  }

  apagar(id) {
    this.lista = this.lista.filter((b) => b.id !== id);
    this.gravar();
    return this.todas();
  }
}

module.exports = { Builds, novaBuild, limpar, exportar, importar, BARRAS, CASAS, NIVEL_MAX, ESPEC_MAX, CATEGORIAS };
