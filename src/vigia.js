'use strict';

// O modo automático: vigiar o ecrã do jogo e pôr a faixa por baixo de cada
// cartão de item enquanto ele estiver aberto — sem atalho.
//
// O trabalho caro fica do lado do Windows (src/ocr.ps1, comando VER): copiar a
// janela do jogo e procurar rodapés de cartão em C#. Custa ~60–90 ms com o jogo
// à frente e ~10 ms sem ele (aí nem copia). O OCR só corre quando aparece um
// rodapé novo, e só na coluna desse cartão.
//
// Um cartão é identificado pelo sítio do rodapé (esquerda e fundo, ±6 px): o
// mesmo item aberto continua a ser o mesmo cartão; mudar de item move o rodapé.

const { precoLoja, escalaDoRodape } = require('./cartoes');

const MESMO = 6;

function chave(r) {
  return `${r.esquerda}:${r.fundo}`;
}

function igual(a, b) {
  return Math.abs(a.esquerda - b.esquerda) <= MESMO && Math.abs(a.fundo - b.fundo) <= MESMO;
}

/**
 * Do conjunto de rodapés visto agora e do que já se conhecia, o que é novo e o
 * que desapareceu. Pura — é o que o teste exercita.
 */
function diferencas(conhecidos, vistos) {
  const novos = vistos.filter((v) => !conhecidos.some((c) => igual(c, v)));
  const ficam = conhecidos.filter((c) => vistos.some((v) => igual(c, v)));
  const foram = conhecidos.filter((c) => !vistos.some((v) => igual(c, v)));
  return { novos, ficam, foram };
}

/** O nome é a linha de letra grande (16+ px) encostada à borda do cartão (+21), a mais acima. */
function nomeDoCartao(linhas, rodape) {
  const k = escalaDoRodape(rodape); // 1 a 1440p
  const c = linhas
    .filter(
      (l) =>
        Math.abs(l.x1 - (rodape.esquerda + 21 * k)) <= 10 * k &&
        l.y2 < rodape.topo &&
        l.y2 - l.y1 >= 16 * k &&
        /[A-Za-zÀ-ÿ]{3}/.test(l.t),
    )
    .sort((a, b) => a.y1 - b.y1)[0];
  if (!c) return null;
  const bruto = c.t.trim();
  return { nome: bruto.replace(/\s*(\.\.\.|…)$/, ''), cortado: /(\.\.\.|…)$/.test(bruto), topoNome: c.y1 };
}

class Vigia {
  /**
   * @param ocr      o src/ocr.js (ver, lerZona)
   * @param faixaDe  async (cartao) => faixa a mostrar
   * @param mostrar  (faixas) => void — lista vazia esconde
   */
  constructor({ ocr, faixaDe, mostrar, intervaloMs = 250, processo = 'AION2', aoErro = null }) {
    Object.assign(this, { ocr, faixaDe, mostrar, intervaloMs, processo, aoErro });
    this.ultimaLeitura = null; // { quando, rodape, linhas, nome } — para o diagnóstico
    this.cartoes = []; // { esquerda, direita, topo, fundo, faixa|null }
    // Rodapés onde o OCR não achou nome: não se relê a cada volta, mas tenta-se
    // outra vez ao fim de 1 s — o cartão aparece a desvanecer, e uma leitura a
    // meio da animação pode falhar num cartão que é bom.
    this.semNome = [];
    this.ligado = false;
    this.relogio = null;
  }

  ligar() {
    if (this.ligado) return;
    this.ligado = true;
    this.volta();
  }

  desligar() {
    this.ligado = false;
    clearTimeout(this.relogio);
    if (this.cartoes.length) {
      this.cartoes = [];
      this.mostrar([]);
    }
  }

  async volta() {
    if (!this.ligado) return;
    try {
      await this.passo();
    } catch (e) {
      // Uma volta falhada não pára a vigia (a seguinte tenta outra vez), mas fica registada.
      if (this.aoErro) this.aoErro(e);
    }
    if (this.ligado) this.relogio = setTimeout(() => this.volta(), this.intervaloMs);
  }

  async passo() {
    const v = await this.ocr.ver(this.processo);
    const vistos = v.jogo ? v.rodapes : [];
    const agora = Date.now();
    this.semNome = this.semNome.filter((s) => s.ate > agora && vistos.some((r) => igual(s, r)));
    const { novos, ficam, foram } = diferencas(this.cartoes, vistos);
    const aLer = novos.filter((r) => !this.semNome.some((s) => igual(s, r)));
    let mudou = foram.length > 0;
    this.cartoes = ficam;
    for (const r of aLer) {
      // A coluna do cartão, de 900 px acima do rodapé até ao fundo dele: o nome está
      // no topo e o preço da loja no canto do rodapé.
      const y0 = Math.max(v.janela ? v.janela[1] : 0, r.topo - 900);
      const linhas = await this.ocr.lerZona(r.esquerda, y0, r.direita - r.esquerda + 1, r.fundo - y0);
      const n = nomeDoCartao(linhas, r);
      this.ultimaLeitura = { quando: Date.now(), rodape: r, linhas, nome: n && n.nome };
      if (!n) {
        this.semNome.push({ ...r, ate: agora + 1000 });
        continue;
      }
      const faixa = await this.faixaDe({
        ...n,
        x: r.esquerda,
        largura: Math.max(Math.round(470 * escalaDoRodape(r)), r.direita - r.esquerda + 1),
        fundo: r.fundo,
        loja: precoLoja(linhas, r),
      });
      this.cartoes.push({ ...r, faixa });
      mudou = true;
    }
    if (mudou) this.mostrar(this.cartoes.map((c) => c.faixa).filter(Boolean));
  }
}

module.exports = { Vigia, diferencas, nomeDoCartao, chave };
