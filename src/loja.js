'use strict';

// Os preços da loja (NPC) que a app já viu nos cartões dos itens, guardados pelo
// nome. A Mochila não tem cartões abertos — só ícones — e é daqui que sabe quanto
// a loja dá por um item que já passou pela faixa uma vez.
//
// E a conta de onde vender: o mercado só vale a pena se o que se recebe DEPOIS
// da taxa bater a loja por uma margem (10%): pôr à venda dá trabalho, demora, e
// pode não vender; a loja paga logo.

const fs = require('fs');
const path = require('path');
const { normalizar } = require('./cartoes');
const P = require('./pricing');

const MARGEM = 1.1;

class Loja {
  constructor(dir) {
    this.ficheiro = path.join(dir, 'precos-loja.json');
    try {
      this.mapa = JSON.parse(fs.readFileSync(this.ficheiro, 'utf8'));
    } catch {
      this.mapa = {};
    }
  }

  aprender(nome, unidade) {
    const k = normalizar(nome);
    if (!k || !Number.isFinite(unidade)) return;
    const atual = this.mapa[k];
    if (atual && atual.unidade === unidade) return; // nada de novo: não se reescreve o ficheiro
    this.mapa[k] = { nome: String(nome).trim(), unidade, quando: Date.now() };
    fs.mkdirSync(path.dirname(this.ficheiro), { recursive: true });
    fs.writeFileSync(this.ficheiro + '.part', JSON.stringify(this.mapa));
    fs.renameSync(this.ficheiro + '.part', this.ficheiro);
  }

  /** Preço por unidade; um nome cortado ("…(Vincu") encontra o inteiro. */
  de(nome, cortado = false) {
    const k = normalizar(nome);
    if (this.mapa[k]) return this.mapa[k].unidade;
    if (cortado) {
      const c = Object.keys(this.mapa).find((x) => x.startsWith(k));
      if (c) return this.mapa[c].unidade;
    }
    return null;
  }
}

/**
 * Onde vender uma unidade: { onde: 'mercado'|'loja', mercado, loja, frase }.
 * `mercado` é o valor de anúncio (antes da taxa); a conta usa o que se recebe.
 */
function ondeVender(mercado, loja) {
  if (loja == null) return null;
  if (mercado == null) return { onde: 'loja', mercado: null, loja, frase: `a loja paga ${P.formatarKinah(loja)}` };
  const recebes = P.liquido(mercado);
  if (recebes > loja * MARGEM) {
    return { onde: 'mercado', mercado: recebes, loja, frase: `vende no mercado: recebes ${P.formatarKinah(recebes)}, a loja só dá ${P.formatarKinah(loja)}` };
  }
  return { onde: 'loja', mercado: recebes, loja, frase: `vende à loja: dá ${P.formatarKinah(loja)}, o mercado ${P.formatarKinah(recebes)} depois da taxa` };
}

module.exports = { Loja, ondeVender, MARGEM };
