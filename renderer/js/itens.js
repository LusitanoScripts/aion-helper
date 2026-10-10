// A aba Itens: a base de dados de todos os itens do Global, procurada sem rede
// (o índice vem com a app, gerado por scripts/gerar-itens.js). O detalhe de um
// item pede-se à NC quando se abre, no idioma do jogo e no encantamento escolhido.
(function () {
  'use strict';

  const { esc, normalizar } = window.U;
  const $ = (s) => document.querySelector(s);
  const { icone, GRAU_COR } = window.UI;

  // A ordem do jogo; os nomes vêm do índice (o jogo em português chama "Épico" ao Legend).
  const ORDEM_GRAUS = ['Common', 'Rare', 'Legend', 'Unique', 'Epic', 'Special'];
  const POR_PAGINA = 150;

  const st = { itens: [], filtrados: [], mostrar: POR_PAGINA, escolhido: null, encantamento: 0 };

  function semPrefixo(m) {
    return String(m || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  async function carregar() {
    $('#itEstado').textContent = 'A carregar o índice…';
    const r = await window.api.indiceItens();
    if (!r.itens.length) {
      $('#itEstado').innerHTML = 'Esta versão da app veio sem o índice de itens (<code>src/dados/itens.json</code>). Gera-se com <code>node scripts/gerar-itens.js</code>.';
      $('#itEstado').className = 'estado erro';
      return;
    }
    // A chave de procura junta os dois nomes, sem acentos: "pedra" acha "Pedra de Superação" e "Amplify Stone".
    st.itens = r.itens.map((x) => ({ ...x, chave: normalizar(`${x.nome} ${x.outro || ''} ${x.id}`) }));
    st.gerado = r.gerado;

    const cats = [...new Set(st.itens.map((x) => x.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $('#itCat').innerHTML = '<option value="">Todas</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
    const graus = new Map(st.itens.map((x) => [x.grau, x.grauNome]));
    const ordem = (g) => (ORDEM_GRAUS.indexOf(g) + 1 || 99);
    $('#itGrau').innerHTML = '<option value="">Todas</option>' + [...graus].filter(([g]) => g).sort((a, b) => ordem(a[0]) - ordem(b[0])).map(([g, n]) => `<option value="${esc(g)}">${esc(n)}</option>`).join('');
    const classes = [...new Set(st.itens.flatMap((x) => x.classes))].sort((a, b) => a.localeCompare(b));
    $('#itClasse').innerHTML = '<option value="">Todas</option>' + classes.map((c) => `<option>${esc(c)}</option>`).join('');
    filtrar();
  }

  function filtrar() {
    const q = normalizar($('#itProcura').value);
    const termos = q.split(/\s+/).filter(Boolean);
    const cat = $('#itCat').value;
    const grau = $('#itGrau').value;
    const classe = $('#itClasse').value;
    const tr = $('#itTransacionavel').checked;
    st.filtrados = st.itens.filter(
      (x) =>
        termos.every((t) => x.chave.includes(t)) &&
        (!cat || x.cat === cat) &&
        (!grau || x.grau === grau) &&
        (!classe || x.classes.includes(classe)) &&
        (!tr || x.tr),
    );
    // Quem procura um nome quer primeiro os que começam por ele.
    if (q) {
      const comeca = (x) => (normalizar(x.nome).startsWith(q) ? 0 : 1);
      st.filtrados.sort((a, b) => comeca(a) - comeca(b) || a.nome.localeCompare(b.nome));
    } else st.filtrados.sort((a, b) => a.nome.localeCompare(b.nome));
    st.mostrar = POR_PAGINA;
    desenhar();
  }

  function desenhar() {
    const l = st.filtrados.slice(0, st.mostrar);
    $('#itEstado').className = 'estado';
    $('#itEstado').innerHTML = `<b>${st.filtrados.length}</b> de ${st.itens.length} itens${st.gerado ? ` · índice de ${esc(st.gerado)}` : ''} · nomes e atributos do site oficial da NC`;
    $('#itLista').innerHTML = `<table class="it-tabela"><tbody>${l
      .map((x) => {
        const g = GRAU_COR[x.grau] || 'common';
        return `<tr data-id="${x.id}" class="${st.escolhido === x.id ? 'sel' : ''}">
          <td class="ico"><img class="g-${g}" src="${esc(icone(x.icone))}" alt="" loading="lazy" /></td>
          <td><div class="nome txt-${g}">${esc(x.nome)}</div><div class="sub">${esc(x.outro || '')}${x.outro ? ' · ' : ''}${esc(x.cat || '')}${x.classes.length && x.classes.length < 8 ? ' · ' + x.classes.map(esc).join(', ') : ''}</div></td>
          <td class="num">${x.nivel ? `nível ${x.nivel}` : ''}</td>
          <td class="num dim">${x.tr ? 'transacionável' : ''}</td>
        </tr>`;
      })
      .join('')}</tbody></table>${st.filtrados.length > st.mostrar ? `<div class="it-mais"><button id="itMais">Mostrar mais ${Math.min(POR_PAGINA, st.filtrados.length - st.mostrar)}</button></div>` : ''}`;
  }

  async function abrir(id) {
    st.escolhido = id;
    document.querySelectorAll('#itLista tr.sel').forEach((x) => x.classList.remove('sel'));
    const tr = document.querySelector(`#itLista tr[data-id="${id}"]`);
    if (tr) tr.classList.add('sel');
    const d = $('#itDetalhe');
    d.className = 'detalhe';
    d.innerHTML = '<p class="dim">A ler a ficha na NC…</p>';
    try {
      const r = await window.api.fichaItem(id, st.encantamento);
      if (st.escolhido !== id) return;
      const f = r.dados;
      let enc = '';
      if (f.encantamentoMax) {
        const opts = Array.from({ length: f.encantamentoMax + 1 }, (_, i) => `<option value="${i}"${i === st.encantamento ? ' selected' : ''}>+${i}</option>`).join('');
        enc = `<label class="campo it-enc"><span>Encantamento</span><select id="itEnc">${opts}</select></label>`;
      }
      // Se o item está no mercado do servidor escolhido em Preços, mostra-se o preço.
      const linha = window.App && window.App.linha(id);
      const mercado = linha && linha.price ? `<div class="kpi destaque it-preco"><span>Mercado · ${esc(window.App.nomeServidor())}</span><b>${window.Precos.formatarKinah(linha.sold_avg_price || linha.price)}</b><small>${linha.sold_avg_price ? 'preço médio vendido' : 'anúncio mais barato'} · ${linha.listings || 0} anúncios</small></div>` : '';
      d.innerHTML = enc + window.UI.cartaoItem(f) + mercado + `<p class="fonte">Item ${id} · ficha oficial da NC</p>`;
    } catch (e) {
      d.innerHTML = `<p class="erro">${esc(semPrefixo(e.message))}</p>`;
    }
  }

  $('#itProcura').addEventListener('input', () => {
    clearTimeout(st.relogio);
    st.relogio = setTimeout(filtrar, 120);
  });
  for (const id of ['#itCat', '#itGrau', '#itClasse', '#itTransacionavel']) $(id).addEventListener('change', filtrar);
  $('#itLista').addEventListener('click', (e) => {
    if (e.target.id === 'itMais') {
      st.mostrar += POR_PAGINA;
      return desenhar();
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) abrir(Number(tr.dataset.id));
  });
  $('#itDetalhe').addEventListener('change', (e) => {
    if (e.target.id !== 'itEnc') return;
    st.encantamento = Number(e.target.value);
    abrir(st.escolhido);
  });

  let arrancou = false;
  document.querySelector('#abas [data-aba=itens]').addEventListener('click', () => {
    if (arrancou) return;
    arrancou = true;
    carregar().catch((e) => ($('#itEstado').textContent = semPrefixo(e.message)));
    $('#itProcura').focus();
  });

  window.Itens = { abrir, procurar: (q) => (($('#itProcura').value = q), filtrar()) };
})();
