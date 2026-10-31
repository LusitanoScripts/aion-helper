// A aba Daevanion: planos dos tabuleiros, com nome, que se gravam e reabrem —
// como o ecrã do jogo, mas para planear antes de gastar os cristais. Os
// tabuleiros vêm do site oficial da NC (os mesmos da aba Builds), as regras de
// abrir/fechar e o custo de src/daevanion.js, e a grelha e a soma dos efeitos do
// partilhado-ui.js. Os planos ficam nas definições (chave `planosDaevanion`).
//
// Gravar é explícito (botão Gravar ou Ctrl+S): as mudanças ficam "por gravar"
// até lá, e a app pergunta antes de as deitar fora.
(function () {
  'use strict';

  const { esc } = window.U;
  const $ = (s) => document.querySelector(s);
  const DV = window.Daevanion;

  const GRAUS = { Common: 'Comum', Rare: 'Raro', Legend: 'Épico', Unique: 'Único', Epic: 'Lendário' };
  const TIPOS = { Start: 'Início', Stat: 'Atributo', SkillLevel: 'Nível de habilidade' };

  const st = {
    planos: [], // os gravados
    atual: null, // cópia de trabalho do plano aberto
    sujo: false,
    classes: [],
    tabs: null, // tabuleiros da classe do plano aberto
    tabsClasse: null,
    tabAtual: null,
    noVisto: null, // o nó cujo detalhe se mostra
    regioes: {},
  };

  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const copia = (p) => JSON.parse(JSON.stringify(p));
  const nomeClasse = (n) => (st.classes.find((c) => c.nome === n) || {}).texto || n;

  function estado(html, erro = false) {
    $('#dzEstado').innerHTML = html || '';
    $('#dzEstado').className = 'estado' + (erro ? ' erro' : '');
  }

  function marcarSujo(on = true) {
    st.sujo = on;
    $('#dzGravar').textContent = on ? 'Gravar •' : 'Gravado';
    $('#dzGravar').classList.toggle('primario', on);
    $('#dzGravar').classList.toggle('tz-acertar', !on);
  }

  // ── lista de planos ──────────────────────────────────────────────────────

  function desenharLista() {
    $('#dzConta').textContent = st.planos.length ? `(${st.planos.length})` : '';
    $('#dzLista').innerHTML = st.planos
      .slice()
      .sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0))
      .map((p) => {
        const n = Object.values(p.daevanion || {}).reduce((s, l) => s + l.length, 0);
        return `<div class="bl-item${st.atual && st.atual.id === p.id ? ' on' : ''}" data-id="${esc(p.id)}">
          <div class="nome">${esc(p.nome)}</div>
          <div class="sub"><span>${esc(nomeClasse(p.classe))}</span><span class="etq">${n} nós</span></div>
        </div>`;
      })
      .join('');
    $('#dzVazio').hidden = !!st.atual;
    $('#dzEditor').hidden = !st.atual;
  }

  function podeLargar() {
    return !st.sujo || confirm('Este plano tem mudanças por gravar. Deitá-las fora?');
  }

  function abrir(id) {
    const p = st.planos.find((x) => x.id === id);
    if (!p) return;
    st.atual = copia(p);
    st.noVisto = null;
    marcarSujo(false);
    estado('');
    $('#dzNome').value = st.atual.nome;
    $('#dzClasse').value = st.atual.classe;
    desenharLista();
    desenhar();
  }

  async function gravar() {
    if (!st.atual) return;
    st.atual.nome = $('#dzNome').value.trim() || 'Plano sem nome';
    st.atual.atualizado = Date.now();
    const i = st.planos.findIndex((x) => x.id === st.atual.id);
    if (i >= 0) st.planos[i] = copia(st.atual);
    else st.planos.push(copia(st.atual));
    await window.api.mudarDefinicoes({ planosDaevanion: st.planos });
    marcarSujo(false);
    estado(`Gravado às ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}.`);
    desenharLista();
  }

  function novo(classe, base = null) {
    if (!podeLargar()) return;
    st.atual = base
      ? { ...copia(base), id: novoId(), nome: base.nome + ' (cópia)', atualizado: Date.now() }
      : { id: novoId(), nome: 'Novo plano', classe, daevanion: {}, atualizado: Date.now() };
    st.planos.push(copia(st.atual));
    window.api.mudarDefinicoes({ planosDaevanion: st.planos });
    st.noVisto = null;
    marcarSujo(false);
    $('#dzNome').value = st.atual.nome;
    $('#dzClasse').value = st.atual.classe;
    estado('');
    desenharLista();
    desenhar();
    $('#dzNome').select();
  }

  $('#dzLista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b || (st.atual && b.dataset.id === st.atual.id) || !podeLargar()) return;
    abrir(b.dataset.id);
  });
  $('#dzNovo').addEventListener('click', () => novo((st.atual && st.atual.classe) || (st.classes[0] && st.classes[0].nome)));
  $('#dzDuplicar').addEventListener('click', () => st.atual && novo(null, st.atual));
  $('#dzGravar').addEventListener('click', gravar);
  $('#dzApagar').addEventListener('click', async () => {
    if (!st.atual || !confirm(`Apagar o plano "${st.atual.nome}"?`)) return;
    st.planos = st.planos.filter((x) => x.id !== st.atual.id);
    await window.api.mudarDefinicoes({ planosDaevanion: st.planos });
    st.atual = null;
    marcarSujo(false);
    desenharLista();
  });
  $('#dzNome').addEventListener('input', () => marcarSujo());
  $('#dzClasse').addEventListener('change', (e) => {
    const abertos = Object.values(st.atual.daevanion).reduce((s, l) => s + l.length, 0);
    if (abertos && !confirm(`Mudar para ${nomeClasse(e.target.value)}? Os tabuleiros são outros: os ${abertos} nós abertos deste plano vão-se.`)) {
      e.target.value = st.atual.classe;
      return;
    }
    st.atual.classe = e.target.value;
    st.atual.daevanion = {};
    st.noVisto = null;
    marcarSujo();
    desenhar();
  });
  // Ctrl+S grava, com a aba à vista.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's' && !$('#daevanion').hidden && st.atual) {
      e.preventDefault();
      gravar();
    }
  });

  // ── tabuleiros ───────────────────────────────────────────────────────────

  async function desenhar() {
    if (!st.atual) return;
    const classe = st.atual.classe;
    if (st.tabsClasse !== classe) {
      st.tabs = null;
      $('#dzAbas').innerHTML = '';
      $('#dzGrelha').innerHTML = '<p class="dim pad">A ler os tabuleiros no site da NC… (da primeira vez demora uns segundos)</p>';
      try {
        const r = await window.api.tabuleiros(classe);
        if (!st.atual || st.atual.classe !== classe) return;
        st.tabs = r.dados;
        st.tabsClasse = classe;
      } catch (e) {
        $('#dzGrelha').innerHTML = `<p class="erro pad">Não consegui ler os tabuleiros: ${esc(e.message)}</p>`;
        return;
      }
    }
    if (!st.tabs.some((t) => t.id === st.tabAtual)) st.tabAtual = st.tabs[0] && st.tabs[0].id;
    const dv = st.atual.daevanion;
    $('#dzAbas').innerHTML = st.tabs
      .map((t) => {
        const g = DV.gastoTabuleiro(t, dv[t.id] || []);
        return `<button data-tab="${t.id}" class="${t.id === st.tabAtual ? 'on' : ''}" title="${esc(g.cristal)}: ${g.gasto} de ${g.total}">
          <img src="${esc(window.UI.icone(t.icone))}" alt="" /> ${esc(t.nome)} <small>${g.gasto}/${g.total}◆</small></button>`;
      })
      .join('');
    const tab = st.tabs.find((t) => t.id === st.tabAtual);
    $('#dzGrelha').innerHTML = tab ? window.UI.grelha(tab, dv[tab.id] || [], { editavel: true }) : '';
    if (st.noVisto) {
      const el = $(`#dzGrelha .dv-no[data-no="${st.noVisto}"]`);
      if (el) el.classList.add('visto');
    }
    // Sem o title do rato: o detalhe vai para o painel ao lado.
    for (const el of document.querySelectorAll('#dzGrelha .dv-no')) el.removeAttribute('title');
    desenharTabuleiro(tab);
    desenharNo(tab);
    $('#dzResumo').innerHTML = window.UI.resumo(st.tabs, dv);
  }

  /** O cabeçalho do tabuleiro escolhido: cristal e quanto se gasta. */
  function desenharTabuleiro(tab) {
    if (!tab) return ($('#dzTab').innerHTML = '');
    const g = DV.gastoTabuleiro(tab, st.atual.daevanion[tab.id] || []);
    const abertos = (st.atual.daevanion[tab.id] || []).length;
    const total = tab.nos.filter((n) => n.tipo !== 'Start').length;
    $('#dzTab').innerHTML = `<div class="dz-tab-nome"><img src="${esc(window.UI.icone(tab.icone))}" alt="" /> ${esc(tab.nome)}</div>
      <div class="dz-tab-kpis">
        <span><b>${abertos}</b>/${total} nós</span>
        <span>${esc(g.cristal)}: <b>${g.gasto}</b> de ${g.total}</span>
        <span class="dim">faltam ${g.total - g.gasto} para o tabuleiro todo</span>
      </div>`;
  }

  /** O detalhe do nó por baixo do rato (ou o último clicado). */
  function desenharNo(tab) {
    const n = tab && st.noVisto && tab.nos.find((x) => x.id === st.noVisto);
    if (!n) {
      $('#dzNo').innerHTML = '<p class="dim">Passa o rato por um nó para ver o que dá. Clica para o abrir ou fechar.</p>';
      return;
    }
    const abertos = st.atual.daevanion[tab.id] || [];
    const aberto = n.tipo === 'Start' || abertos.includes(n.id);
    const pode = DV.abriveis(tab.nos, abertos).has(n.id);
    const c = DV.custo(n);
    const situacao = n.tipo === 'Start' ? 'o início do tabuleiro' : aberto ? 'aberto — clica para fechar' : pode ? 'pode abrir — clica para abrir' : 'fechado — abre primeiro um nó ao lado';
    $('#dzNo').innerHTML = `<div class="dz-no-cab">
        <i class="dv-no t-${esc(n.tipo)} g-${esc(String(n.grau || '').toLowerCase())} ${aberto ? 'aberto' : 'fechado'}"></i>
        <div><b>${esc(n.tipo === 'Start' ? tab.nome + ' — Início' : n.nome || TIPOS[n.tipo] || n.tipo)}</b>
        <div class="dim">${esc(TIPOS[n.tipo] || n.tipo)}${n.grau && n.tipo !== 'Start' ? ' · ' + esc(GRAUS[n.grau] || n.grau) : ''}</div></div>
      </div>
      ${n.efeitos.length ? `<ul class="dz-efeitos">${n.efeitos.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      <div class="dz-no-pe"><span>${esc(situacao)}</span>${n.tipo !== 'Start' ? `<span>custo <b>${c}</b> ${c === 1 ? 'cristal' : 'cristais'}</span>` : ''}</div>`;
  }

  $('#dzAbas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    st.tabAtual = Number(b.dataset.tab);
    st.noVisto = null;
    desenhar();
  });

  $('#dzGrelha').addEventListener('mouseover', (e) => {
    const no = e.target.closest('.dv-no');
    if (!no || !st.tabs || Number(no.dataset.no) === st.noVisto) return;
    st.noVisto = Number(no.dataset.no);
    for (const x of document.querySelectorAll('#dzGrelha .dv-no.visto')) x.classList.remove('visto');
    no.classList.add('visto');
    desenharNo(st.tabs.find((t) => t.id === st.tabAtual));
  });

  $('#dzGrelha').addEventListener('click', (e) => {
    const no = e.target.closest('.dv-no');
    if (!no || !st.tabs) return;
    const tab = st.tabs.find((t) => t.id === st.tabAtual);
    const id = Number(no.dataset.no);
    const dv = st.atual.daevanion;
    const abertos = dv[tab.id] || [];
    if (no.classList.contains('aberto') && !no.classList.contains('t-Start')) dv[tab.id] = DV.fechar(tab.nos, abertos, id);
    else if (no.classList.contains('pode')) dv[tab.id] = [...abertos, id];
    else return;
    if (!dv[tab.id].length) delete dv[tab.id];
    st.noVisto = id;
    marcarSujo();
    desenhar();
  });

  $('#dzLimpar').addEventListener('click', () => {
    if (!st.atual || !st.tabAtual || !st.atual.daevanion[st.tabAtual]) return;
    delete st.atual.daevanion[st.tabAtual];
    marcarSujo();
    desenhar();
  });
  $('#dzLimparTodos').addEventListener('click', () => {
    if (!st.atual || !Object.keys(st.atual.daevanion).length || !confirm('Fechar os nós de todos os tabuleiros deste plano?')) return;
    st.atual.daevanion = {};
    marcarSujo();
    desenhar();
  });

  // ── do meu personagem ────────────────────────────────────────────────────

  $('#dzMeu').addEventListener('click', () => {
    $('#dzPers').hidden = !$('#dzPers').hidden;
    if (!$('#dzPers').hidden) $('#dzPNome').focus();
  });

  async function procurar() {
    const nome = $('#dzPNome').value.trim();
    if (!nome) return $('#dzPNome').focus();
    const regiao = $('#dzPRegiao').value;
    window.api.mudarDefinicoes({ regiaoNC: regiao });
    $('#dzPResultados').innerHTML = '<p class="dim">A procurar…</p>';
    try {
      const r = await window.api.procurarPersonagem(nome, regiao);
      const exato = (x) => (x.nome.toLowerCase() === nome.toLowerCase() ? 0 : 1);
      r.sort((a, b) => exato(a) - exato(b) || b.nivel - a.nivel);
      $('#dzPResultados').innerHTML = r.length
        ? r
            .slice(0, 20)
            .map(
              (p) => `<button class="bl-pers" data-servidor="${p.servidor}" data-personagem="${esc(p.personagem)}" data-classe="${esc(p.classe || '')}" data-nome="${esc(p.nome)}">
                <b>${esc(p.nome)}</b> <span>nível ${p.nivel}</span> <span>${esc(p.classeTexto)}</span> <span class="dim">${esc(p.servidorNome)}</span></button>`,
            )
            .join('')
        : '<p class="dim">Ninguém com esse nome nessa região.</p>';
    } catch (e) {
      $('#dzPResultados').innerHTML = `<p class="erro">A pesquisa falhou: ${esc(e.message)}</p>`;
    }
  }
  $('#dzPProcurar').addEventListener('click', procurar);
  $('#dzPNome').addEventListener('keydown', (e) => e.key === 'Enter' && procurar());

  $('#dzPResultados').addEventListener('click', async (e) => {
    const b = e.target.closest('.bl-pers');
    if (!b) return;
    const classe = b.dataset.classe;
    if (classe && classe !== st.atual.classe) {
      if (!confirm(`Esse personagem é ${nomeClasse(classe)} e o plano é ${nomeClasse(st.atual.classe)}. Mudar o plano para ${nomeClasse(classe)}?`)) return;
      st.atual.classe = classe;
      $('#dzClasse').value = classe;
    }
    const ref = { servidor: Number(b.dataset.servidor), personagem: b.dataset.personagem, regiao: $('#dzPRegiao').value };
    $('#dzPResultados').innerHTML = '<p class="dim">A ler os tabuleiros do personagem…</p>';
    try {
      const f = await window.api.fichaPersonagem(ref);
      const dv = {};
      let n = 0;
      for (const t of f.tabuleiros.filter((x) => x.abertos > 0)) {
        const d = await window.api.tabuleiroPersonagem(ref, t.id);
        dv[t.id] = d.nos.filter((no) => no.aberto && no.tipo !== 'Start').map((no) => no.id);
        n += dv[t.id].length;
      }
      st.atual.daevanion = dv;
      if ($('#dzNome').value === 'Novo plano') $('#dzNome').value = `${b.dataset.nome} (atual)`;
      $('#dzPers').hidden = true;
      $('#dzPResultados').innerHTML = '';
      marcarSujo();
      estado(`Lidos ${n} nós abertos de ${esc(b.dataset.nome)}. Carrega em <b>Gravar</b> para os guardar neste plano.`);
      desenhar();
    } catch (e2) {
      $('#dzPResultados').innerHTML = `<p class="erro">Não consegui ler a ficha: ${esc(e2.message)}</p>`;
    }
  });

  // ── arranque ─────────────────────────────────────────────────────────────

  async function arrancar() {
    const [defs, limites] = await Promise.all([window.api.definicoes(), window.api.limitesBuilds()]);
    st.planos = Array.isArray(defs.planosDaevanion) ? defs.planosDaevanion : [];
    $('#dzPRegiao').innerHTML = Object.entries(limites.regioes)
      .map(([k, v]) => `<option value="${k}"${k === (defs.regiaoNC || 'eu') ? ' selected' : ''}>${esc(v)}</option>`)
      .join('');
    try {
      st.classes = (await window.api.classes()).dados;
    } catch (e) {
      st.classes = [];
      estado('Não consegui ler as classes no site da NC: ' + esc(e.message), true);
    }
    $('#dzClasse').innerHTML = st.classes.map((c) => `<option value="${esc(c.nome)}">${esc(c.texto)}</option>`).join('');
    desenharLista();
    if (st.planos.length) abrir(st.planos.slice().sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0))[0].id);
  }

  let pronto = null;
  /**
   * Um plano novo vindo de outra aba (Personagem: "Copiar Daevanion"): grava-o
   * logo e abre-o aqui. Se o plano aberto tinha mudanças por gravar, pergunta.
   */
  async function importar({ nome, classe, daevanion }, mensagem) {
    await pronto;
    if (!podeLargar()) return false;
    st.sujo = false;
    const p = { id: novoId(), nome, classe, daevanion: copia(daevanion), atualizado: Date.now() };
    st.planos.push(p);
    await window.api.mudarDefinicoes({ planosDaevanion: st.planos });
    document.querySelector('#abas [data-aba=daevanion]').click();
    abrir(p.id);
    if (mensagem) estado(mensagem);
    return true;
  }
  window.PlanosDaevanion = { importar };

  pronto = arrancar();
})();
