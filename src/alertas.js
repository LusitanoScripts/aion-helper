'use strict';

// Alertas de preço: "avisa-me quando X estiver a Y ou menos no servidor Z".
//
// Verifica-se ao ritmo a que o aion2.exchange recolhe (15 min) e compara-se com o
// anúncio mais barato — é o que se pode comprar já. Cada descida avisa uma vez:
// volta a avisar só se o preço descer ainda mais, ou se passar acima do limite e
// voltar a cair. Sem isto, um item a 35K com alerta a 40K notificava de 15 em 15
// minutos o dia todo.

const fs = require('fs');
const path = require('path');

class Alertas {
  constructor(dir) {
    this.ficheiro = path.join(dir, 'alertas.json');
    try {
      this.lista = JSON.parse(fs.readFileSync(this.ficheiro, 'utf8'));
    } catch {
      this.lista = [];
    }
  }

  gravar() {
    fs.mkdirSync(path.dirname(this.ficheiro), { recursive: true });
    fs.writeFileSync(this.ficheiro + '.part', JSON.stringify(this.lista, null, 1));
    fs.renameSync(this.ficheiro + '.part', this.ficheiro);
  }

  todos() {
    return this.lista.slice();
  }

  /** Um alerta por item e servidor: definir outra vez muda o limite. */
  definir({ itemId, nome, servidor, nomeServidor, limite }) {
    const i = this.lista.findIndex((a) => a.itemId === itemId && a.servidor === servidor);
    const novo = { itemId, nome, servidor, nomeServidor, limite: Number(limite), avisado: null, criado: Date.now() };
    if (i >= 0) this.lista[i] = { ...this.lista[i], ...novo, criado: this.lista[i].criado };
    else this.lista.push(novo);
    this.gravar();
    return this.todos();
  }

  apagar(itemId, servidor) {
    this.lista = this.lista.filter((a) => !(a.itemId === itemId && a.servidor === servidor));
    this.gravar();
    return this.todos();
  }

  /**
   * Compara com os preços atuais e devolve os avisos a dar.
   * @param precos (servidor) => Map(itemId → anúncio mais barato) | null
   */
  verificar(precos) {
    const avisos = [];
    let mudou = false;
    for (const a of this.lista) {
      const p = precos(a.servidor);
      if (!p) continue;
      const atual = p.get(a.itemId);
      if (atual == null || atual > a.limite) {
        // Acima do limite (ou sem anúncios): rearma, para a próxima descida avisar.
        if (a.avisado != null) {
          a.avisado = null;
          mudou = true;
        }
        continue;
      }
      if (a.avisado == null || atual < a.avisado) {
        avisos.push({ ...a, atual });
        a.avisado = atual;
        mudou = true;
      }
    }
    if (mudou) this.gravar();
    return avisos;
  }
}

module.exports = { Alertas };
