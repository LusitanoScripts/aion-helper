// A aba Personagem: procurar alguém pelo nome e ver a ficha oficial — perfil,
// atributos, equipamento (com o detalhe de cada peça à direita), habilidades,
// Daevanion, títulos, asas e mascote. "Criar build" leva tudo para a aba Builds.
(function () {
  'use strict';

  const { esc } = window.U;
  const $ = (s) => document.querySelector(s);
  const { icone, GRAU_COR } = window.UI;

  const CASAS = {
    MainHand: 'Arma', SubHand: 'Mão secundária',
    Helmet: 'Elmo', Shoulder: 'Ombros', Torso: 'Peito', Pants: 'Pernas', Gloves: 'Luvas', Boots: 'Botas', Cape: 'Capa',
    Necklace: 'Colar', Earring1: 'Brinco', Earring2: 'Brinco', Ring1: 'Anel', Ring2: 'Anel', Bracelet1: 'Bracelete', Bracelet2: 'Bracelete',
    Belt: 'Cinto', Amulet: 'Amuleto', Brooch: 'Broche', Seal: 'Selo',
  };
  const GRUPOS = [
    ['Armas', ['MainHand', 'SubHand']],
    ['Armadura', ['Helmet', 'Shoulder', 'Torso', 'Pants', 'Gloves', 'Boots', 'Cape']],
    ['Acessórios', ['Necklace', 'Earring1', 'Earring2', 'Ring1', 'Ring2', 'Bracelet1', 'Bracelet2', 'Belt', 'Amulet', 'Brooch', 'Seal']],
  ];
  const CAT_NOME = { Active: 'Ativas', Dp: 'Estigmas', Passive: 'Passivas' };

  const st = { ficha: null, ref: null, tabs: [], abertos: {}, tabAtual: null, classes: null };

  function estado(txt, tipo) {
    const e = $('#peEstado');
    e.className = 'estado' + (tipo ? ' ' + tipo : '');
    e.innerHTML = txt || '';
  }
  const semPrefixo = (m) => String(m || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ── procurar ─────────────────────────────────────────────────────────────

  async function procurar() {
    const nome = $('#peNome').value.trim();
    if (!nome) return $('#peNome').focus();
    const regiao = $('#peRegiao').value;
    window.api.mudarDefinicoes({ regiaoNC: regiao });
    $('#peResultados').innerHTML = '<p class="dim">A procurar…</p>';
    try {
      const r = await window.api.procurarPersonagem(nome, regiao);
      const exato = (x) => (x.nome.toLowerCase() === nome.toLowerCase() ? 0 : 1);
      r.sort((a, b) => exato(a) - exato(b) || b.nivel - a.nivel);
      if (r.length === 1) return abrir(r[0]);
      $('#peResultados').innerHTML = r.length
        ? r
            .slice(0, 24)
            .map(
              (p) => `<button class="bl-pers" data-servidor="${p.servidor}" data-personagem="${esc(p.personagem)}">
                <b>${esc(p.nome)}</b> <span>nível ${p.nivel}</span> <span>${esc(p.classeTexto)}</span> <span class="dim">${esc(p.servidorNome)} · ${p.raca === 1 ? 'Elyos' : 'Asmodiano'}</span>
              </button>`,
            )
            .join('')
        : '<p class="dim">Ninguém com esse nome nessa região.</p>';
    } catch (e) {
      $('#peResultados').innerHTML = `<p class="erro">A pesquisa falhou: ${esc(semPrefixo(e.message))}</p>`;
    }
  }

  $('#peProcurar').addEventListener('click', procurar);
  $('#peNome').addEventListener('keydown', (e) => e.key === 'Enter' && procurar());
  $('#peResultados').addEventListener('click', (e) => {
    const b = e.target.closest('.bl-pers');
    if (b) abrir({ servidor: Number(b.dataset.servidor), personagem: b.dataset.personagem });
  });

  // ── ficha ────────────────────────────────────────────────────────────────

  async function abrir(p) {
    $('#peResultados').innerHTML = '';
    st.ref = { servidor: p.servidor, personagem: p.personagem, regiao: $('#peRegiao').value };
    st.tabs = [];
    st.abertos = {};
    estado('A ler a ficha… (a NC anda instável: pode levar até meio minuto)');
    $('#peDetalhe').className = 'detalhe vazio';
    $('#peDetalhe').innerHTML = '<p class="dica">Clica numa peça de equipamento para a ver.</p>';
    try {
      st.ficha = await window.api.fichaPersonagem(st.ref);
    } catch (e) {
      estado(`Não consegui ler a ficha: ${esc(semPrefixo(e.message))}`, 'erro');
      return;
    }
    estado('');
    desenhar();
    // Os tabuleiros com alguma coisa aberta, um a um (são 5 pedidos no máximo).
    // Copiar o Daevanion ou criar a build espera por todos (st.dvPronto): antes
    // copiava-se só o que já tinha chegado.
    const ref = st.ref;
    let acabou;
    st.dvPronto = new Promise((r) => (acabou = r));
    try {
      await lerTabuleiros(ref);
    } finally {
      acabou();
    }
  }

  async function lerTabuleiros(ref) {
    for (const t of st.ficha.tabuleiros.filter((x) => x.abertos > 0)) {
      try {
        const d = await window.api.tabuleiroPersonagem(ref, t.id);
        if (st.ref !== ref) return;
        st.tabs.push({ id: t.id, nome: t.nome, icone: t.icone, nos: d.nos });
        st.abertos[t.id] = d.nos.filter((n) => n.aberto && n.tipo !== 'Start').map((n) => n.id);
        if (!st.tabAtual || !st.tabs.some((x) => x.id === st.tabAtual)) st.tabAtual = t.id;
        desenharDv();
      } catch {
        /* um tabuleiro que falha não estraga o resto */
      }
    }
    desenharDv();
  }

  function pecaEquip(x) {
    if (!x) return '';
    const g = GRAU_COR[x.grau] || 'common';
    return `<button class="pe-equip" data-casa="${x.casa}" title="${esc(x.nome)}">
      <img class="g-${g}" src="${esc(icone(x.icone))}" alt="" />
      <span class="txt"><span class="nome txt-${g}">${esc(x.nome)}</span><span class="dim">${esc(CASAS[x.casaNome] || x.casaNome)}${x.encantamento ? ` · +${x.encantamento}` : ''}${x.superacao ? ` · superação ${x.superacao}` : ''}</span></span>
    </button>`;
  }

  // A NC às vezes manda a ficha sem equipamento/habilidades/atributos (13 Out 2026): diz-se o que
  // veio de uma leitura anterior guardada e o que não veio de todo.
  const PARTES = { atributos: 'atributos', nivelItem: 'nível de item', equipamento: 'equipamento', habilidades: 'habilidades' };
  function idade(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
  }
  function avisoNC(f) {
    const nc = f.nc;
    if (!nc) return '';
    const velhos = Object.keys(nc.velhos || {});
    const duv = nc.duvidas || {};
    const partes = [];
    if (duv.atributos) partes.push('os atributos não vieram iguais em todas as leituras (mostra-se o mais repetido)');
    if (duv.nivelItem) partes.push(`o nível de item veio diferente entre leituras (${duv.nivelItem.join(', ')})`);
    if (velhos.length) partes.push(`${velhos.map((k) => `${PARTES[k]} (${idade(nc.velhos[k])})`).join(', ')} vêm da última leitura guardada`);
    if (nc.faltam.length) partes.push(`não veio: ${nc.faltam.map((k) => PARTES[k]).join(', ')}`);
    if (!partes.length) return '';
    return `<div class="pe-aviso-nc">A NC está instável (${nc.leituras} leituras): ${partes.join('; ')}. <button id="peReler" class="tz-acertar">Ler outra vez</button></div>`;
  }

  function desenhar() {
    const f = st.ficha;
    const p = f.perfil;
    const porCasa = new Map(f.equipamento.map((x) => [x.casaNome, x]));
    const outras = f.equipamento.filter((x) => !GRUPOS.some(([, l]) => l.includes(x.casaNome)));
    const hab = (cat) =>
      f.habilidades
        .filter((h) => h.categoria === cat && (h.nivel > 0 || h.equipada))
        .map(
          (h) => `<div class="bl-hab cat-${esc(h.categoria)}${cat === 'Dp' && !h.equipada ? ' usada' : ''}" title="${esc(h.nome)}${cat === 'Dp' ? (h.equipada ? ' · equipado' : ' · não equipado') : ''}">
            <img src="${esc(icone(h.icone))}" alt="" />${h.nivel ? `<span class="niv">${h.nivel}</span>` : ''}</div>`,
        )
        .join('') || '<span class="dim">nenhuma</span>';

    $('#peFicha').innerHTML = `
      <div class="pe-cab">
        ${p.retrato ? `<img class="retrato" src="${esc(p.retrato)}" alt="" />` : ''}
        <div class="quem">
          <h2>${esc(p.nome)}</h2>
          <div class="sub">Nível <b>${p.nivel}</b> · ${esc(p.classe)} · ${esc(p.raca)} · ${esc(p.servidor)}</div>
          ${p.titulo ? `<div class="sub">«${esc(p.titulo)}»</div>` : ''}
        </div>
        <div class="poder"><span>Poder de combate</span><b>${Number(p.poder || 0).toLocaleString('pt-PT')}</b></div>
        ${p.nivelItem != null ? `<div class="poder"><span>Nível de item</span><b>${p.nivelItem}</b></div>` : ''}
        <button id="peCriarBuild" class="primario" title="Uma build nova com a classe, os níveis das habilidades, os estigmas e o Daevanion deste personagem">Criar build com isto</button>
        <button id="peCopiarDv" class="tz-acertar" title="Um plano novo na aba Daevanion com os nós que este personagem tem abertos — para o seguires nos teus">Copiar Daevanion</button>
      </div>
      ${avisoNC(f)}

      <div class="pe-grelha">
        <section>
          ${GRUPOS.map(([nome, casas]) => {
            const pecas = casas.map((c) => porCasa.get(c)).filter(Boolean);
            return pecas.length ? `<h3>${nome}</h3><div class="pe-equips">${pecas.map(pecaEquip).join('')}</div>` : '';
          }).join('')}
          ${outras.length ? `<h3>Outras</h3><div class="pe-equips">${outras.map(pecaEquip).join('')}</div>` : ''}
          ${f.asa || f.mascote ? `<h3>Asas e mascote</h3><div class="pe-equips">
            ${f.asa ? `<div class="pe-equip"><img class="g-${GRAU_COR[f.asa.grau] || 'common'}" src="${esc(icone(f.asa.icone))}" alt="" /><span class="txt"><span class="nome txt-${GRAU_COR[f.asa.grau] || 'common'}">${esc(f.asa.nome)}</span><span class="dim">Asas${f.asa.encantamento ? ` · +${f.asa.encantamento}` : ''}</span></span></div>` : ''}
            ${f.mascote ? `<div class="pe-equip"><img src="${esc(icone(f.mascote.icone))}" alt="" /><span class="txt"><span class="nome">${esc(f.mascote.nome)}</span><span class="dim">Mascote · nível ${f.mascote.nivel}</span></span></div>` : ''}
          </div>` : ''}
        </section>
        <section>
          <h3>Atributos</h3>
          <ul class="pe-atr">${f.atributos.map((a) => `<li title="${esc(a.extra.join('\n'))}"><span>${esc(a.nome)}</span><b>${a.valor}</b>${a.extra.length ? `<small>${a.extra.map(esc).join(' · ')}</small>` : ''}</li>`).join('')}</ul>
          <h3>Títulos <small class="dim">${f.titulos.tem} obtidos</small></h3>
          <ul class="pe-titulos">${f.titulos.equipados.map((t) => `<li><b class="txt-${GRAU_COR[t.grau] || 'common'}">${esc(t.nome)}</b> <span class="dim">${esc(t.categoria)}${t.raridade != null ? ` · ${t.raridade}% dos jogadores` : ''}</span><div>${t.efeitos.map(esc).join(' · ')}</div></li>`).join('')}</ul>
        </section>
      </div>

      <h3 class="pe-h">Habilidades</h3>
      ${['Active', 'Dp', 'Passive'].map((c) => `<div class="bl-linha"><div class="rot">${CAT_NOME[c]}</div><div class="pecas">${hab(c)}</div></div>`).join('')}

      <h3 class="pe-h">Daevanion</h3>
      <div id="peDv"><p class="dim">${f.tabuleiros.some((t) => t.abertos) ? 'A ler os tabuleiros…' : 'Nenhum nó aberto.'}</p></div>`;
  }

  function desenharDv() {
    if (!st.ficha) return;
    const caixa = $('#peDv');
    if (!caixa || !st.tabs.length) return;
    const tab = st.tabs.find((t) => t.id === st.tabAtual) || st.tabs[0];
    caixa.innerHTML = `
      <div class="dv-abas">${st.ficha.tabuleiros
        .map((t) => `<button data-tab="${t.id}" class="${t.id === tab.id ? 'on' : ''}"${st.tabs.some((x) => x.id === t.id) ? '' : ' disabled'}><img src="${esc(icone(t.icone))}" alt="" /> ${esc(t.nome)} <small>${t.abertos}/${t.total}</small></button>`)
        .join('')}</div>
      <div class="dv-corpo">
        <div class="dv-grelha-wrap">${window.UI.grelha(tab, st.abertos[tab.id] || [])}</div>
        <div class="dv-lado">${window.UI.resumo(st.tabs, st.abertos)}</div>
      </div>`;
  }

  $('#peFicha').addEventListener('click', async (e) => {
    const t = e.target.closest('.dv-abas button[data-tab]');
    if (t) {
      st.tabAtual = Number(t.dataset.tab);
      return desenharDv();
    }
    if (e.target.closest('#peCriarBuild')) return criarBuild();
    if (e.target.closest('#peReler')) return abrir(st.ref);
    if (e.target.closest('#peCopiarDv')) return copiarDaevanion();
    const b = e.target.closest('.pe-equip[data-casa]');
    if (!b) return;
    document.querySelectorAll('.pe-equip.on').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    const x = st.ficha.equipamento.find((q) => String(q.casa) === b.dataset.casa);
    const d = $('#peDetalhe');
    d.className = 'detalhe';
    d.innerHTML = '<p class="dim">A ler…</p>';
    try {
      d.innerHTML = window.UI.cartaoItem(await window.api.itemEquipado(st.ref, x));
    } catch (err) {
      d.innerHTML = `<p class="erro">Não consegui ler a peça: ${esc(semPrefixo(err.message))}</p>`;
    }
  });

  async function criarBuild() {
    if (st.dvPronto) {
      estado('A acabar de ler os tabuleiros do Daevanion…');
      await st.dvPronto;
      estado('');
    }
    const f = st.ficha;
    if (!st.classes) st.classes = (await window.api.classes()).dados;
    const c = st.classes.find((x) => x.pcIds.includes(f.perfil.pcId));
    if (!c) return estado('Não sei de que classe é este personagem.', 'erro');
    const b = await window.api.novaBuild(c.nome);
    b.nome = `${f.perfil.nome} (nível ${f.perfil.nivel})`;
    b.etiqueta = 'importada';
    for (const h of f.habilidades) if (h.nivel > 0) b.niveis[h.id] = { nivel: h.nivel, espec: 0 };
    b.prioridade.Dp = f.habilidades.filter((h) => h.categoria === 'Dp' && h.equipada).map((h) => h.id);
    b.daevanion = { ...st.abertos };
    // As ativas que tem aprendidas vão para a barra, pela ordem da NC; os estigmas equipados a seguir.
    const naBarra = [...f.habilidades.filter((h) => h.categoria === 'Active' && h.nivel > 0), ...f.habilidades.filter((h) => h.categoria === 'Dp' && h.equipada)];
    naBarra.slice(0, b.barra.length).forEach((h, i) => (b.barra[i] = h.id));
    const g = await window.api.guardarBuild(b);
    const comNivel = f.habilidades.filter((h) => h.nivel > 0).length;
    const nosDv = Object.values(st.abertos).reduce((n, l) => n + l.length, 0);
    await window.Builds.abrirBuild(
      g,
      `Build criada a partir de <b>${esc(f.perfil.nome)}</b>: ${comNivel} habilidades com nível, ${b.prioridade.Dp.length} estigmas equipados e ${nosDv} nós do Daevanion. Na barra ficaram as ativas e os estigmas equipados, por ordem. A ficha oficial não diz as especializações nem a ordem em que usas as habilidades: a prioridade das ativas e das passivas fica para preencheres.`,
    );
  }

  async function copiarDaevanion() {
    if (st.dvPronto) {
      estado('A acabar de ler os tabuleiros do Daevanion…');
      await st.dvPronto;
      estado('');
    }
    const f = st.ficha;
    if (!st.classes) st.classes = (await window.api.classes()).dados;
    const c = st.classes.find((x) => x.pcIds.includes(f.perfil.pcId));
    if (!c) return estado('Não sei de que classe é este personagem.', 'erro');
    const nos = Object.values(st.abertos).reduce((n, l) => n + l.length, 0);
    if (!nos) return estado('Este personagem não tem nós do Daevanion abertos (ou ainda não acabaram de ler).', 'erro');
    await window.PlanosDaevanion.importar(
      { nome: `${f.perfil.nome} (nível ${f.perfil.nivel})`, classe: c.nome, daevanion: st.abertos },
      `Copiado de <b>${esc(f.perfil.nome)}</b>: ${nos} nós abertos nos tabuleiros. Já está gravado — muda o nome, tira ou junta nós e grava outra vez.`,
    );
  }

  // ── arranque ─────────────────────────────────────────────────────────────

  let arrancou = false;
  document.querySelector('#abas [data-aba=personagem]').addEventListener('click', async () => {
    if (arrancou) return;
    arrancou = true;
    const [limites, defs] = await Promise.all([window.api.limitesBuilds(), window.api.definicoes()]);
    $('#peRegiao').innerHTML = Object.entries(limites.regioes)
      .map(([k, v]) => `<option value="${k}"${k === (defs.regiaoNC || 'eu') ? ' selected' : ''}>${esc(v)}</option>`)
      .join('');
    $('#peNome').focus();
  });

  window.Personagem = { procurar: (nome) => (($('#peNome').value = nome), procurar()) };
})();
