// Regras do tabuleiro Daevanion, sem rede nem disco.
//
// Um nó abre-se se for vizinho (cima, baixo, lados) de um nó aberto; o início
// ("Start") está sempre aberto. Verificado nos tabuleiros da NC: todos os nós se
// ligam ao início assim.
//
// Serve o Node (require) e o renderer (<script> clássico → window.Daevanion).
// Tudo dentro da função, pela mesma razão do pricing.js.

(function (raiz) {
  'use strict';

  /** Os nós que se podem abrir: vizinhos (cima, baixo, lados) de um nó aberto. O início está sempre aberto. */
  function abriveis(nos, abertos) {
    const pos = new Map(nos.map((n) => [`${n.linha},${n.coluna}`, n]));
    const set = new Set(abertos);
    for (const n of nos) if (n.tipo === 'Start') set.add(n.id);
    const out = new Set();
    for (const n of nos) {
      if (!set.has(n.id)) continue;
      for (const [dl, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const m = pos.get(`${n.linha + dl},${n.coluna + dc}`);
        if (m && !set.has(m.id)) out.add(m.id);
      }
    }
    return out;
  }

  /**
   * Fechar um nó fecha também os que ficavam sem ligação ao início — como no jogo,
   * não há nós soltos. Devolve a lista de abertos que sobra.
   */
  function fechar(nos, abertos, id) {
    const pos = new Map(nos.map((n) => [`${n.linha},${n.coluna}`, n]));
    const set = new Set(abertos);
    set.delete(id);
    const inicio = nos.find((n) => n.tipo === 'Start');
    if (!inicio) return [...set];
    const ligados = new Set([inicio.id]);
    const fila = [inicio];
    while (fila.length) {
      const n = fila.pop();
      for (const [dl, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const m = pos.get(`${n.linha + dl},${n.coluna + dc}`);
        if (m && set.has(m.id) && !ligados.has(m.id)) {
          ligados.add(m.id);
          fila.push(m);
        }
      }
    }
    return [...set].filter((x) => ligados.has(x));
  }

  /**
   * Soma os efeitos dos nós abertos: "Ataque +5" e "Ataque +10" dão "Ataque +15".
   * O que não tiver a forma "nome +número[%]" fica como está, contado.
   */
  function somarEfeitos(nos, abertos) {
    const set = new Set(abertos);
    const soma = new Map();
    for (const n of nos) {
      if (!set.has(n.id)) continue;
      for (const e of n.efeitos) {
        const m = /^(.*?)\s*([+-])\s*([\d.,]+)\s*(%?)$/.exec(e);
        if (!m) {
          const k = e;
          soma.set(k, { nome: e, valor: null, unidade: '', vezes: ((soma.get(k) || {}).vezes || 0) + 1 });
          continue;
        }
        const k = m[1] + '|' + m[4];
        const v = Number(m[3].replace(',', '.')) * (m[2] === '-' ? -1 : 1);
        const a = soma.get(k) || { nome: m[1], valor: 0, unidade: m[4], vezes: 0, habilidade: n.tipo === 'SkillLevel' };
        a.valor = Math.round((a.valor + v) * 100) / 100;
        a.vezes++;
        soma.set(k, a);
      }
    }
    return [...soma.values()];
  }


  const api = { abriveis, fechar, somarEfeitos };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Daevanion = api;
})(typeof self !== 'undefined' ? self : this);
