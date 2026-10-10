// A aba de preços. Um só ficheiro por agora; quando vier o inventário passa a
// haver abas, e isto muda-se para renderer/js/tabs/.
(function () {
  'use strict';

  const P = window.Precos;
  const { esc, normalizar, idade, sparkline } = window.U;
  const $ = (s) => document.querySelector(s);

  const st = {
    servidores: [],
    servidor: null,
    linhas: [],
    fichas: {}, // id → ficha oficial da NC (nome PT, ícone, transacionável)
    ordem: { campo: 'nome', asc: true },
    selecionado: null,
    meta: null, // { idadeMs, origem, erro, recolha }
    progressoNomes: null,
  };

  // ── carregar ──────────────────────────────────────────────────────────────

  async function arrancar() {
    const defs = await window.api.definicoes();
    $('#btnFixar').classList.toggle('on', !!defs.pin);

    let r;
    try {
      r = await window.api.servidores();
    } catch (e) {
      mostrarEstado(`Não consegui falar com o aion2.exchange: ${e.message}`, 'erro');
      return;
    }
    st.servidores = r.dados.servidores;
    const existe = (id) => st.servidores.some((s) => s.id === id);
    st.servidor = existe(defs.servidor) ? defs.servidor : r.dados.omissao;
    preencherServidores();
    await carregarItens(false);
  }

  function preencherServidores() {
    const grupos = new Map();
    for (const s of st.servidores) {
      const g = s.regiaoNome || s.regiao || 'Outros';
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(s);
    }
    $('#servidor').innerHTML = [...grupos]
      .map(
        ([g, lista]) =>
          `<optgroup label="${esc(g)}">` +
          lista
            .map((s) => `<option value="${s.id}"${s.id === st.servidor ? ' selected' : ''}>${esc(s.nome)} · ${esc(window.U.facao(s.facao))}</option>`)
            .join('') +
          '</optgroup>',
      )
      .join('');
  }

  async function carregarItens(forcar) {
    mostrarEstado('A carregar preços…');
    $('#btnAtualizar').classList.add('a-rodar');
    try {
      const r = await window.api.itens(st.servidor, forcar);
      st.linhas = r.dados;
      st.fichas = { ...st.fichas, ...r.fichas };
      st.meta = { idadeMs: r.idadeMs, origem: r.origem, erro: r.erro, recolha: r.recolha };
      // Mostra-se já: o primeiro lote de nomes só chega ao fim de 25 pedidos (~5 s).
      if (r.nomesEmFalta && !st.progressoNomes) st.progressoNomes = { feitos: 0, total: r.nomesEmFalta };
      preencherSeccoes();
      desenhar();
    } catch (e) {
      st.linhas = [];
      desenhar();
      mostrarEstado(`Não consegui carregar os preços: ${e.message}`, 'erro');
    } finally {
      $('#btnAtualizar').classList.remove('a-rodar');
    }
  }

  function preencherSeccoes() {
    const atual = $('#seccao').value;
    const nomes = [...new Set(st.linhas.map((l) => l.seccaoNome).filter(Boolean))].sort();
    $('#seccao').innerHTML =
      '<option value="">Todas</option>' +
      nomes.map((n) => `<option${n === atual ? ' selected' : ''}>${esc(n)}</option>`).join('');
  }

  // ── nomes que chegam aos poucos ──────────────────────────────────────────

  let redesenhoPendente = null;
  window.api.aoChegaremNomes(({ lote, progresso }) => {
    Object.assign(st.fichas, lote);
    // O detalhe aberto antes de o nome chegar ficava em inglês até se voltar a clicar.
    if (st.selecionado != null && lote[st.selecionado]) abrirDetalhe(st.selecionado);
    st.progressoNomes = progresso && !progresso.fim ? progresso : null;
    if (progresso && progresso.erro) st.progressoNomes = { erro: progresso.erro };
    // Um redesenho por fotograma no máximo, que os lotes chegam de 25 em 25.
    if (!redesenhoPendente) {
      redesenhoPendente = requestAnimationFrame(() => {
        redesenhoPendente = null;
        desenhar();
      });
    }
  });

  // ── desenhar ──────────────────────────────────────────────────────────────

  function nomeDe(l) {
    const f = st.fichas[l.id];
    return (f && f.nome) || l.nomeEN;
  }

  function linhasVisiveis() {
    const q = normalizar($('#procura').value);
    const seccao = $('#seccao').value;
    const soCredivel = $('#soCredivel').checked;
    let v = st.linhas.filter((l) => {
      if (seccao && l.seccaoNome !== seccao) return false;
      if (soCredivel && P.avisos(l).length) return false;
      if (!q) return true;
      if (/^\d+$/.test(q)) return String(l.id).includes(q);
      return normalizar(nomeDe(l)).includes(q) || normalizar(l.nomeEN).includes(q);
    });
    const { campo, asc } = st.ordem;
    const chave = {
      nome: (l) => normalizar(nomeDe(l)),
      valor: (l) => P.precoDaLinha(l).valor ?? -1,
      liquido: (l) => P.precoDaLinha(l).valor ?? -1,
      anuncios: (l) => l.listings ?? -1,
      variacao: (l) => l.change_pct ?? -Infinity,
    }[campo];
    v = v.slice().sort((a, b) => {
      const x = chave(a);
      const y = chave(b);
      const c = typeof x === 'string' ? x.localeCompare(y, 'pt') : x - y;
      return asc ? c : -c;
    });
    return v;
  }

  function desenhar() {
    const v = linhasVisiveis();
    $('#tabela tbody').innerHTML = v.map(linhaHTML).join('') ||
      `<tr><td colspan="6" class="vazio">${st.linhas.length ? 'Nada corresponde aos filtros.' : ''}</td></tr>`;
    for (const th of document.querySelectorAll('#tabela th[data-ord]')) {
      th.classList.toggle('ord', th.dataset.ord === st.ordem.campo);
      th.dataset.dir = th.dataset.ord === st.ordem.campo ? (st.ordem.asc ? '▲' : '▼') : '';
    }
    desenharEstado(v.length);
  }

  function linhaHTML(l) {
    const f = st.fichas[l.id];
    const { valor, base } = P.precoDaLinha(l);
    const av = P.avisos(l);
    const pt = f && f.nome;
    const icone = f && f.icone ? `<img src="${esc(f.icone)}" alt="" loading="lazy" />` : '<span class="sem-ico"></span>';
    const grau = f && f.grau ? ` g-${esc(f.grau.toLowerCase())}` : '';
    const chg = l.change_pct;
    return `<tr data-id="${l.id}" class="${st.selecionado === l.id ? 'sel' : ''}">
      <td class="ico${grau}">${icone}</td>
      <td class="nome">
        <div class="pt">${esc(pt || l.nomeEN)}</div>
        <div class="sub">${pt ? esc(l.nomeEN) + ' · ' : ''}${esc(l.categoria || '')}${av.length ? ` <span class="aviso" title="${esc(av.join('; '))}">⚠ ${esc(av[0])}</span>` : ''}</div>
      </td>
      <td class="num"><b>${P.formatarKinah(valor)}</b>${base ? `<span class="base b-${base}">${base}</span>` : ''}</td>
      <td class="num dim">${P.formatarKinah(P.liquido(valor))}</td>
      <td class="num">${l.listings ?? '—'}</td>
      <td class="num ${chg >= 0.05 ? 'sobe' : chg <= -0.05 ? 'desce' : ''}">${P.formatarPct(chg)}</td>
    </tr>`;
  }

  function desenharEstado(visiveis) {
    const s = st.servidores.find((x) => x.id === st.servidor);
    const partes = [];
    if (s) partes.push(`<b>${esc(s.nome)}</b> (${esc(s.regiao)}, ${esc(window.U.facao(s.facao))})`);
    partes.push(`${visiveis} de ${st.linhas.length} itens`);
    const temVendidos = st.linhas.some((l) => l.sold_avg_price);
    if (st.linhas.length && !temVendidos) {
      partes.push('<span class="nota" title="O aion2.exchange só tem preços de venda de um servidor (Kaisinel EU, Elyos). Aqui o valor é o anúncio mais barato — vê o preço de referência no detalhe.">neste servidor o valor é o anúncio mais barato</span>');
    }
    const pn = st.progressoNomes;
    if (pn && pn.erro) partes.push(`<span class="nota">nomes em português indisponíveis (${esc(pn.erro)})</span>`);
    else if (pn) partes.push(`a traduzir nomes ${pn.feitos}/${pn.total}…`);
    const m = st.meta;
    let tipo = '';
    if (m && m.origem === 'cache-velha') {
      partes.push(`<span class="nota">o aion2.exchange não respondeu — a mostrar preços guardados ${esc(idade(m.idadeMs))}</span>`);
      tipo = 'aviso';
    }
    mostrarEstado(partes.join(' · '), tipo);

    // A idade que interessa é a da recolha do exchange, não a do nosso pedido.
    const rec = m && m.recolha;
    const seg = rec && rec.snapshot_age_seconds;
    const fr = $('#frescura');
    if (seg != null) {
      fr.textContent = `preços ${idade(seg * 1000)}`;
      fr.className = 'tb-fresh' + (seg > 3 * 3600 ? ' velho' : '');
      fr.title = seg > 3 * 3600
        ? 'O aion2.exchange não recolhe preços novos há várias horas. O mercado pode já estar diferente.'
        : 'Hora da última recolha do aion2.exchange';
    } else {
      fr.textContent = '';
    }
  }

  function mostrarEstado(html, tipo) {
    const e = $('#estado');
    e.innerHTML = html;
    e.className = 'estado' + (tipo ? ' ' + tipo : '');
  }

  // ── detalhe ───────────────────────────────────────────────────────────────

  async function abrirDetalhe(id) {
    st.selecionado = id;
    for (const tr of document.querySelectorAll('#tabela tr.sel')) tr.classList.remove('sel');
    const tr = document.querySelector(`#tabela tr[data-id="${id}"]`);
    if (tr) tr.classList.add('sel');

    const l = st.linhas.find((x) => x.id === id);
    if (!l) return;
    const f = st.fichas[id] || {};
    const d = $('#detalhe');
    d.classList.remove('vazio');
    const cabeca = `
      <div class="cab">
        ${f.icone ? `<img src="${esc(f.icone)}" alt="" />` : ''}
        <div>
          <h2>${esc(f.nome || l.nomeEN)}</h2>
          <div class="sub">${f.nome ? esc(l.nomeEN) + ' · ' : ''}${esc(f.grauNome || '')} ${esc(f.categoria || l.categoria || '')} · #${l.id}</div>
          ${f.transacionavel === false ? '<div class="aviso">Não transacionável — não se vende no mercado.</div>' : ''}
        </div>
      </div>`;
    d.innerHTML = cabeca + '<p class="dica">A carregar histórico…</p>';

    let r;
    try {
      r = await window.api.item(id, st.servidor);
    } catch (e) {
      if (st.selecionado === id) d.innerHTML = cabeca + `<p class="erro">Sem histórico: ${esc(e.message)}</p>`;
      return;
    }
    if (st.selecionado !== id) return; // entretanto escolheu-se outro

    const pontos = r.dados.historico || [];
    const ref = P.referenciaDoHistorico(pontos, { horas: 72 });
    const agora = P.precoDaLinha(l);
    const av = P.avisos(l);
    const profundidade = r.dados.profundidade || {};
    const prof = (profundidade.pontos || []).filter((p) => p.status === 'ok').pop();

    const blocos = [];
    blocos.push(`<div class="kpis">
      <div class="kpi destaque" title="Mediana do anúncio mais barato, hora a hora, nas últimas 72 h. Um anúncio isolado não a arrasta.">
        <span>Referência (72 h)</span><b>${P.formatarKinah(ref.valor)}</b>
        <small>${ref.valor != null ? `${ref.horas} horas com dados · recebes ${P.formatarKinah(P.liquido(ref.valor))}` : `só ${ref.horas} h com dados — pouco para afirmar`}</small>
      </div>
      <div class="kpi"><span>${agora.base === 'vendido' ? 'Média vendida' : 'Anúncio mais barato'}</span><b>${P.formatarKinah(agora.valor)}</b>
        <small>${l.listings ?? 0} anúncios${l.units_sold ? ` · ${l.units_sold} vendidos` : ''}</small></div>
    </div>`);
    if (av.length) blocos.push(`<div class="aviso">⚠ ${esc(av.join(' · '))}</div>`);
    if (ref.valor != null && agora.base === 'pedido' && agora.valor > ref.valor * 2) {
      blocos.push(`<div class="aviso">O anúncio mais barato está a ${(agora.valor / ref.valor).toFixed(1).replace('.', ',')}× a referência. Para saber quanto vale, confia na referência.</div>`);
    }
    const fechos = pontos.map((p) => p.close);
    if (fechos.length >= 2) {
      blocos.push(`<h3>Anúncio mais barato, hora a hora</h3>${sparkline(fechos)}
        <div class="eixo"><span>${P.formatarKinah(ref.min ?? Math.min(...fechos))}</span><span>${P.formatarKinah(ref.max ?? Math.max(...fechos))}</span></div>`);
    }
    if (prof) {
      blocos.push(`<h3>Comprar agora</h3>
        <p>Para levar <b>${profundidade.unidades ?? '?'}</b> unidades: <b>${P.formatarKinah(prof.unit_avg)}</b> cada, em média
        (${P.formatarKinah(prof.cost)} no total${prof.units_stacks && prof.units_stacks !== profundidade.unidades ? `; como se compra o lote inteiro, levas ${prof.units_stacks} por ${P.formatarKinah(prof.cost_stacks)}` : ''}).
        Há <b>${prof.units_available ?? '?'}</b> à venda.</p>`);
    }
    const alerta = (await window.api.alertas()).find((x) => x.itemId === id && x.servidor === st.servidor);
    const sugestao = Math.round((ref.valor || agora.valor || 0) * 0.85);
    blocos.push(`<h3>Alerta de preço</h3>
      <div class="alerta-form" data-id="${id}">
        <span>Avisa-me quando estiver a</span>
        <input type="number" min="1" step="1" value="${alerta ? alerta.limite : sugestao || ''}" />
        <span>ou menos em ${esc((st.servidores.find((s) => s.id === st.servidor) || {}).nome || '')}</span>
        <button class="guardar">${alerta ? 'Mudar' : 'Criar alerta'}</button>
        ${alerta ? '<button class="tirar">Tirar</button>' : ''}
      </div>
      <p class="dim pequeno">${alerta ? `Ativo: ${P.formatarKinah(alerta.limite)} ou menos.` : 'Verifica de 15 em 15 minutos e mostra uma notificação do Windows.'}</p>`);
    blocos.push(`<p class="fonte">Dados: <a href="#" data-link="https://aion2.exchange/items/${id}">aion2.exchange</a> · nome e ícone: NCSoft</p>`);
    d.innerHTML = cabeca + blocos.join('');
  }

  // ── eventos ───────────────────────────────────────────────────────────────

  $('#servidor').addEventListener('change', async (e) => {
    st.servidor = Number(e.target.value);
    st.selecionado = null;
    $('#detalhe').className = 'detalhe vazio';
    $('#detalhe').innerHTML = '<p class="dica">Escolhe um item para ver o histórico e o preço de referência.</p>';
    await window.api.mudarDefinicoes({ servidor: st.servidor });
    carregarItens(false);
  });
  $('#procura').addEventListener('input', desenhar);
  $('#seccao').addEventListener('change', desenhar);
  $('#soCredivel').addEventListener('change', desenhar);

  document.querySelector('#tabela thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-ord]');
    if (!th) return;
    const campo = th.dataset.ord;
    st.ordem = { campo, asc: st.ordem.campo === campo ? !st.ordem.asc : campo === 'nome' };
    desenhar();
  });
  document.querySelector('#tabela tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) abrirDetalhe(Number(tr.dataset.id));
  });
  $('#detalhe').addEventListener('click', async (e) => {
    const form = e.target.closest('.alerta-form');
    if (form && e.target.matches('button')) {
      const id = Number(form.dataset.id);
      const l = st.linhas.find((x) => x.id === id);
      const s = st.servidores.find((x) => x.id === st.servidor) || {};
      if (e.target.classList.contains('tirar')) await window.api.apagarAlerta(id, st.servidor);
      else {
        const limite = Number(form.querySelector('input').value);
        if (!(limite > 0)) return form.querySelector('input').focus();
        await window.api.definirAlerta({ itemId: id, nome: nomeDe(l), servidor: st.servidor, nomeServidor: s.nome, limite });
      }
      abrirDetalhe(id);
      return;
    }
    const a = e.target.closest('[data-link]');
    if (a) {
      e.preventDefault();
      window.api.abrirLink(a.dataset.link);
    }
  });

  $('#btnAtualizar').addEventListener('click', () => carregarItens(true));
  $('#btnMin').addEventListener('click', () => window.api.minimizar());
  $('#btnFechar').addEventListener('click', () => window.api.fechar());
  $('#btnFixar').addEventListener('click', async () => {
    const on = !$('#btnFixar').classList.contains('on');
    $('#btnFixar').classList.toggle('on', await window.api.fixar(on));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
      e.preventDefault();
      carregarItens(true);
    }
    if (e.key === 'f' && e.ctrlKey) {
      e.preventDefault();
      $('#procura').focus();
      $('#procura').select();
    }
  });

  // ── abas ──────────────────────────────────────────────────────────────────
  document.getElementById('abas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-aba]');
    if (!b) return;
    for (const x of document.querySelectorAll('#abas button')) x.classList.toggle('on', x === b);
    for (const m of document.querySelectorAll('main.aba')) m.hidden = m.id !== b.dataset.aba;
  });

  // O que a aba da mochila precisa de saber daqui: servidor, preços e nomes.
  window.App = {
    // Depois de mudar o idioma: esquece os nomes antigos e volta a carregar.
    recarregar: () => {
      st.fichas = {};
      return carregarItens(false);
    },
    servidor: () => st.servidor,
    linha: (id) => st.linhas.find((l) => l.id === id) || null,
    ficha: (id) => st.fichas[id] || null,
    nomeServidor: () => {
      const s = st.servidores.find((x) => x.id === st.servidor);
      return s ? `${s.nome} (${s.regiao}, ${window.U.facao(s.facao)})` : '';
    },
  };

  arrancar();
})();
