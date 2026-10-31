// A aba das builds de habilidades: a lista à esquerda, a build no meio (as
// habilidades da classe, a barra de atalhos, a prioridade, as macros) e a
// habilidade escolhida à direita (nível e especializações).
//
// A build só guarda ids; nomes e ícones vêm do catálogo da classe, pedido ao
// processo principal (que o tira da ficha oficial da NC e o guarda 7 dias).
(function () {
  'use strict';

  const { esc } = window.U;
  const $ = (s) => document.querySelector(s);

  const CAT_NOME = { Active: 'Ativas', Dp: 'Estigmas', Passive: 'Passivas' };
  const NA_BARRA = ['Active', 'Dp']; // as passivas não vão para a barra

  const st = {
    lista: [],
    atual: null,
    limites: null,
    classes: [],
    habs: [], // catálogo da classe da build atual
    porId: new Map(),
    classeCarregada: null,
    escolhida: null,
    arrasto: null, // { id, origem: 'paleta'|'casa'|'prio', i, cat }
    sub: 'hab', // sub-aba do editor: 'hab' ou 'dv'
    tabs: null, // tabuleiros Daevanion da classe carregada
    tabsClasse: null,
    tabAtual: null,
  };

  // ── guardar ──────────────────────────────────────────────────────────────

  let relogio = null;
  function agendarGravar() {
    clearTimeout(relogio);
    relogio = setTimeout(gravarJa, 400);
  }
  async function gravarJa() {
    clearTimeout(relogio);
    if (!st.atual) return;
    try {
      const g = await window.api.guardarBuild(st.atual);
      const i = st.lista.findIndex((b) => b.id === g.id);
      if (i >= 0) st.lista[i] = g;
      else st.lista.push(g);
      desenharLista();
    } catch (e) {
      estado(`Não consegui guardar: ${e.message}`, 'erro');
    }
  }

  function estado(txt, tipo) {
    const e = $('#blEstado');
    e.className = 'estado' + (tipo ? ' ' + tipo : '');
    e.innerHTML = txt || '';
  }

  // ── catálogo ─────────────────────────────────────────────────────────────

  function nomeClasse(nome) {
    const c = st.classes.find((x) => x.nome === nome);
    return c ? c.texto : nome;
  }

  async function carregarClasse(nome) {
    if (st.classeCarregada === nome) return;
    st.habs = [];
    st.porId = new Map();
    st.classeCarregada = null;
    $('#blPaleta').innerHTML = '<p class="dim pad">A ler as habilidades no site da NC…</p>';
    try {
      const r = await window.api.habilidades(nome);
      st.habs = r.dados;
      st.porId = new Map(r.dados.map((h) => [h.id, h]));
      st.classeCarregada = nome;
      if (r.erro) estado(`O site da NC não respondeu; a usar as habilidades guardadas ${window.U.idade(r.idadeMs)}.`, 'aviso');
    } catch (e) {
      $('#blPaleta').innerHTML = `<p class="erro pad">Não consegui ler as habilidades: ${esc(e.message)}</p>`;
      throw e;
    }
  }

  // ── peças ────────────────────────────────────────────────────────────────

  function icone(url) {
    return /^https:\/\/assets\.playnccdn\.com\//.test(url || '') ? url : '';
  }

  function nivelDe(id) {
    return (st.atual.niveis && st.atual.niveis[id]) || null;
  }

  /** Um ícone de habilidade com o nível (em baixo) e as especializações (◆ em cima). */
  function peca(id, { origem, i, extra = '' } = {}) {
    const h = st.porId.get(id);
    if (!h) return `<div class="bl-hab desconhecida" title="Habilidade ${id}: não existe nesta classe (mudou com uma atualização?)" draggable="true" data-id="${id}" data-origem="${origem}"${i != null ? ` data-i="${i}"` : ''}>?</div>`;
    const n = nivelDe(id);
    const sel = st.escolhida === id ? ' sel' : '';
    const titulo = `${h.nome} · ${CAT_NOME[h.categoria] || h.categoria} · nível ${h.nivelNecessario}+`;
    return `<div class="bl-hab cat-${esc(h.categoria)}${sel}${extra}" draggable="true" title="${esc(titulo)}" data-id="${id}" data-origem="${origem}"${i != null ? ` data-i="${i}"` : ''}>
      <img src="${esc(icone(h.icone))}" alt="" draggable="false" />
      ${n && n.espec ? `<span class="espec">${'◆'.repeat(n.espec)}</span>` : ''}
      ${n ? `<span class="niv">${n.nivel}</span>` : ''}
    </div>`;
  }

  // ── desenhar ─────────────────────────────────────────────────────────────

  function desenharLista() {
    $('#blConta').textContent = `(${st.lista.length})`;
    const ordenadas = [...st.lista].sort((a, b) => b.mudada - a.mudada);
    $('#blLista').innerHTML = ordenadas
      .map(
        (b) => `<div class="bl-item${st.atual && st.atual.id === b.id ? ' on' : ''}" data-id="${esc(b.id)}">
          <div class="nome">${esc(b.nome)}</div>
          <div class="sub"><span>${esc(nomeClasse(b.classe))}</span>${b.etiqueta ? `<span class="etq">${esc(b.etiqueta)}</span>` : ''}</div>
        </div>`,
      )
      .join('');
    $('#blVazio').hidden = !!st.atual;
    $('#blEditor').hidden = !st.atual;
  }

  function desenharTopo() {
    const b = st.atual;
    $('#blNome').value = b.nome;
    $('#blEtiqueta').value = b.etiqueta || '';
    $('#blNotas').value = b.notas || '';
    $('#blClasse').innerHTML = st.classes.map((c) => `<option value="${esc(c.nome)}"${c.nome === b.classe ? ' selected' : ''}>${esc(c.texto)}</option>`).join('');
  }

  function desenharPaleta() {
    const naBarra = new Set(st.atual.barra.filter(Boolean));
    $('#blPaleta').innerHTML = ['Active', 'Dp', 'Passive']
      .map((cat) => {
        const hs = st.habs.filter((h) => h.categoria === cat);
        if (!hs.length) return '';
        return `<div class="bl-linha"><div class="rot">${CAT_NOME[cat]}</div><div class="pecas">${hs
          // Esbatidas só as que não entram na build (sem nível e fora da barra); as da barra levam uma marca no canto.
          .map((h) => peca(h.id, { origem: 'paleta', extra: naBarra.has(h.id) ? ' na-barra' : nivelDe(h.id) ? '' : ' sem-nivel' }))
          .join('')}</div></div>`;
      })
      .join('');
  }

  function desenharBarra() {
    const { barras, casas } = st.limites;
    let html = '';
    for (let r = 0; r < barras; r++) {
      for (let c = 0; c < casas; c++) {
        const i = r * casas + c;
        const id = st.atual.barra[i];
        html += `<div class="bl-casa" data-i="${i}">${id ? peca(id, { origem: 'casa', i }) : ''}</div>`;
      }
    }
    for (let c = 0; c < casas; c++) html += `<div class="bl-num">${c + 1}</div>`;
    $('#blBarra').style.setProperty('--casas', casas);
    $('#blBarra').innerHTML = html;
  }

  function desenharPrioridade() {
    $('#blPrioridade').innerHTML = ['Active', 'Dp', 'Passive']
      .map(
        (cat) => `<div class="bl-prio" data-cat="${cat}">
          <div class="rot">${CAT_NOME[cat]}</div>
          <div class="cadeia">${st.atual.prioridade[cat]
            .map((id, i) => `${i ? '<span class="seta">›</span>' : ''}${peca(id, { origem: 'prio', i })}`)
            .join('')}<button class="bl-mais" data-cat="${cat}" title="Juntar a habilidade escolhida">+</button></div>
        </div>`,
      )
      .join('');
  }

  function desenharMacros() {
    const ms = st.atual.macros;
    $('#blMacros').innerHTML = ms.length
      ? ms
          .map(
            (m, i) => `<div class="bl-macro" data-i="${i}">
              <input class="m-nome" type="text" maxlength="60" placeholder="nome" value="${esc(m.nome)}" />
              <textarea class="m-texto" rows="2" maxlength="2000" placeholder="o que a macro faz, passo a passo">${esc(m.texto)}</textarea>
              <button class="m-apagar mini perigo" title="Apagar esta macro">✕</button>
            </div>`,
          )
          .join('')
      : '<p class="dim">Sem macros.</p>';
  }

  function desenharPainel() {
    const p = $('#blPainel');
    const h = st.escolhida != null && st.porId.get(st.escolhida);
    if (!st.atual || !h) {
      p.innerHTML = '<p class="dica">Escolhe uma habilidade para lhe dar o nível e as especializações.</p>';
      return;
    }
    const n = nivelDe(h.id);
    const { nivelMax, especMax } = st.limites;
    const naBarra = st.atual.barra.includes(h.id);
    const naPrio = st.atual.prioridade[h.categoria].includes(h.id);
    let diamantes = '';
    for (let k = 1; k <= especMax; k++) {
      diamantes += `<button class="diam${n && n.espec >= k ? ' on' : ''}" data-espec="${k}" title="${k} especializaç${k > 1 ? 'ões' : 'ão'}">◆</button>`;
    }
    p.innerHTML = `
      <div class="cab">
        <img src="${esc(icone(h.icone))}" alt="" />
        <div><h2>${esc(h.nome)}</h2><div class="sub">${CAT_NOME[h.categoria] || esc(h.categoria)} · aprende-se ao nível ${h.nivelNecessario}</div></div>
      </div>
      <h3>Nível</h3>
      <div class="bl-nivel">
        <button data-passo="-1">−</button>
        <input id="blNivel" type="number" title="0 = sem nível" min="0" max="${nivelMax}" value="${n ? n.nivel : 0}" />
        <button data-passo="1">+</button>
      </div>
      <h3>Especializações</h3>
      <div class="bl-diams">${diamantes}<button class="diam-zero" data-espec="0" title="Nenhuma">limpar</button></div>
      <h3>Nesta build</h3>
      <div class="bl-painel-acoes">
        ${NA_BARRA.includes(h.categoria) ? `<button data-acao="barra">${naBarra ? 'Tirar da barra' : 'Pôr na barra'}</button>` : '<span class="dim">As passivas não vão para a barra.</span>'}
        <button data-acao="prio">${naPrio ? 'Tirar da prioridade' : 'Juntar à prioridade'}</button>
      </div>`;
  }

  function desenharTudo() {
    desenharLista();
    if (!st.atual) {
      desenharPainel();
      return;
    }
    desenharTopo();
    desenharPaleta();
    desenharBarra();
    desenharPrioridade();
    desenharMacros();
    desenharPainel();
  }

  /** Depois de mexer em habilidades: tudo o que mostra ícones. */
  function mudou() {
    desenharPaleta();
    desenharBarra();
    desenharPrioridade();
    desenharPainel();
    agendarGravar();
  }

  // ── ações sobre a build ──────────────────────────────────────────────────

  async function abrir(id) {
    await gravarJa();
    st.atual = st.lista.find((b) => b.id === id) || null;
    st.escolhida = null;
    estado('');
    $('#blPersonagem').hidden = true;
    desenharLista();
    if (!st.atual) return desenharTudo();
    desenharTopo();
    try {
      await carregarClasse(st.atual.classe);
    } catch {
      return;
    }
    desenharTudo();
    if (st.sub === 'dv') desenharDv();
  }

  function porNaBarra(id, i) {
    const h = st.porId.get(id);
    if (!h || !NA_BARRA.includes(h.categoria)) return false;
    const barra = st.atual.barra;
    if (i == null) {
      if (barra.includes(id)) return false;
      i = barra.indexOf(null);
      if (i < 0) {
        estado('A barra está cheia.', 'aviso');
        return false;
      }
    }
    // Cada habilidade só pode estar numa casa: se já estava noutra, muda-se.
    const antes = barra.indexOf(id);
    if (antes >= 0) barra[antes] = null;
    barra[i] = id;
    if (!nivelDe(id)) st.atual.niveis[id] = { nivel: 1, espec: 0 };
    return true;
  }

  function juntarPrioridade(id, antesDe) {
    const h = st.porId.get(id);
    if (!h) return false;
    const l = st.atual.prioridade[h.categoria];
    const j = l.indexOf(id);
    if (j >= 0) l.splice(j, 1);
    const pos = antesDe == null ? l.length : Math.min(antesDe - (j >= 0 && j < antesDe ? 1 : 0), l.length);
    l.splice(pos, 0, id);
    return true;
  }

  function escolher(id) {
    st.escolhida = id;
    desenharPaleta();
    desenharBarra();
    desenharPrioridade();
    desenharPainel();
  }

  async function novaBuild() {
    await gravarJa();
    const classe = (st.atual && st.atual.classe) || (st.classes[0] && st.classes[0].nome) || 'Gladiator';
    const b = await window.api.novaBuild(classe);
    st.lista.push(b);
    await abrir(b.id);
    $('#blNome').focus();
    $('#blNome').select();
  }

  // ── eventos: lista e topo ────────────────────────────────────────────────

  $('#blLista').addEventListener('click', (e) => {
    const d = e.target.closest('.bl-item');
    if (d) abrir(d.dataset.id);
  });
  $('#btnNovaBuild').addEventListener('click', () => novaBuild().catch((e) => alert(e.message)));

  $('#btnColarBuild').addEventListener('click', () => {
    if ($('#blColar')) return $('#blColar textarea').focus();
    const d = document.createElement('div');
    d.id = 'blColar';
    d.className = 'bl-colar';
    d.innerHTML = `<textarea rows="3" placeholder="cola aqui o código (AH1:…)"></textarea>
      <div class="bl-botoes"><button class="primario">Abrir</button><button>Cancelar</button></div><div class="erro"></div>`;
    // Há outra .bl-lista na aba Daevanion (escondida): tem de ser a desta aba.
    $('#builds .bl-lista').insertBefore(d, $('#builds .bl-lista .bl-botoes'));
    const [abrirB, cancelar] = d.querySelectorAll('button');
    cancelar.addEventListener('click', () => d.remove());
    abrirB.addEventListener('click', async () => {
      try {
        const b = await window.api.importarBuild(d.querySelector('textarea').value);
        st.lista.push(b);
        d.remove();
        await abrir(b.id);
        estado('Build aberta a partir do código. Já está guardada nas tuas.');
      } catch (e) {
        d.querySelector('.erro').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      }
    });
    d.querySelector('textarea').focus();
  });

  $('#blNome').addEventListener('input', (e) => {
    st.atual.nome = e.target.value;
    agendarGravar();
  });
  $('#blEtiqueta').addEventListener('input', (e) => {
    st.atual.etiqueta = e.target.value;
    agendarGravar();
  });
  $('#blNotas').addEventListener('input', (e) => {
    st.atual.notas = e.target.value;
    agendarGravar();
  });

  $('#blClasse').addEventListener('change', async (e) => {
    const b = st.atual;
    const temAlgo = b.barra.some(Boolean) || Object.keys(b.niveis).length;
    if (temAlgo && !confirm(`Mudar para ${nomeClasse(e.target.value)}? As habilidades desta build são de outra classe e saem todas.`)) {
      e.target.value = b.classe;
      return;
    }
    b.classe = e.target.value;
    b.barra = b.barra.map(() => null);
    b.niveis = {};
    b.prioridade = { Active: [], Dp: [], Passive: [] };
    b.daevanion = {};
    st.escolhida = null;
    agendarGravar();
    try {
      await carregarClasse(b.classe);
    } catch {
      return;
    }
    desenharTudo();
  });

  $('#btnPartilhar').addEventListener('click', async () => {
    await gravarJa();
    const codigo = await window.api.exportarBuild(st.atual);
    await window.api.escreverClipboard(codigo);
    estado(`Código copiado (${codigo.length} caracteres). Quem o colar em <b>Colar código</b> fica com esta build, com os nomes no idioma do jogo dele.`);
  });

  $('#btnDuplicar').addEventListener('click', async () => {
    await gravarJa();
    const copia = JSON.parse(JSON.stringify(st.atual));
    delete copia.id;
    copia.nome = `${st.atual.nome} (cópia)`;
    const g = await window.api.guardarBuild(copia);
    st.lista.push(g);
    await abrir(g.id);
  });

  $('#btnApagarBuild').addEventListener('click', async () => {
    if (!confirm(`Apagar a build "${st.atual.nome}"? Não dá para desfazer.`)) return;
    clearTimeout(relogio);
    st.lista = await window.api.apagarBuild(st.atual.id);
    st.atual = null;
    const prox = [...st.lista].sort((a, b) => b.mudada - a.mudada)[0];
    if (prox) abrir(prox.id);
    else desenharTudo();
  });

  // ── eventos: escolher, pôr e tirar ───────────────────────────────────────

  $('#blEditor').addEventListener('click', (e) => {
    const p = e.target.closest('.bl-hab');
    if (p) return escolher(Number(p.dataset.id));
    const mais = e.target.closest('.bl-mais');
    if (mais) {
      const h = st.porId.get(st.escolhida);
      if (!h) return estado('Escolhe primeiro uma habilidade (clica num ícone).', 'aviso');
      if (h.categoria !== mais.dataset.cat) return estado(`${esc(h.nome)} é das ${CAT_NOME[h.categoria]}, não das ${CAT_NOME[mais.dataset.cat]}.`, 'aviso');
      if (juntarPrioridade(h.id)) mudou();
    }
  });

  $('#blEditor').addEventListener('dblclick', (e) => {
    const p = e.target.closest('.bl-hab');
    if (!p) return;
    const id = Number(p.dataset.id);
    if (p.dataset.origem === 'paleta') {
      if (st.porId.get(id).categoria === 'Passive') return juntarPrioridade(id) && mudou();
      if (porNaBarra(id)) mudou();
    } else if (p.dataset.origem === 'casa') {
      st.atual.barra[Number(p.dataset.i)] = null;
      mudou();
    }
  });

  $('#blEditor').addEventListener('contextmenu', (e) => {
    const p = e.target.closest('.bl-hab');
    if (!p) return;
    e.preventDefault();
    tirar(p);
  });

  function tirar(p) {
    const id = Number(p.dataset.id);
    if (p.dataset.origem === 'casa') st.atual.barra[Number(p.dataset.i)] = null;
    else if (p.dataset.origem === 'prio') {
      const cat = p.closest('.bl-prio').dataset.cat;
      st.atual.prioridade[cat].splice(Number(p.dataset.i), 1);
    } else return;
    if (st.escolhida === id) desenharPainel();
    mudou();
  }

  // ── arrastar ─────────────────────────────────────────────────────────────

  $('#blEditor').addEventListener('dragstart', (e) => {
    const p = e.target.closest('.bl-hab');
    if (!p) return;
    st.arrasto = { id: Number(p.dataset.id), origem: p.dataset.origem, i: p.dataset.i != null ? Number(p.dataset.i) : null, el: p };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', p.dataset.id);
  });

  $('#blEditor').addEventListener('dragend', (e) => {
    // Largada fora de qualquer alvo: tira da barra ou da prioridade.
    const a = st.arrasto;
    st.arrasto = null;
    document.querySelectorAll('.alvo').forEach((x) => x.classList.remove('alvo'));
    if (a && e.dataTransfer.dropEffect === 'none' && (a.origem === 'casa' || a.origem === 'prio')) tirar(a.el);
  });

  function alvoDe(e) {
    const a = st.arrasto;
    if (!a) return null;
    const h = st.porId.get(a.id);
    const casa = e.target.closest('.bl-casa');
    if (casa && h && NA_BARRA.includes(h.categoria) && a.origem !== 'prio') return casa;
    const prio = e.target.closest('.bl-prio');
    if (prio && h && prio.dataset.cat === h.categoria && a.origem !== 'casa') return prio;
    return null;
  }

  $('#blEditor').addEventListener('dragover', (e) => {
    const alvo = alvoDe(e);
    document.querySelectorAll('.alvo').forEach((x) => x !== alvo && x.classList.remove('alvo'));
    if (!alvo) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    alvo.classList.add('alvo');
  });

  $('#blEditor').addEventListener('drop', (e) => {
    const alvo = alvoDe(e);
    const a = st.arrasto;
    if (!alvo || !a) return;
    e.preventDefault();
    alvo.classList.remove('alvo');
    if (alvo.classList.contains('bl-casa')) {
      const i = Number(alvo.dataset.i);
      const barra = st.atual.barra;
      if (a.origem === 'casa') {
        // De uma casa para outra: trocam.
        [barra[i], barra[a.i]] = [barra[a.i], barra[i]];
      } else porNaBarra(a.id, i);
    } else {
      const sobre = e.target.closest('.bl-hab[data-origem=prio]');
      juntarPrioridade(a.id, sobre ? Number(sobre.dataset.i) : null);
    }
    mudou();
  });

  // ── painel da habilidade ─────────────────────────────────────────────────

  function mudarNivel(nivel, espec) {
    const id = st.escolhida;
    const n = nivelDe(id) || { nivel: 0, espec: 0 };
    if (nivel != null) n.nivel = Math.max(0, Math.min(st.limites.nivelMax, Math.round(nivel) || 0));
    if (espec != null) n.espec = espec;
    if (n.nivel === 0 && n.espec === 0) delete st.atual.niveis[id];
    else st.atual.niveis[id] = { nivel: Math.max(1, n.nivel), espec: n.espec };
    desenharPaleta();
    desenharBarra();
    desenharPrioridade();
    agendarGravar();
  }

  $('#blPainel').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !st.atual) return;
    if (b.dataset.passo) {
      const inp = $('#blNivel');
      inp.value = Math.max(0, Math.min(st.limites.nivelMax, Number(inp.value) + Number(b.dataset.passo)));
      mudarNivel(Number(inp.value), null);
    } else if (b.dataset.espec != null) {
      const k = Number(b.dataset.espec);
      const n = nivelDe(st.escolhida);
      // Clicar no último diamante aceso apaga-o (de 2 para 1), como num seletor de estrelas.
      mudarNivel(n ? null : 1, n && n.espec === k ? k - 1 : k);
      desenharPainel();
    } else if (b.dataset.acao === 'barra') {
      const i = st.atual.barra.indexOf(st.escolhida);
      if (i >= 0) st.atual.barra[i] = null;
      else porNaBarra(st.escolhida);
      mudou();
    } else if (b.dataset.acao === 'prio') {
      const l = st.atual.prioridade[st.porId.get(st.escolhida).categoria];
      const i = l.indexOf(st.escolhida);
      if (i >= 0) l.splice(i, 1);
      else juntarPrioridade(st.escolhida);
      mudou();
    }
  });
  $('#blPainel').addEventListener('input', (e) => {
    if (e.target.id === 'blNivel') mudarNivel(Number(e.target.value), null);
  });

  // ── macros ───────────────────────────────────────────────────────────────

  $('#btnNovaMacro').addEventListener('click', () => {
    st.atual.macros.push({ nome: '', texto: '' });
    desenharMacros();
    agendarGravar();
    const ns = document.querySelectorAll('#blMacros .m-nome');
    ns[ns.length - 1].focus();
  });
  $('#blMacros').addEventListener('input', (e) => {
    const d = e.target.closest('.bl-macro');
    if (!d) return;
    const m = st.atual.macros[Number(d.dataset.i)];
    if (e.target.classList.contains('m-nome')) m.nome = e.target.value;
    else m.texto = e.target.value;
    agendarGravar();
  });
  $('#blMacros').addEventListener('click', (e) => {
    const b = e.target.closest('.m-apagar');
    if (!b) return;
    st.atual.macros.splice(Number(b.closest('.bl-macro').dataset.i), 1);
    desenharMacros();
    agendarGravar();
  });

  // ── do meu personagem ────────────────────────────────────────────────────

  $('#btnImportarPersonagem').addEventListener('click', () => {
    $('#blPersonagem').hidden = !$('#blPersonagem').hidden;
    if (!$('#blPersonagem').hidden) $('#blPNome').focus();
  });
  $('#btnPFechar').addEventListener('click', () => ($('#blPersonagem').hidden = true));

  async function procurar() {
    const nome = $('#blPNome').value.trim();
    if (!nome) return $('#blPNome').focus();
    const regiao = $('#blPRegiao').value;
    window.api.mudarDefinicoes({ regiaoNC: regiao });
    $('#blPResultados').innerHTML = '<p class="dim">A procurar…</p>';
    try {
      const r = await window.api.procurarPersonagem(nome, regiao);
      // A pesquisa é por "contém"; os nomes exatos primeiro, depois os de nível mais alto.
      const exato = (x) => (x.nome.toLowerCase() === nome.toLowerCase() ? 0 : 1);
      r.sort((a, b) => exato(a) - exato(b) || b.nivel - a.nivel);
      $('#blPResultados').innerHTML = r.length
        ? r
            .slice(0, 20)
            .map(
              (p) => `<button class="bl-pers" data-servidor="${p.servidor}" data-personagem="${esc(p.personagem)}" data-classe="${esc(p.classe || '')}">
                <b>${esc(p.nome)}</b> <span>nível ${p.nivel}</span> <span>${esc(p.classeTexto)}</span> <span class="dim">${esc(p.servidorNome)} · ${p.raca === 1 ? 'Elyos' : 'Asmodiano'}</span>
              </button>`,
            )
            .join('')
        : '<p class="dim">Ninguém com esse nome nessa região.</p>';
    } catch (e) {
      $('#blPResultados').innerHTML = `<p class="erro">A pesquisa falhou: ${esc(e.message)}</p>`;
    }
  }
  $('#btnPProcurar').addEventListener('click', procurar);
  $('#blPNome').addEventListener('keydown', (e) => e.key === 'Enter' && procurar());

  $('#blPResultados').addEventListener('click', async (e) => {
    const b = e.target.closest('.bl-pers');
    if (!b) return;
    const classe = b.dataset.classe;
    const build = st.atual;
    if (classe && classe !== build.classe) {
      if (!confirm(`Esse personagem é ${nomeClasse(classe)} e a build é ${nomeClasse(build.classe)}. Mudar a build para ${nomeClasse(classe)}? A barra e as prioridades ficam vazias.`)) return;
      build.classe = classe;
      build.barra = build.barra.map(() => null);
      build.niveis = {};
      build.prioridade = { Active: [], Dp: [], Passive: [] };
      build.daevanion = {};
      await carregarClasse(classe);
    }
    $('#blPResultados').innerHTML = '<p class="dim">A ler a ficha…</p>';
    try {
      const habs = await window.api.habilidadesDoPersonagem({ servidor: Number(b.dataset.servidor), personagem: b.dataset.personagem, regiao: $('#blPRegiao').value });
      let n = 0;
      for (const h of habs) {
        if (!h.nivel) continue;
        const antes = build.niveis[h.id];
        build.niveis[h.id] = { nivel: Math.min(st.limites.nivelMax, h.nivel), espec: antes ? antes.espec : 0 };
        n++;
      }
      // O que a ficha diz dos estigmas equipados vai para a prioridade, se estiver vazia.
      const equipados = habs.filter((h) => h.categoria === 'Dp' && h.equipada).map((h) => h.id);
      if (!build.prioridade.Dp.length) build.prioridade.Dp = equipados.filter((id) => st.porId.has(id));
      const nomes = equipados.map((id) => (st.porId.get(id) || {}).nome).filter(Boolean);
      // E o Daevanion: os nós abertos de cada tabuleiro.
      const ref = { servidor: Number(b.dataset.servidor), personagem: b.dataset.personagem, regiao: $('#blPRegiao').value };
      let nosDv = 0;
      try {
        const f = await window.api.fichaPersonagem(ref);
        build.daevanion = {};
        for (const t of f.tabuleiros.filter((x) => x.abertos > 0)) {
          const d = await window.api.tabuleiroPersonagem(ref, t.id);
          build.daevanion[t.id] = d.nos.filter((no) => no.aberto && no.tipo !== 'Start').map((no) => no.id);
          nosDv += build.daevanion[t.id].length;
        }
      } catch {
        nosDv = -1;
      }
      $('#blPersonagem').hidden = true;
      $('#blPResultados').innerHTML = '';
      desenharTudo();
      agendarGravar();
      estado(`Lidos os níveis de ${n} habilidades${nosDv > 0 ? ` e ${nosDv} nós do Daevanion` : nosDv < 0 ? ' (o Daevanion não veio)' : ''}.${nomes.length ? ` Estigmas equipados: <b>${nomes.map(esc).join(', ')}</b>.` : ''} A ficha não diz as especializações, a barra nem a ordem de prioridade: essas ficam como estavam.`);
    } catch (err) {
      $('#blPResultados').innerHTML = `<p class="erro">Não consegui ler a ficha: ${esc(err.message)}</p>`;
    }
  });

  // ── Daevanion ────────────────────────────────────────────────────────────

  $('#blSub').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sub]');
    if (!b) return;
    st.sub = b.dataset.sub;
    for (const x of document.querySelectorAll('#blSub button')) x.classList.toggle('on', x === b);
    $('#blSubHab').hidden = st.sub !== 'hab';
    $('#blSubDv').hidden = st.sub !== 'dv';
    $('#blPainel').hidden = st.sub !== 'hab';
    if (st.sub === 'dv') desenharDv();
  });

  async function desenharDv() {
    if (!st.atual) return;
    const classe = st.atual.classe;
    if (st.tabsClasse !== classe) {
      st.tabs = null;
      $('#dvAbas').innerHTML = '';
      $('#dvGrelha').innerHTML = '<p class="dim pad">A ler os tabuleiros no site da NC… (da primeira vez demora uns segundos)</p>';
      try {
        const r = await window.api.tabuleiros(classe);
        if (!st.atual || st.atual.classe !== classe) return;
        st.tabs = r.dados;
        st.tabsClasse = classe;
        if (!st.tabs.some((t) => t.id === st.tabAtual)) st.tabAtual = st.tabs[0] && st.tabs[0].id;
      } catch (e) {
        $('#dvGrelha').innerHTML = `<p class="erro pad">Não consegui ler os tabuleiros: ${esc(e.message)}</p>`;
        return;
      }
    }
    const dv = st.atual.daevanion || (st.atual.daevanion = {});
    $('#dvAbas').innerHTML = st.tabs
      .map((t) => {
        const n = (dv[t.id] || []).length;
        const total = t.nos.filter((x) => x.tipo !== 'Start').length;
        const g = window.Daevanion.gastoTabuleiro(t, dv[t.id] || []);
        return `<button data-tab="${t.id}" class="${t.id === st.tabAtual ? 'on' : ''}" title="${esc(g.cristal)}: ${g.gasto} de ${g.total}"><img src="${esc(window.UI.icone(t.icone))}" alt="" /> ${esc(t.nome)} <small>${n}/${total} · ${g.gasto}◆</small></button>`;
      })
      .join('');
    const tab = st.tabs.find((t) => t.id === st.tabAtual);
    $('#dvGrelha').innerHTML = tab ? window.UI.grelha(tab, dv[tab.id] || [], { editavel: true }) : '';
    $('#dvResumo').innerHTML = window.UI.resumo(st.tabs, dv);
  }

  $('#dvAbas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    st.tabAtual = Number(b.dataset.tab);
    desenharDv();
  });

  $('#dvGrelha').addEventListener('click', (e) => {
    const no = e.target.closest('.dv-no');
    if (!no || !st.tabs) return;
    const tab = st.tabs.find((t) => t.id === st.tabAtual);
    const id = Number(no.dataset.no);
    const dv = st.atual.daevanion;
    const abertos = dv[tab.id] || [];
    if (no.classList.contains('aberto') && !no.classList.contains('t-Start')) dv[tab.id] = window.Daevanion.fechar(tab.nos, abertos, id);
    else if (no.classList.contains('pode')) dv[tab.id] = [...abertos, id];
    else return;
    if (!dv[tab.id].length) delete dv[tab.id];
    desenharDv();
    agendarGravar();
  });

  $('#dvLimparTodos').addEventListener('click', () => {
    if (!st.atual) return;
    st.atual.daevanion = {};
    desenharDv();
    agendarGravar();
  });

  $('#dvLimpar').addEventListener('click', () => {
    if (!st.atual || !st.tabAtual) return;
    delete st.atual.daevanion[st.tabAtual];
    desenharDv();
    agendarGravar();
  });

  // ── arranque ─────────────────────────────────────────────────────────────

  async function arrancar() {
    const [lista, limites, defs] = await Promise.all([window.api.builds(), window.api.limitesBuilds(), window.api.definicoes()]);
    st.lista = lista;
    st.limites = limites;
    $('#blPRegiao').innerHTML = Object.entries(limites.regioes)
      .map(([k, v]) => `<option value="${k}"${k === (defs.regiaoNC || 'eu') ? ' selected' : ''}>${esc(v)}</option>`)
      .join('');
    try {
      st.classes = (await window.api.classes()).dados;
    } catch (e) {
      st.classes = [];
      estado(`Não consegui ler as classes no site da NC: ${esc(e.message)}`, 'erro');
    }
    desenharLista();
    const ultima = [...st.lista].sort((a, b) => b.mudada - a.mudada)[0];
    if (ultima) await abrir(ultima.id);
  }

  // Só quando se abre a aba pela primeira vez: não vale a pena ir à NC sem ninguém a olhar.
  let arrancou = false;
  document.querySelector('#abas [data-aba=builds]').addEventListener('click', () => {
    if (arrancou) return;
    arrancou = true;
    arrancar().catch((e) => estado(esc(e.message), 'erro'));
  });
  window.addEventListener('beforeunload', () => gravarJa());

  window.Builds = {
    estado: () => st,
    /** Abre a aba numa build já guardada (a aba Personagem cria builds). */
    abrirBuild: async (b, mensagem) => {
      document.querySelector('#abas [data-aba=builds]').click();
      for (let i = 0; i < 100 && !st.limites; i++) await new Promise((r) => setTimeout(r, 100));
      if (!st.limites) return;
      if (!st.lista.some((x) => x.id === b.id)) st.lista.push(b);
      await abrir(b.id);
      if (mensagem) estado(mensagem);
    },
  };
})();
