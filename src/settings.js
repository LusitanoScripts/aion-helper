'use strict';

const fs = require('fs');
const path = require('path');

const OMISSAO = {
  servidor: null, // null = o que o aion2.exchange diz ser o por omissão
  pin: true,
  automatico: true, // faixa por baixo do cartão sem atalho
  idioma: 'pt-BR', // o idioma do cliente do jogo (nomes e OCR)
  referencias: [], // servidores de reserva marcados; vazio = o maior da mesma fação
  regiaoNC: 'eu', // o fragmento do Global onde procurar personagens (aba Builds)
  temporizadores: null, // região, acertos, cargas escritas e avisos (aba Temporizadores)
  mascotes: null, // { atual, personagens: { nome: { id: { tem, nivel, almas } } } } (aba Mascotes)
  planosDaevanion: [], // [{ id, nome, classe, daevanion: { idTabuleiro: [nós] }, atualizado }] (aba Daevanion)
  mascotesNoJogo: null, // { alvo, almas, zonas } — aviso do alvo e almas do chat (src/olho-mascotes.js)
  recolha: null, // { som, mPorPx, ajuste } — modo recolha (src/radar.js); mPorPx acertado pela dica do jogo
  cubos: null, // { ligado, som } — vigia dos Hidden Cubes no ecrã (src/cubo.js)
  medidor: null, // { ligado } — medidor de DPS pela janela Análise de combate (src/medidor.js)
  dicasMissoes: false, // o Assistente lê as missões do canto e dá dicas quando mudam
  gemini: null, // { chave, modelo } do Assistente — a chave nunca vai para o renderer
  limites: null, // { x, y, width, height } da janela
};

class Definicoes {
  constructor(dir) {
    this.ficheiro = path.join(dir, 'definicoes.json');
    try {
      this.valores = { ...OMISSAO, ...JSON.parse(fs.readFileSync(this.ficheiro, 'utf8')) };
    } catch {
      this.valores = { ...OMISSAO };
    }
  }

  todas() {
    return { ...this.valores };
  }

  mudar(alteracao) {
    for (const k of Object.keys(alteracao || {})) {
      if (k in OMISSAO) this.valores[k] = alteracao[k];
    }
    fs.mkdirSync(path.dirname(this.ficheiro), { recursive: true });
    fs.writeFileSync(this.ficheiro + '.part', JSON.stringify(this.valores, null, 2));
    fs.renameSync(this.ficheiro + '.part', this.ficheiro);
    return this.todas();
  }
}

module.exports = { Definicoes, OMISSAO };
