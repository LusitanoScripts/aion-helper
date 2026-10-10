'use strict';

// Contra os dados reais (precisa de rede): as duas origens respondem com a forma
// que o código espera, e a junção pelo id funciona. Fora do `npm test` por isso.
//
//   npm run selftest              amostra de 40 itens para os nomes
//   npm run selftest -- --todos   todos os itens do servidor (≈2 min)

const assert = require('assert');
const sources = require('../src/sources');
const P = require('../src/pricing');

async function main() {
  const t0 = Date.now();
  const { omissao, servidores } = await sources.servidores();
  assert.ok(servidores.length > 50, `só ${servidores.length} servidores`);
  const porRegiao = {};
  for (const s of servidores) porRegiao[s.regiao] = (porRegiao[s.regiao] || 0) + 1;
  console.log(`servidores: ${servidores.length}`, porRegiao, `· por omissão ${omissao}`);

  const saude = await sources.saude();
  console.log(`última recolha do exchange: há ${Math.round(saude.snapshot_age_seconds / 60)} min`);

  const linhas = await sources.itensDoServidor(omissao);
  assert.ok(linhas.length > 100, `só ${linhas.length} itens`);
  assert.strictEqual(new Set(linhas.map((l) => l.id)).size, linhas.length, 'ids repetidos entre páginas');
  const comVendidos = linhas.filter((l) => l.sold_avg_price).length;
  const comAviso = linhas.filter((l) => P.avisos(l).length).length;
  console.log(`itens no servidor ${omissao}: ${linhas.length} · com preço vendido ${comVendidos} · com aviso ${comAviso}`);

  const todos = process.argv.includes('--todos');
  const amostra = todos ? linhas : linhas.filter((_, i) => i % Math.ceil(linhas.length / 40) === 0);
  let ok = 0;
  let semNome = 0;
  let naoTrans = 0;
  const hosts = new Set();
  const graus = {};
  const t1 = Date.now();
  for (const l of amostra) {
    const f = await sources.fichaNC(l.id);
    if (!f || !f.nome) {
      semNome++;
      console.log(`  sem ficha na NC: ${l.id} ${l.nomeEN}`);
      continue;
    }
    ok++;
    if (f.icone) hosts.add(new URL(f.icone).host);
    if (!f.transacionavel) naoTrans++;
    graus[f.grau] = (graus[f.grau] || 0) + 1;
  }
  const msPorItem = Math.round((Date.now() - t1) / amostra.length);
  console.log(`nomes PT: ${ok}/${amostra.length} (${Math.round((100 * ok) / amostra.length)}%) · ${msPorItem} ms por item`);
  console.log(`  ícones em: ${[...hosts].join(', ')} · graus: ${JSON.stringify(graus)} · não transacionáveis: ${naoTrans}`);
  assert.ok(ok / amostra.length > 0.9, 'menos de 90% dos itens com nome em português');
  assert.deepStrictEqual([...hosts], ['assets.playnccdn.com'], 'ícones noutro anfitrião — acrescentar ao CSP do index.html');

  // Itens no mercado que a NC diz não serem transacionáveis seria uma contradição.
  assert.strictEqual(naoTrans, 0, 'item no mercado marcado como não transacionável');

  const exemplo = linhas.find((l) => l.listings > 20) || linhas[0];
  const pontos = await sources.historico(exemplo.id, omissao);
  const ref = P.referenciaDoHistorico(pontos);
  const prof = await sources.profundidade(exemplo.id, omissao);
  console.log(`histórico de ${exemplo.nomeEN}: ${pontos.length} horas · referência 72 h ${P.formatarKinah(ref.valor)} · anúncio ${P.formatarKinah(exemplo.price)} · profundidade ${prof.pontos.length} pontos (${prof.unidades} un.)`);
  assert.ok(pontos.length > 0, 'histórico vazio');

  console.log(`selftest: tudo bem em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error('selftest FALHOU:', e.message);
  process.exit(1);
});
