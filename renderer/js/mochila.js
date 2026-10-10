// A aba da mochila: tirar a foto, mostrar o que se leu e quanto vale.
(function () {
  'use strict';

  const P = window.Precos;
  const { esc } = window.U;
  const $ = (s) => document.querySelector(s);

  let ultima = null; // o último resultado, para redesenhar quando chegam referências
  let notas = {}; // nome normalizado → texto, para mostrar a nota de cada item

  async function carregarNotas() {
    try {
      notas = {};
      for (const n of await window.api.notas()) notas[window.U.normalizar(n.nome)] = n.texto;
    } catch {
      /* sem notas a lista mostra-se na mesma */
    }
  }
  const referencias = {}; // `${servidor}:${id}` → valor da mediana 72 h (ou null)

  function estado(html, tipo) {
    const e = $('#mochilaEstado');
    e.innerHTML = html;
    e.className = 'estado' + (tipo ? ' ' + tipo : '');
  }

  /**
   * O preço por unidade que se afirma, e de onde vem — pela ordem de confiança:
   * média vendida (só no Kaisinel) → referência de 72 h → anúncio mais barato.
   */
  function unitario(id) {
    const linha = window.App.linha(id);
    if (!linha) {
      // O servidor escolhido não o tem à venda: o de referência, marcado como tal.
      const ref = ultima && ultima.ref && ultima.ref.linhas[id];
      if (!ref) return null;
      const p = P.precoDaLinha(ref.linha);
      return p.valor == null ? null : { valor: p.valor, base: p.base, linha: ref.linha, deOutro: ref.servidor, avisos: P.avisos(ref.linha) };
    }
    const p = P.precoDaLinha(linha);
    if (p.base === 'vendido') return { valor: p.valor, base: 'vendido', linha };
    const ref = referencias[`${window.App.servidor()}:${id}`];
    if (ref != null) return { valor: ref, base: 'referência', linha };
    return { valor: p.valor, base: 'pedido', linha, avisos: P.avisos(linha) };
  }

  function fichaDe(id) {
    return window.App.ficha(id) || (ultima && ultima.fichas && ultima.fichas[id]) || null;
  }

  /** Vários itens com o mesmo ícone (as versões "Brilhante"): fica o mais barato, e diz-se. */
  function escolher(ids) {
    const op = ids
      .map((id) => ({ id, ficha: fichaDe(id), u: unitario(id) }))
      .filter((o) => o.u && o.u.valor != null)
      .sort((a, b) => a.u.valor - b.u.valor);
    if (!op.length) return { id: ids[0], ficha: fichaDe(ids[0]), u: null, alternativas: [] };
    return { ...op[0], alternativas: op.slice(1) };
  }

  async function pedirReferencias(ids) {
    const servidor = window.App.servidor();
    const faltam = ids.filter((id) => !(`${servidor}:${id}` in referencias) && window.App.linha(id));
    for (const id of faltam) {
      try {
        const r = await window.api.item(id, servidor);
        referencias[`${servidor}:${id}`] = P.referenciaDoHistorico(r.dados.historico || []).valor;
      } catch {
        referencias[`${servidor}:${id}`] = null;
      }
      if (ultima) desenhar(ultima);
    }
  }

  /** A célula da loja: quanto paga pela pilha, e a marca de onde compensa vender. */
  function lojaCel(it, u) {
    const un = ultima && ultima.lojas ? ultima.lojas[it.id] : null;
    if (un == null) return '<span class="dim" title="Ainda não vi o cartão deste item no jogo">—</span>';
    const total = un * it.quantidade;
    const mercado = u ? P.liquido(u.valor * it.quantidade) : null;
    const melhorLoja = mercado == null || total * 1.1 >= mercado;
    return `${P.formatarKinah(total)}${melhorLoja ? '<div class="sub loja-melhor">vende à loja</div>' : ''}`;
  }

  function desenhar(r) {
    ultima = r;
    const servidor = window.App.nomeServidor();
    const corpo = $('#mochilaCorpo');
    if (!r.encontrada) {
      estado('Não encontrei a mochila no ecrã.', 'erro');
      corpo.innerHTML = `<div class="vazio-grande">
        <p>Não vi a mochila em nenhum ecrã.</p>
        <p class="dim">Abre o <b>Cubo</b> no jogo e volta a carregar. A app reconhece a mochila pelos números das pilhas, por isso precisa de pelo menos dois itens com quantidade à vista.
        Ecrãs vistos: ${esc((r.ecras || []).join(', '))}.</p></div>`;
      return;
    }

    const itens = r.casas.filter((c) => c.estado === 'item').map((c) => ({ ...c, ...escolher(c.ids) }));
    const fora = r.casas.filter((c) => c.estado === 'fora');
    const kinah = r.casas.filter((c) => c.moeda === 'Kinah').reduce((s, c) => s + c.quantidade, 0);
    let total = 0;
    let semPreco = 0;
    for (const it of itens) {
      if (it.u && it.u.valor != null) total += it.u.valor * it.quantidade;
      else semPreco++;
    }
    itens.sort((a, b) => (b.u ? b.u.valor * b.quantidade : 0) - (a.u ? a.u.valor * a.quantidade : 0));

    estado(
      `<b>${r.casas.length}</b> casas ocupadas · <b>${itens.length}</b> reconhecidas no mercado · ${fora.length} fora do mercado` +
        ` · preços de ${esc(window.App.nomeServidor())} · ecrã ${esc(r.resolucao)}` +
        (r.experimental ? ' · <span class="aviso-txt" title="A leitura foi medida a 2560×1440; noutras resoluções é experimental. Se vires quantidades erradas, usa o Guardar diagnóstico nas Definições.">resolução experimental</span>' : ''),
    );

    const linhas = itens
      .map((it) => {
        const f = it.ficha || {};
        const u = it.u;
        const alt = it.alternativas.length
          ? `<div class="sub">ou ${esc(it.alternativas.map((a) => (a.ficha && a.ficha.nome) || a.id).join(', '))} — mesmo ícone; conta-se o mais barato</div>`
          : '';
        const aviso = u && u.avisos && u.avisos.length ? ` <span class="aviso" title="${esc(u.avisos.join('; '))}">⚠</span>` : '';
        return `<tr>
          <td class="ico"><img src="${it.recorte}" alt="" title="como está no teu ecrã" /></td>
          <td class="nome"><div class="pt">${esc(f.nome || '#' + it.id)}</div>${alt}${f.nome && notas[window.U.normalizar(f.nome)] ? `<div class="nota-mochila">✎ ${esc(notas[window.U.normalizar(f.nome)])}</div>` : ''}</td>
          <td class="num">${esc(it.texto || '1')}</td>
          <td class="num">${u ? `<b>${P.formatarKinah(u.valor)}</b><span class="base b-${u.base === 'vendido' ? 'vendido' : 'pedido'}">${esc(u.base)}</span>${aviso}${u.deOutro ? `<div class="sub outro" title="Sem anúncios em ${esc(servidor)}">preço de ${esc(u.deOutro)}</div>` : ''}` : `<span class="dim" title="Sem anúncios em ${esc(servidor)} nem no servidor de referência">sem anúncios</span>`}</td>
          <td class="num"><b>${u ? P.formatarKinah(u.valor * it.quantidade) : '—'}</b></td>
          <td class="num dim">${u ? P.formatarKinah(P.liquido(u.valor * it.quantidade)) : '—'}</td>
          <td class="num">${lojaCel(it, u)}</td>
        </tr>`;
      })
      .join('');

    const foraHTML = fora
      .map(
        (c) => `<figure class="fora" title="${esc(c.texto ? c.texto + ' — ' : '')}não está à venda no mercado deste servidor, ou não o reconheci com segurança">
          <img src="${c.recorte}" alt="" /></figure>`,
      )
      .join('');

    corpo.innerHTML = `
      <div class="totais">
        <div class="kpi destaque"><span>Valor de mercado</span><b>${P.formatarKinah(total)}</b>
          <small>recebes ${P.formatarKinah(P.liquido(total))} depois da taxa${semPreco ? ` · ${semPreco} sem preço` : ''}</small></div>
        <div class="kpi"><span>Kinah</span><b>${P.formatarKinah(kinah)}</b><small>${kinah ? `com os itens: ${P.formatarKinah(kinah + P.liquido(total))}` : 'não vi a moeda na mochila'}</small></div>
        <div class="kpi"><span>Reconhecidos</span><b>${itens.length}</b><small>de ${r.casas.length} casas ocupadas</small></div>
      </div>
      ${itens.length ? `<table class="tabela-mochila">
        <thead><tr><th class="ico"></th><th>Item</th><th class="num">Qtd.</th><th class="num" title="Média vendida onde existe; senão a referência de 72 h; senão o anúncio mais barato">Cada</th><th class="num">Total</th><th class="num" title="Depois da taxa de 8% do mercado">Recebes</th><th class="num" title="O que a loja paga, visto no cartão do item (passa o rato pelo item no jogo uma vez)">Loja</th></tr></thead>
        <tbody>${linhas}</tbody></table>` : '<p class="dim pad">Nenhum item da mochila está à venda neste servidor.</p>'}
      ${fora.length ? `<h3>Fora do mercado <small>(vinculados, outras moedas, ou sem par seguro)</small></h3><div class="grelha-fora">${foraHTML}</div>` : ''}
      <p class="fonte">As quantidades grandes vêm arredondadas pelo jogo (381,3K conta como 381 300).</p>`;

    pedirReferencias(itens.flatMap((it) => it.ids || [it.id]));
  }

  async function correr(fn) {
    $('#btnLerMochila').disabled = true;
    $('#btnAbrirImagem').disabled = true;
    estado('A ler…');
    try {
      const r = await fn(window.App.servidor());
      await carregarNotas();
      if (r) desenhar(r);
      else estado('');
    } catch (e) {
      estado(`Falhou: ${esc(e.message)}`, 'erro');
    } finally {
      $('#btnLerMochila').disabled = false;
      $('#btnAbrirImagem').disabled = false;
    }
  }

  window.api.aoProgressoMochila((p) => {
    if (p.fase === 'icones' && !p.fim) estado(`A preparar os ícones do mercado ${p.feitos}/${p.total} (só da primeira vez)…`);
    if (p.fase === 'ler') estado('A procurar a mochila…');
  });

  $('#btnLerMochila').addEventListener('click', () => correr(window.api.lerMochila));
  $('#btnAbrirImagem').addEventListener('click', () => correr(window.api.abrirImagemMochila));

  window.Mochila = {
    teste: () => correr(window.api.mochilaTeste),
    // Chamado pela aba das notas depois de guardar: a lista mostra logo a nota nova.
    notasMudaram: async () => {
      await carregarNotas();
      if (ultima) desenhar(ultima);
    },
  };
})();
