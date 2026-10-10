'use strict';

// Nomes em português (e ícones) pelo id, guardados num só ficheiro.
//
// A NC não tem catálogo no Global: é um pedido por item. Para ~550 itens de um
// servidor são ~2 minutos à primeira vez, por isso:
//   · o que já se sabe fica guardado 30 dias (os nomes não mudam entre patches
//     normais; uma falha guarda-se só 1 dia, para tentar outra vez);
//   · a lista aparece logo em inglês e vai passando a português à medida que
//     os nomes chegam — esperar 2 minutos por uma tabela vazia é o mesmo que
//     a app não funcionar.

const sources = require('./sources');

const OK_MS = 30 * 24 * 3600e3;
const FALHA_MS = 24 * 3600e3;

class Nomes {
  constructor(cache, idioma = sources.IDIOMA) {
    this.cache = cache;
    this.idioma = idioma;
    const guardado = cache.ler('nomes-' + idioma);
    this.mapa = (guardado && guardado.dados) || {};
    this.aDecorrer = null;
  }

  /** { id: ficha } só com os que se conhecem e estão dentro do prazo. */
  conhecidos(ids) {
    const out = {};
    const agora = Date.now();
    for (const id of ids) {
      const e = this.mapa[id];
      if (e && e.ficha && agora - e.quando < OK_MS) out[id] = e.ficha;
    }
    return out;
  }

  /** Todas as fichas conhecidas, de qualquer servidor visitado: { id: ficha }. */
  todosConhecidos() {
    return this.conhecidos(Object.keys(this.mapa));
  }

  emFalta(ids) {
    const agora = Date.now();
    return ids.filter((id) => {
      const e = this.mapa[id];
      if (!e) return true;
      return agora - e.quando > (e.ficha ? OK_MS : FALHA_MS);
    });
  }

  /**
   * Vai buscar os que faltam, um de cada vez. `aoChegar(lote)` recebe { id: ficha }
   * de 25 em 25 — chamar a cada item fazia a tabela redesenhar-se 550 vezes.
   * Uma só corrida de cada vez: pedir outra devolve a que já está em curso.
   */
  completar(ids, aoChegar) {
    if (this.aDecorrer) return this.aDecorrer;
    const falta = this.emFalta(ids);
    this.aDecorrer = (async () => {
      let lote = {};
      let n = 0;
      let falhas = 0;
      let sucessos = 0;
      for (const id of falta) {
        try {
          const ficha = await sources.fichaNC(id, this.idioma);
          this.mapa[id] = { ficha, quando: Date.now() };
          if (ficha) lote[id] = ficha;
          sucessos++;
        } catch (e) {
          falhas++;
          this.mapa[id] = { ficha: null, quando: Date.now() };
          // Três falhas sem nenhuma resposta boa = a NC está em baixo ou a recusar; parar.
          if (falhas >= 3 && sucessos === 0) break;
        }
        n++;
        if (n % 25 === 0) {
          this.cache.gravar('nomes-' + this.idioma, this.mapa);
          if (aoChegar) aoChegar(lote, { feitos: n, total: falta.length });
          lote = {};
        }
      }
      this.cache.gravar('nomes-' + this.idioma, this.mapa);
      if (aoChegar) aoChegar(lote, { feitos: n, total: falta.length, fim: true });
      return { pedidos: n, falhas };
    })().finally(() => {
      this.aDecorrer = null;
    });
    return this.aDecorrer;
  }
}

module.exports = { Nomes };
