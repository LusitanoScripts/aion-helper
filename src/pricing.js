// Contas puras sobre os preços do aion2.exchange. Não toca em rede nem em disco.
//
// O que se mediu e manda nestas regras (6 Out 2026, 98 servidores):
//  · O `price` de uma linha é o ANÚNCIO MAIS BARATO, não um preço de venda.
//  · `sold_avg_price` (o preço a que as coisas se venderam de facto) só existe
//    em 1 servidor de 98 — o Kaisinel (EU, Elyos). Nos outros 97 é null.
//  · Onde existe, o anúncio mais barato fica entre 0,62× (p10) e 3,0× (p90) do
//    vendido; 15 de 143 itens pediam mais do triplo. Há anúncios-armadilha:
//    "Forgotten Pauldrons" a 10 000 005 quando a véspera estava a 1111.
//  · ~1 item em cada 5 tem 2 anúncios ou menos.
// Logo: nunca mostrar o anúncio mais barato como "o valor" sem dizer o que é,
// e o valor de referência sai do histórico (mediana), que um anúncio isolado
// não consegue arrastar.
//
// Serve o Node (require) e o renderer (<script> clássico → window.Precos). Tudo
// fica dentro da função: os scripts clássicos partilham um só âmbito global, e
// um `const` solto no topo colide com outro ficheiro e mata-o em silêncio.

(function (raiz) {
'use strict';

/** Taxa do mercado sobre cada venda (guias da comunidade; a NC não publica a tabela). */
const TAXA_MERCADO = 0.08;

/** Abaixo disto, um anúncio sozinho não diz nada do valor do item. */
const POUCOS_ANUNCIOS = 2;

/** Subidas em 24 h a partir das quais o anúncio é tratado como suspeito. */
const SUBIDA_SUSPEITA_PCT = 200;

/** Quantas vezes acima do preço vendido um anúncio deixa de ser credível. */
const ACIMA_DO_VENDIDO = 3;

function numero(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * O melhor preço que se pode afirmar a partir de uma linha da lista, e de onde vem.
 * base: 'vendido' — média das vendas reais (só onde a origem a tem)
 *       'pedido'  — o anúncio mais barato neste momento
 *       null      — não há nada
 */
function precoDaLinha(linha) {
  const vendido = numero(linha.sold_avg_price);
  if (vendido && vendido > 0) return { valor: vendido, base: 'vendido' };
  const pedido = numero(linha.price);
  if (pedido && pedido > 0) return { valor: pedido, base: 'pedido' };
  return { valor: null, base: null };
}

/** Razões para não confiar no anúncio mais barato. Lista vazia = nada a apontar. */
function avisos(linha) {
  const out = [];
  const pedido = numero(linha.price);
  const vendido = numero(linha.sold_avg_price);
  const n = numero(linha.listings);
  const chg = numero(linha.change_pct);
  if (n !== null && n <= POUCOS_ANUNCIOS) out.push(n === 1 ? 'só 1 anúncio' : `só ${n} anúncios`);
  if (chg !== null && chg >= SUBIDA_SUSPEITA_PCT) out.push(`subiu ${formatarPct(chg)} desde ontem`);
  if (pedido && vendido && pedido > vendido * ACIMA_DO_VENDIDO) {
    out.push(`pede ${(pedido / vendido).toFixed(1).replace('.', ',')}× o que se vende`);
  }
  return out;
}

function mediana(valores) {
  const v = valores.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Preço de referência a partir das velas horárias de /items/{id}/prices.
 * Usa o `close` de cada hora (o anúncio mais barato no fim dela) e tira a mediana
 * das últimas `horas`. Com menos de 3 horas com dados não afirma nada: com 1 ou 2
 * pontos a "mediana" é só o anúncio do momento com outro nome.
 */
function referenciaDoHistorico(pontos, { horas = 72, agora = Date.now() } = {}) {
  const desde = agora - horas * 3600e3;
  const recentes = (pontos || []).filter((p) => Date.parse(p.ts) >= desde && numero(p.close) > 0);
  if (recentes.length < 3) return { valor: null, horas: recentes.length };
  return {
    valor: mediana(recentes.map((p) => p.close)),
    min: Math.min(...recentes.map((p) => p.low ?? p.close)),
    max: Math.max(...recentes.map((p) => p.high ?? p.close)),
    horas: recentes.length,
  };
}

/** O que fica na mão depois da taxa do mercado. */
function liquido(valor) {
  return valor == null ? null : Math.floor(valor * (1 - TAXA_MERCADO));
}

/**
 * Kinah no formato que o próprio jogo usa no inventário: "14,4K", "381,3K", "1,2M".
 * Abaixo de 10 000 mostra o número inteiro com espaço de milhares.
 */
function formatarKinah(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const um = (x) => (Math.floor(x * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '');
  if (abs >= 1e9) return um(v / 1e9) + 'B';
  if (abs >= 1e6) return um(v / 1e6) + 'M';
  if (abs >= 1e4) return um(v / 1e3) + 'K';
  return Math.round(v).toLocaleString('pt-PT').replace(/ | /g, ' ');
}

function formatarPct(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  const abs = Math.abs(p);
  const txt = abs >= 1000 ? Math.round(abs).toLocaleString('pt-PT').replace(/ | /g, ' ') : abs.toFixed(abs >= 10 ? 0 : 1).replace('.', ',');
  // O sinal sai do número já arredondado: −0,03% escrevia-se "−0,0%".
  if (/^0(,0)?$/.test(txt)) return '0%';
  return (p > 0 ? '+' : '−') + txt + '%';
}

const api = {
  TAXA_MERCADO,
  precoDaLinha,
  avisos,
  mediana,
  referenciaDoHistorico,
  liquido,
  formatarKinah,
  formatarPct,
};

if (typeof module === 'object' && module.exports) module.exports = api;
else raiz.Precos = api;
})(typeof self !== 'undefined' ? self : this);
