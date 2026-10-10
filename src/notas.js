'use strict';

// Notas por item, guardadas num ficheiro. A chave é o NOME normalizado e não o
// id: o cartão de um item vinculado ("Botas do Caos") não tem id nenhum que se
// conheça — não está no mercado —, e é precisamente aí que uma nota mais falta faz.

const fs = require('fs');
const path = require('path');
const { normalizar } = require('./cartoes');

class Notas {
  constructor(dir) {
    this.ficheiro = path.join(dir, 'notas.json');
    try {
      this.mapa = JSON.parse(fs.readFileSync(this.ficheiro, 'utf8'));
    } catch {
      this.mapa = {};
    }
  }

  /** A nota de um nome; um nome cortado ("…(Vincu") encontra a do nome inteiro. */
  de(nome, cortado = false) {
    const k = normalizar(nome);
    if (this.mapa[k]) return this.mapa[k];
    if (cortado) {
      const chave = Object.keys(this.mapa).find((c) => c.startsWith(k));
      if (chave) return this.mapa[chave];
    }
    return null;
  }

  /** Texto vazio apaga. Guarda o nome como estava escrito, para a lista mostrar bem. */
  escrever(nome, texto) {
    const k = normalizar(nome);
    if (!k) return this.todas();
    const t = String(texto || '').trim();
    if (t) this.mapa[k] = { nome: String(nome).trim(), texto: t, quando: Date.now() };
    else delete this.mapa[k];
    fs.mkdirSync(path.dirname(this.ficheiro), { recursive: true });
    fs.writeFileSync(this.ficheiro + '.part', JSON.stringify(this.mapa, null, 2));
    fs.renameSync(this.ficheiro + '.part', this.ficheiro);
    return this.todas();
  }

  todas() {
    return Object.values(this.mapa).sort((a, b) => b.quando - a.quando);
  }
}

module.exports = { Notas };
