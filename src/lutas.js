'use strict';

// As lutas do medidor de DPS (src/medidor.js), em userData/lutas.json:
// { versao: 1, lutas: [...] }, as 500 mais recentes. Um ficheiro estragado ou de
// outra versão não rebenta a app nem se perde: fica ao lado como .mau.

const fs = require('fs');
const crypto = require('crypto');

const VERSAO = 1;
const MAXIMO = 500;

class Lutas {
  constructor(ficheiro) {
    this.ficheiro = ficheiro;
    this.lutas = [];
    let txt;
    try {
      txt = fs.readFileSync(ficheiro, 'utf8');
    } catch {
      return; // ainda não há
    }
    try {
      const d = JSON.parse(txt);
      if (d.versao !== VERSAO || !Array.isArray(d.lutas)) throw new Error('versão ' + d.versao);
      this.lutas = d.lutas;
    } catch {
      try {
        fs.renameSync(ficheiro, ficheiro + '.mau');
      } catch {
        /* sem permissão: fica como está */
      }
    }
  }

  /** Mais recente primeiro; só as do personagem, se for dado. */
  todas(personagem) {
    const l = personagem ? this.lutas.filter((x) => x.personagem === personagem) : this.lutas;
    return [...l].sort((a, b) => (a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : 0));
  }

  /** Grava uma luta acabada (de Luta.ler/fechar); curtas ou sem dano → null. */
  adicionar(feita, { personagem = null } = {}) {
    if (!feita || feita.duracao < 5 || !feita.total) return null;
    const luta = { id: crypto.randomUUID(), personagem, build: null, ...feita };
    this.lutas.push(luta);
    if (this.lutas.length > MAXIMO) {
      this.lutas.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
      this.lutas.splice(0, this.lutas.length - MAXIMO);
    }
    this.gravar();
    return this.lutas.includes(luta) ? luta : null; // mais antiga do que as 500: não ficou
  }

  /** Só o alvo (o OCR pode errar o nome) e a etiqueta da build mudam à mão. */
  mudar(id, { alvo, build } = {}) {
    const l = this.lutas.find((x) => x.id === id);
    if (!l) return null;
    if (alvo !== undefined) l.alvo = alvo ? String(alvo).trim() || null : null;
    if (build !== undefined) l.build = build ? String(build).trim() || null : null;
    this.gravar();
    return l;
  }

  apagar(id) {
    const i = this.lutas.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.lutas.splice(i, 1);
    this.gravar();
    return true;
  }

  gravar() {
    const tmp = this.ficheiro + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ versao: VERSAO, lutas: this.lutas }));
    fs.renameSync(tmp, this.ficheiro);
  }
}

module.exports = { Lutas, MAXIMO };
