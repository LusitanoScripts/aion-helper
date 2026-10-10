'use strict';

// Contas do src/pricing.js. Os casos vêm dos dados reais de 6 Out 2026.

const assert = require('assert');
const P = require('../src/pricing');

let n = 0;
function t(nome, fn) {
  fn();
  n++;
  if (process.env.VERBOSE) console.log('  ✓', nome);
}

// ── formato do jogo ─────────────────────────────────────────────────────────
t('kinah como o inventário do jogo mostra', () => {
  // Valores das fotos do utilizador: "14,4K" e "381,3K".
  assert.strictEqual(P.formatarKinah(14450), '14,4K');
  assert.strictEqual(P.formatarKinah(381399), '381,3K');
  // Corta, não arredonda: 14 499 não pode aparecer como 14,5K.
  assert.strictEqual(P.formatarKinah(14499), '14,4K');
  assert.strictEqual(P.formatarKinah(10000005), '10M');
  assert.strictEqual(P.formatarKinah(1250000), '1,2M');
  assert.strictEqual(P.formatarKinah(59997), '59,9K');
  assert.strictEqual(P.formatarKinah(680), '680');
  assert.strictEqual(P.formatarKinah(null), '—');
  assert.strictEqual(P.formatarKinah(NaN), '—');
});

t('percentagens', () => {
  assert.strictEqual(P.formatarPct(0.2556), '+0,3%');
  assert.strictEqual(P.formatarPct(-15), '−15%');
  assert.strictEqual(P.formatarPct(899990.45), '+899 990%');
  assert.strictEqual(P.formatarPct(null), '—');
  // Real: a tabela mostrava "−0,0%".
  assert.strictEqual(P.formatarPct(-0.03), '0%');
  assert.strictEqual(P.formatarPct(0.04), '0%');
  assert.strictEqual(P.formatarPct(0), '0%');
});

// ── qual preço se afirma ───────────────────────────────────────────────────
t('preço vendido ganha ao anúncio quando existe', () => {
  const l = { price: 59997, sold_avg_price: 38886, listings: 52 };
  assert.deepStrictEqual(P.precoDaLinha(l), { valor: 38886, base: 'vendido' });
});

t('sem vendidos (97 de 98 servidores) cai para o anúncio e di-lo', () => {
  const l = { price: 35000, sold_avg_price: null, listings: 92 };
  assert.deepStrictEqual(P.precoDaLinha(l), { valor: 35000, base: 'pedido' });
});

t('sem nada não inventa', () => {
  assert.deepStrictEqual(P.precoDaLinha({ price: null }), { valor: null, base: null });
  assert.deepStrictEqual(P.precoDaLinha({ price: 0, sold_avg_price: 0 }), { valor: null, base: null });
});

// ── avisos ──────────────────────────────────────────────────────────────────
t('o anúncio-armadilha das Forgotten Pauldrons é apanhado', () => {
  // Real: 10 000 005 com 1 anúncio, véspera a 1111 (+899 990%).
  const a = P.avisos({ price: 10000005, listings: 1, change_pct: 899990.45 });
  assert.ok(a.includes('só 1 anúncio'));
  assert.ok(a.some((x) => x.startsWith('subiu')));
});

t('pedir mais do triplo do que se vende', () => {
  const a = P.avisos({ price: 120000, sold_avg_price: 38886, listings: 40, change_pct: 1 });
  assert.deepStrictEqual(a, ['pede 3,1× o que se vende']);
});

t('item normal não leva aviso', () => {
  assert.deepStrictEqual(P.avisos({ price: 59997, sold_avg_price: 38886, listings: 52, change_pct: 0.25 }), []);
});

t('descidas não são suspeitas', () => {
  assert.deepStrictEqual(P.avisos({ price: 35000, listings: 92, change_pct: -90 }), []);
});

// ── referência do histórico ─────────────────────────────────────────────────
const agora = Date.parse('2026-10-06T12:00:00Z');
const hora = (h, close, extra = {}) => ({ ts: new Date(agora - h * 3600e3).toISOString(), close, ...extra });

t('mediana resiste a um anúncio isolado', () => {
  const pts = [hora(5, 1000), hora(4, 1100), hora(3, 10000005), hora(2, 1050), hora(1, 990)];
  const r = P.referenciaDoHistorico(pts, { agora });
  assert.strictEqual(r.valor, 1050);
  assert.strictEqual(r.horas, 5);
});

t('com menos de 3 horas não afirma', () => {
  const r = P.referenciaDoHistorico([hora(2, 1000), hora(1, 1100)], { agora });
  assert.strictEqual(r.valor, null);
  assert.strictEqual(r.horas, 2);
});

t('ignora o que está fora da janela', () => {
  const pts = [hora(100, 999999), hora(3, 10), hora(2, 20), hora(1, 30)];
  assert.strictEqual(P.referenciaDoHistorico(pts, { agora, horas: 72 }).valor, 20);
});

t('min e max usam low/high quando vêm', () => {
  const pts = [hora(3, 100, { low: 80, high: 120 }), hora(2, 110), hora(1, 105, { low: 90, high: 200 })];
  const r = P.referenciaDoHistorico(pts, { agora });
  assert.strictEqual(r.min, 80);
  assert.strictEqual(r.max, 200);
});

t('mediana par', () => {
  assert.strictEqual(P.mediana([4, 1, 3, 2]), 2.5);
  assert.strictEqual(P.mediana([]), null);
});

// ── taxa ────────────────────────────────────────────────────────────────────
t('recebes = valor − 8%, arredondado para baixo', () => {
  assert.strictEqual(P.liquido(38886), 35775);
  assert.strictEqual(P.liquido(null), null);
});

console.log(`test-pricing: ${n} testes passaram`);
