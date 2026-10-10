// Peças de interface usadas por mais de uma aba: a grelha de um tabuleiro
// Daevanion, a soma dos seus efeitos e o cartão com o detalhe de um item.
(function () {
  'use strict';

  const { esc } = window.U;

  const GRAU_COR = { Common: 'common', Rare: 'rare', Legend: 'legend', Unique: 'unique', Epic: 'epic', Special: 'special' };

  function icone(url) {
    return /^https:\/\/assets\.playnccdn\.com\//.test(url || '') ? url : '';
  }

  // ── Daevanion ─────────────────────────────────────────────────────────────

  /**
   * A grelha de um tabuleiro. `abertos` é a lista de ids abertos; com `editavel`,
   * os nós que se podem abrir ficam marcados e todos levam data-no para o clique.
   */
  function grelha(tab, abertos, { editavel = false } = {}) {
    const set = new Set(abertos);
    const podem = editavel ? window.Daevanion.abriveis(tab.nos, abertos) : new Set();
    const linhas = Math.max(...tab.nos.map((n) => n.linha));
    const colunas = Math.max(...tab.nos.map((n) => n.coluna));
    const minL = Math.min(...tab.nos.map((n) => n.linha));
    const minC = Math.min(...tab.nos.map((n) => n.coluna));
    const casas = tab.nos
      .map((n) => {
        const estado = n.tipo === 'Start' || set.has(n.id) ? 'aberto' : podem.has(n.id) ? 'pode' : 'fechado';
        const titulo = n.tipo === 'Start' ? 'Início' : `${n.nome}${n.efeitos.length ? '\n' + n.efeitos.join('\n') : ''}`;
        return `<div class="dv-no t-${esc(n.tipo)} g-${GRAU_COR[n.grau] || 'none'} ${estado}" data-no="${n.id}" title="${esc(titulo)}"
          style="grid-row:${n.linha - minL + 1};grid-column:${n.coluna - minC + 1}"></div>`;
      })
      .join('');
    return `<div class="dv-grelha${editavel ? ' editavel' : ''}" style="--linhas:${linhas - minL + 1};--colunas:${colunas - minC + 1}">${casas}</div>`;
  }

  /** A soma dos efeitos, separada em atributos e níveis de habilidade. */
  function resumo(tabs, abertosPorTab) {
    const nos = [];
    const abertos = [];
    let total = 0;
    let possiveis = 0;
    for (const t of tabs) {
      const a = abertosPorTab[t.id] || [];
      nos.push(...t.nos);
      abertos.push(...a);
      total += a.length;
      possiveis += t.nos.filter((n) => n.tipo !== 'Start').length;
    }
    const soma = window.Daevanion.somarEfeitos(nos, abertos);
    const fmt = (e) => (e.valor == null ? `${esc(e.nome)}${e.vezes > 1 ? ` ×${e.vezes}` : ''}` : `${esc(e.nome)} <b>${e.valor > 0 ? '+' : ''}${String(e.valor).replace('.', ',')}${e.unidade}</b>`);
    const hab = soma.filter((e) => e.habilidade).sort((a, b) => b.valor - a.valor);
    const atr = soma.filter((e) => !e.habilidade).sort((a, b) => a.nome.localeCompare(b.nome));
    return `<div class="dv-resumo">
      <div class="dv-conta"><b>${total}</b> de ${possiveis} nós abertos${tabs.length > 1 ? ` nos ${tabs.length} tabuleiros` : ''}</div>
      ${atr.length ? `<h4>Atributos</h4><ul>${atr.map((e) => `<li>${fmt(e)}</li>`).join('')}</ul>` : ''}
      ${hab.length ? `<h4>Níveis de habilidade</h4><ul>${hab.map((e) => `<li>${fmt(e)}</li>`).join('')}</ul>` : ''}
      ${!soma.length ? '<p class="dim">Nenhum nó aberto.</p>' : ''}
    </div>`;
  }

  // ── item ──────────────────────────────────────────────────────────────────

  function linhaAtributo(s) {
    const valor = s.minimo && s.minimo !== s.valor ? `${esc(s.minimo)} ~ ${esc(s.valor)}` : esc(s.valor);
    return `<li><span>${esc(s.nome)}</span><b>${valor}${s.extra ? ` <small>(+${esc(s.extra)})</small>` : ''}</b></li>`;
  }

  /** O cartão de um item, como o do jogo mas em coluna. */
  function cartaoItem(f) {
    const g = GRAU_COR[f.grau] || 'common';
    return `<div class="item-cartao">
      <div class="cab">
        <img class="g-${g}" src="${esc(icone(f.icone))}" alt="" />
        <div>
          <h2 class="txt-${g}">${esc(f.nome)}${f.encantamento ? ` <span class="enc">+${f.encantamento}</span>` : ''}</h2>
          <div class="sub">${esc(f.grauNome || f.grau || '')} · ${esc(f.categoria || '')}${f.nivelEquipar ? ` · nível ${f.nivelEquipar}` : ''}</div>
          <div class="sub">${f.transacionavel ? 'Transacionável' : 'Não transacionável'}${f.classes.length ? ` · ${f.classes.map(esc).join(', ')}` : ''}${f.raca && f.raca !== 'Todos' ? ` · ${esc(f.raca)}` : ''}</div>
        </div>
      </div>
      ${f.principais.length ? `<h3>Atributos</h3><ul class="atr">${f.principais.map(linhaAtributo).join('')}</ul>` : ''}
      ${f.secundarios.length ? `<h3>Atributos adicionais</h3><ul class="atr">${f.secundarios.map(linhaAtributo).join('')}</ul>` : ''}
      ${f.pedras.length ? `<h3>Pedras mágicas</h3><ul class="atr">${f.pedras.map((p) => `<li><span><img src="${esc(icone(p.icone))}" alt="" /> ${esc(p.nome)}</span><b class="txt-${GRAU_COR[p.grau] || 'common'}">${esc(p.valor)}</b></li>`).join('')}</ul>` : ''}
      ${f.casasPedras || f.casasDivinas || f.encantamentoMax ? `<p class="dim">${[f.casasPedras ? `${f.casasPedras} casas de pedra mágica` : '', f.casasDivinas ? `${f.casasDivinas} de pedra divina` : '', f.encantamentoMax ? `encanta até +${f.encantamentoMax}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
      ${f.origens.length ? `<h3>Onde se obtém</h3><p>${f.origens.map(esc).join(', ')}</p>` : ''}
      ${f.aparencias.length ? `<h3>Aparência</h3><p>${f.aparencias.map(esc).join(', ')}</p>` : ''}
    </div>`;
  }

  window.UI = { grelha, resumo, cartaoItem, icone, GRAU_COR };
})();
