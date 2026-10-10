'use strict';

// Cache em disco, um ficheiro JSON por chave, com idade máxima à leitura.
//
// A idade decide-se quando se lê e não quando se grava: os mesmos preços servem
// "frescos" para mostrar (15 min) e "aceitáveis" quando a origem está em baixo
// (qualquer idade, com aviso). Gravar um prazo fixo obrigava a escolher um dos dois.

const fs = require('fs');
const path = require('path');

class Cache {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  ficheiro(chave) {
    return path.join(this.dir, chave.replace(/[^a-z0-9._-]/gi, '_') + '.json');
  }

  /** Devolve { dados, idadeMs } ou null. Com maxIdadeMs, devolve null se for mais velho. */
  ler(chave, maxIdadeMs = Infinity) {
    try {
      const { gravado, dados } = JSON.parse(fs.readFileSync(this.ficheiro(chave), 'utf8'));
      const idadeMs = Date.now() - gravado;
      if (idadeMs > maxIdadeMs) return null;
      return { dados, idadeMs };
    } catch {
      return null;
    }
  }

  gravar(chave, dados) {
    const f = this.ficheiro(chave);
    // .part + rename: uma escrita interrompida nunca deixa um JSON partido no lugar do bom.
    fs.writeFileSync(f + '.part', JSON.stringify({ gravado: Date.now(), dados }));
    fs.renameSync(f + '.part', f);
  }
}

module.exports = { Cache };
