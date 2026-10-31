'use strict';

// Medidor de DPS pelo ecrã: lê a janela oficial "Análise de combate" (Ctrl+X no
// jogo) — o jogo já mede o dano do jogador, só não guarda nada. Aqui só há
// contas: números e tempos como o jogo os escreve, e a máquina que corta as
// leituras (1 por segundo) em lutas. Nada de rede nem de memória do jogo: o dano
// dos outros membros do grupo não aparece no ecrã e fica de fora.
// Partilhado entre o Node (main) e o renderer (window.Medidor), como o pricing.js.

(function (raiz) {
  const SUFIXO = { k: 1e3, m: 1e6, b: 1e9 };

  /** "79,72K" → 79720, "1.42M" → 1420000, "1.234,5K" → 1234500, "35,49%" → 35.49; lixo → null. */
  function numero(txt) {
    const m = String(txt || '').replace(/\s/g, '').match(/^([\d.,]*\d)([kmb%])?$/i);
    if (!m) return null;
    let n = m[1];
    // O último separador seguido de 1–2 algarismos é a casa decimal; os outros são milhares.
    const d = n.match(/[.,](\d{1,2})$/);
    if (d) n = n.slice(0, -d[0].length).replace(/[.,]/g, '') + '.' + d[1];
    else n = n.replace(/[.,]/g, '');
    const v = Number(n) * (SUFIXO[(m[2] || '').toLowerCase()] || 1);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  }

  /** "00:40" → 40, "1:02:03" → 3723, "0040" (OCR sem os dois pontos) → 40; lixo → null. */
  function tempo(txt) {
    const s = String(txt || '').trim();
    let partes;
    if (/^\d{1,2}(:\d{2}){1,2}$/.test(s)) partes = s.split(':').map(Number);
    else if (/^\d{4}$/.test(s)) partes = [Number(s.slice(0, 2)), Number(s.slice(2))];
    else return null;
    return partes.reduce((a, p) => a * 60 + p, 0);
  }

  /** De [[segundo, total], ...] (a começar em [0,0]): duração, DPS médio e o maior DPS em 5 s. */
  function resumo(curva) {
    if (!curva.length) return { duracao: 0, dps: 0, picoDps: 0 };
    const [s0, t0] = curva[0];
    const [s1, t1] = curva[curva.length - 1];
    const duracao = s1 - s0;
    const dps = duracao > 0 ? Math.round((t1 - t0) / duracao) : 0;
    let pico = 0;
    for (let i = 0; i < curva.length; i++) {
      const j = curva.findIndex(([s]) => s >= curva[i][0] + 5);
      if (j < 0) break;
      pico = Math.max(pico, (curva[j][1] - curva[i][1]) / (curva[j][0] - curva[i][0]));
    }
    return { duracao, dps, picoDps: Math.round(pico) || dps };
  }

  const PARADO_MS = 5000; // total sem mexer este tempo = luta acabada
  const MINIMO_S = 5; // lutas mais curtas não contam
  const SALTO_MAX = 50; // salto maior que 50× a mediana = OCR leu mal

  const mediana = (v) => {
    const o = [...v].sort((a, b) => a - b);
    return o[Math.floor(o.length / 2)];
  };

  /**
   * Corta as leituras da janela em lutas. ler(leitura|null, t) a cada volta, com
   * leitura = { alvo, tempo, total, dps, habilidades } (de lerJanela) ou null se a
   * janela não estiver à vista. Devolve { estado, terminou }, com terminou =
   * { alvo, inicio, duracao, total, dps, picoDps, curva, habilidades } quando uma
   * luta acaba (e dura pelo menos 5 s).
   *
   * O OCR falha: uma leitura sem janela, um nome mal lido ou um número absurdo
   * não podem partir nem prender a luta. Por isso só o tempo parado (5 s sem o
   * total subir) fecha uma luta por falta de leituras, o alvo só conta como novo
   * à 2.ª leitura seguida, e 3 descidas seguidas decidem entre "o último valor
   * era lixo" (as descidas ficam acima do ponto anterior) e "o jogo recomeçou".
   */
  class Luta {
    constructor() {
      this.atual = null;
      this.ultima = null; // { alvo, total } da última luta, para não a reabrir com a janela parada
      this.visto = null; // { alvo, total } da leitura anterior com total
    }

    get estado() {
      return this.atual ? 'a decorrer' : 'parada';
    }

    /** O que se mostra ao vivo: alvo, total e DPS da luta em curso. */
    get aoVivo() {
      const a = this.atual;
      if (!a) return null;
      const s = a.pontos[a.pontos.length - 1][0];
      const total = a.total - a.base;
      return { alvo: a.alvo, total, dps: s > 0 ? Math.round(total / s) : 0, duracao: s };
    }

    ler(leitura, t = Date.now()) {
      if (!leitura) {
        const terminou = this.parado(t) ? this.fechar() : null;
        return { estado: this.estado, terminou };
      }
      let terminou = null;
      const { alvo, total } = leitura;
      const visto = this.visto;
      if (total != null) this.visto = { alvo, total };
      const a = this.atual;
      if (a && alvo && a.alvo && alvo !== a.alvo) {
        // Alvo novo só à 2.ª leitura seguida com o mesmo nome (o OCR troca letras).
        a.outroN = a.outro === alvo ? a.outroN + 1 : 1;
        a.outro = alvo;
        if (a.outroN < 2) return { estado: this.estado, terminou: null };
        terminou = this.fechar();
      } else if (a) a.outro = null;

      if (this.atual) {
        const a = this.atual;
        if (leitura.tempo === 0 || total === 0) return { estado: 'parada', terminou: this.fechar() };
        if (total != null && total > a.total) {
          const salto = total - a.total;
          if (!(a.saltos.length >= 3 && salto > SALTO_MAX * mediana(a.saltos))) this.aceitar(a, leitura, t);
          a.descidas = 0;
        } else if (total != null && total < a.total && ++a.descidas >= 3) {
          a.descidas = 0;
          const antes = a.pontos.length >= 2 ? a.pontos[a.pontos.length - 2] : null;
          if (antes && total >= antes[1]) {
            // O último ponto era lixo: tira-se e segue com esta leitura.
            a.pontos.pop();
            a.saltos.pop();
            a.total = antes[1];
            if (total > a.total) this.aceitar(a, leitura, t);
          } else terminou = this.fechar(); // o jogo recomeçou sem se ler o 00:00
        }
        if (this.atual && this.parado(t)) terminou = this.fechar();
        if (this.atual || total == null || total === this.ultima.total) return { estado: this.estado, terminou };
      }

      // Só abre quando se viu o total mudar: a 1.ª leitura (app a arrancar com a
      // janela parada no resultado da luta anterior) é só o ponto de partida.
      if (total > 0 && leitura.tempo !== 0 && (this.ultima || visto) && !this.atual) {
        const u = this.ultima;
        const mesmo = u && (!alvo || !u.alvo || u.alvo === alvo);
        const igual = (x) => x && x.total === total && (!alvo || !x.alvo || x.alvo === alvo);
        if (!igual(u) && !igual(visto)) this.abrir(leitura, t, mesmo && total > u.total ? u.total : 0);
      }
      return { estado: this.estado, terminou };
    }

    parado(t) {
      return !!this.atual && t - this.atual.mudou >= PARADO_MS;
    }

    // base: o total do jogo que já não é desta luta (a anterior, no mesmo alvo,
    // sem o jogo ter recomeçado). Relógio: o do jogo se o OCR o lê e a luta
    // começa do zero dele; senão o nosso. Sem relógio do jogo nem luta anterior,
    // a 1.ª leitura é a base: o dano de antes de a app ver não entra no DPS.
    abrir(leitura, t, base) {
      const jogo = base === 0 && leitura.tempo > 0;
      const a = { alvo: leitura.alvo || null, inicio: t, mudou: t, base, total: leitura.total, saltos: [], descidas: 0, outro: null, outroN: 0, habilidades: leitura.habilidades || null };
      a.relogio = jogo ? 'jogo' : 'nosso';
      if (jogo) a.pontos = [[leitura.tempo, leitura.total]];
      else if (base > 0) {
        a.t0 = t - 1000; // esta leitura já traz dano novo
        a.pontos = [[1, leitura.total]];
      } else {
        a.base = leitura.total;
        a.t0 = t;
        a.pontos = [[0, leitura.total]];
      }
      a.ultimoT = t;
      this.atual = a;
    }

    aceitar(a, leitura, t) {
      const [sAnt] = a.pontos[a.pontos.length - 1];
      let s;
      if (a.relogio === 'jogo') s = leitura.tempo > 0 ? leitura.tempo : sAnt + Math.max(1, Math.round((t - a.ultimoT) / 1000));
      else s = Math.round((t - a.t0) / 1000);
      a.saltos.push(leitura.total - a.total);
      a.total = leitura.total;
      a.mudou = t;
      a.ultimoT = t;
      // A curva nunca anda para trás: no mesmo segundo fica o total mais recente.
      if (s <= sAnt) a.pontos[a.pontos.length - 1][1] = leitura.total;
      else a.pontos.push([s, leitura.total]);
      if (leitura.habilidades) a.habilidades = leitura.habilidades;
      if (leitura.alvo && !a.alvo) a.alvo = leitura.alvo;
    }

    /** Acaba a luta em curso (janela fechada, app a sair); null se não havia ou era curta. */
    fechar() {
      const a = this.atual;
      this.atual = null;
      if (!a) return null;
      this.ultima = { alvo: a.alvo, total: a.total };
      const curva = a.pontos.map(([s, v]) => [s, v - a.base]);
      if (curva[0][0] > 0) curva.unshift([0, 0]);
      const r = resumo(curva);
      const total = a.total - a.base;
      if (r.duracao < MINIMO_S || total <= 0) return null;
      return {
        alvo: a.alvo,
        inicio: new Date(a.inicio).toISOString(),
        duracao: r.duracao,
        total,
        dps: r.dps,
        picoDps: r.picoDps,
        curva,
        habilidades: a.habilidades,
      };
    }
  }

  // A janela, modo simples (cliente EN a 1440p, capturas de 31 Out):
  //   Combat Analy...                      (título, cortado pelo jogo)
  //   Metric: Divine Auldor        03:04   (só durante/depois de uma luta)
  //   Total Damage         1.66M (9.05K)   (total e, entre parênteses, o DPS)
  // Antes da luta não há linha "Metric" e o OCR não lê o "0 (0)". O modo
  // detalhado (habilidades) ainda não foi visto: habilidades fica null.
  const TITULO = /combat\s*anal|an[áa]lise\s*de\s*comb|an[áa]lisis\s*de\s*comb|kampfanal|analyse\s*de\s*comb/i;
  const ROTULO_TOTAL = /total\s*damage|dano\s*total|danos?\s*totale?s?|da[ñn]o\s*total|gesamtschaden|d[ée]g[âa]ts?\s*totaux/i;
  const ROTULO_ALVO = /^\s*(?:metric|medi[çc][ãa]o|m[ée]trica|medici[óo]n|messung|mesure)\s*[:;.]?\s*/i;
  const HORA = /\b(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
  const VALORES = /([\d.,]*\d\s*[kmb]?)\s*(?:\(\s*([\d.,]*\d\s*[kmb]?)\s*\)?)?/i;

  const altura = (l) => l.y2 - l.y1;
  const centro = (l) => (l.y1 + l.y2) / 2;
  // O que está na mesma fila, à direita de uma linha (o valor vem noutra caixa do OCR).
  const aDireita = (linhas, l) =>
    linhas
      .filter((o) => o !== l && o.x1 >= l.x2 - 2 && Math.abs(centro(o) - centro(l)) < altura(l) * 0.6)
      .sort((a, b) => a.x1 - b.x1);

  /** Retângulo [x,y,w,h] (px do ecrã) da janela "Análise de combate" nas linhas de OCR, ou null. */
  function acharJanela(linhas) {
    const t = (linhas || []).find((l) => TITULO.test(l.t));
    if (!t) return null;
    // Medido a 1440p: título com 18 px de altura; a janela vai ~1 h para a esquerda,
    // ~21 h para a direita e ~9 h para baixo. Folga para a lupa do jogo e o modo detalhado.
    const h = Math.max(8, altura(t));
    const x = Math.max(0, Math.round(t.x1 - 1.5 * h));
    const y = Math.max(0, Math.round(t.y1 - 1.5 * h));
    return [x, y, Math.round(25 * h), Math.round(13 * h)];
  }

  /** { alvo, tempo, total, dps, habilidades } lido das linhas de OCR da janela, ou null sem ela. */
  function lerJanela(linhas) {
    linhas = linhas || [];
    const rotulo = linhas.find((l) => ROTULO_TOTAL.test(l.t));
    if (!rotulo) return null;
    const r = { alvo: null, tempo: null, total: null, dps: null, habilidades: null };

    const resto = rotulo.t.replace(ROTULO_TOTAL, '');
    const txtValor = [resto, ...aDireita(linhas, rotulo).map((l) => l.t)].join(' ').trim();
    const v = txtValor.match(VALORES);
    if (v) {
      r.total = numero(v[1]);
      r.dps = v[2] ? numero(v[2]) : null;
    }

    // A linha do alvo fica por cima do total (perto); o tempo vem à direita ou colado.
    const linhaAlvo = linhas.find((l) => ROTULO_ALVO.test(l.t) && l.y2 <= rotulo.y1 + 2 && rotulo.y1 - l.y2 < altura(rotulo) * 4);
    if (linhaAlvo) {
      let alvo = linhaAlvo.t.replace(ROTULO_ALVO, '');
      const hora = alvo.match(HORA);
      if (hora) {
        r.tempo = tempo(hora[1]);
        alvo = alvo.slice(0, hora.index);
      } else {
        const h = aDireita(linhas, linhaAlvo).find((l) => tempo(l.t.trim()) != null);
        if (h) r.tempo = tempo(h.t.trim());
      }
      r.alvo = alvo.trim() || null;
    }
    return r;
  }

  const api = { numero, tempo, resumo, Luta, acharJanela, lerJanela, PARADO_MS, MINIMO_S };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Medidor = api;
})(typeof self !== 'undefined' ? self : this);
