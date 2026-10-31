// A aba das mascotes: a coleção de cada personagem, marcada à mão. A lista vem
// com a app (scripts/gerar-mascotes.js, da ficha oficial da NC); o que cada um
// tem fica nas definições (chave `mascotes`).
//
// A NC não diz quantas almas pede cada nível nem que monstro deixa cair cada
// alma: por isso aqui só há o nível e as almas que o jogador escreve, e as
// fontes gerais que a ficha oficial dá ("Drop de monstros", "Baú de Recompensa").
(function () {
  'use strict';

  const { esc, normalizar } = window.U;
  const { icone } = window.UI;
  const $ = (s) => document.querySelector(s);

  let lista = [];
  let cfg = { atual: 'Principal', personagens: { Principal: {} } };
  let filtro = '';
  // Almas para passar ao nível seguinte (visto nas cartas do jogo: nível 1 → 25, nível 2 → 75; o 3 é o máximo).
  const ALMAS_POR_NIVEL = { 1: 25, 2: 75 };
  const NIVEL_MAX = 3;

  /** { falta, tem, precisa, prox } para uma mascote obtida abaixo do máximo; null se não der para saber. */
  function faltaAlmas(e) {
    if (!e || !e.tem || !e.nivel || e.nivel >= NIVEL_MAX) return null;
    const precisa = ALMAS_POR_NIVEL[e.nivel] || e.almasPrecisa;
    if (!precisa) return null;
    const tem = Math.min(precisa, e.almas || 0);
    return { falta: precisa - tem, tem, precisa, prox: e.nivel + 1 };
  }

  const colecao = () => cfg.personagens[cfg.atual] || (cfg.personagens[cfg.atual] = {});

  let temporizador = null;
  function guardar() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => window.api.mudarDefinicoes({ mascotes: cfg }), 300);
  }

  function personagens() {
    $('#maPersonagem').innerHTML = Object.keys(cfg.personagens)
      .map((n) => `<option>${esc(n)}</option>`)
      .join('');
    $('#maPersonagem').value = cfg.atual;
  }

  function contar() {
    const c = colecao();
    const tem = lista.filter((m) => c[m.id] && c[m.id].tem).length;
    // O contador do próprio jogo (lido na coleção): se não bate certo, a leitura dos nomes falhou.
    const j = cfg.jogo && cfg.jogo[cfg.atual];
    const jogo = j
      ? ` · <span class="${j.tem !== tem ? 'aviso-txt' : ''}" title="${esc('Lido na coleção do jogo às ' + new Date(j.quando).toLocaleString('pt-PT') + (j.tem !== tem ? '. Não bate certo com as marcadas: confirma que o idioma do jogo nas Definições é o mesmo do jogo e percorre a coleção toda.' : ''))}">o jogo diz <b>${j.tem}/${j.total}</b></span>`
      : '';
    $('#maConta').innerHTML = `<b>${tem}</b> de ${lista.length} obtidas${jogo}`;
  }

  /** "faltam X almas para o nível N" com a barra; "Nível máximo"; ou o convite a escrever o nível. */
  function blocoAlmas(e) {
    if (e.tem && e.nivel >= NIVEL_MAX) return '<div class="ma-almas max">Nível máximo</div>';
    const f = faltaAlmas(e);
    if (!f) return e.tem ? '<div class="ma-almas dim">escreve o nível para ver quantas almas faltam</div>' : '';
    const pct = Math.round((f.tem / f.precisa) * 100);
    return `<div class="ma-almas" title="${f.tem} de ${f.precisa} almas para o nível ${f.prox}">almas <b>${f.tem}/${f.precisa}</b> <span class="dim">· faltam ${f.falta} para o nível ${f.prox}</span><div class="ma-barra"><i style="width:${pct}%"></i></div></div>`;
  }

  function cartao(m) {
    const e = colecao()[m.id] || {};
    const fontes = [...new Set([...(m.alma ? m.alma.fontes : []), ...m.fontes])];
    return `<div class="ma-cartao ${e.tem ? 'tem' : ''}" data-id="${m.id}">
      <div class="ma-cab">
        <img class="ma-ico" src="${esc(icone(m.icone))}" alt="" loading="lazy" />
        <div class="ma-nomes">
          <div class="ma-nome" title="${esc(m.nome)}">${esc(m.nome)}</div>
          <div class="ma-outro dim" title="${esc(m.outro || '')}">${esc(m.outro || '')}</div>
        </div>
      </div>
      <div class="ma-campos">
        <select data-campo="tem"><option value="">Falta</option><option value="1" ${e.tem ? 'selected' : ''}>Obtida</option></select>
        <label title="Nível da mascote">nív. <input type="number" min="0" max="99" data-campo="nivel" value="${e.nivel ?? ''}" placeholder="–" /></label>
        <label title="Almas que tens desta mascote">almas <input type="number" min="0" max="9999" data-campo="almas" value="${e.almas ?? ''}" placeholder="0" /></label>
      </div>
      <div class="ma-almas-cx">${blocoAlmas(e)}</div>
      <div class="ma-fontes dim" title="Onde a NC diz que se arranja (a ficha oficial não diz que monstro nem que zona)">${esc(fontes.join(' · ') || 'origem não indicada')}</div>
    </div>`;
  }

  function desenhar() {
    const termos = normalizar($('#maProcura').value).split(/\s+/).filter(Boolean);
    const c = colecao();
    let vis = lista.filter(
      (m) =>
        termos.every((t) => m.chave.includes(t)) &&
        (filtro === 'subir' ? !!faltaAlmas(c[m.id]) : !filtro || (filtro === 'tem') === !!(c[m.id] && c[m.id].tem)),
    );
    if (filtro === 'subir') vis = vis.sort((a, b) => faltaAlmas(c[a.id]).falta - faltaAlmas(c[b.id]).falta);
    $('#maLista').innerHTML = vis.length ? vis.map(cartao).join('') : '<p class="dim pad">Nenhuma mascote com esse filtro.</p>';
    contar();
  }

  $('#maLista').addEventListener('change', (e) => {
    const campo = e.target.dataset.campo;
    if (!campo) return;
    const div = e.target.closest('.ma-cartao');
    const id = div.dataset.id;
    const c = colecao();
    const reg = { ...(c[id] || {}) };
    if (campo === 'tem') reg.tem = !!e.target.value;
    else if (e.target.value === '') delete reg[campo];
    else reg[campo] = Math.max(0, Math.round(+e.target.value));
    // Quem escreve um nível tem a mascote.
    if (campo === 'nivel' && reg.nivel > 0 && !reg.tem) {
      reg.tem = true;
      div.querySelector('[data-campo=tem]').value = '1';
    }
    if (Object.keys(reg).some((k) => reg[k])) c[id] = reg;
    else delete c[id];
    div.classList.toggle('tem', !!reg.tem);
    div.querySelector('.ma-almas-cx').innerHTML = blocoAlmas(reg);
    guardar();
    contar();
  });

  $('#maProcura').addEventListener('input', desenhar);
  $('#maFiltro').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filtro = b.dataset.f;
    for (const x of document.querySelectorAll('#maFiltro .chip')) x.classList.toggle('on', x === b);
    desenhar();
  });
  $('#maPersonagem').addEventListener('change', (e) => {
    cfg.atual = e.target.value;
    guardar();
    desenhar();
  });
  $('#maNovoPers').addEventListener('click', () => {
    $('#maNovo').hidden = !$('#maNovo').hidden;
    if (!$('#maNovo').hidden) $('#maNovoNome').focus();
  });
  function criar() {
    const n = $('#maNovoNome').value.trim();
    if (!n) return;
    if (!cfg.personagens[n]) cfg.personagens[n] = {};
    cfg.atual = n;
    $('#maNovoNome').value = '';
    $('#maNovo').hidden = true;
    guardar();
    personagens();
    desenhar();
  }
  $('#maNovoOk').addEventListener('click', criar);
  $('#maNovoNome').addEventListener('keydown', (e) => e.key === 'Enter' && criar());

  // ── no jogo: aviso do alvo, almas do chat e coleção lida do ecrã ──────────

  async function noJogo(alt) {
    const o = await window.api.mascotesNoJogo(alt);
    $('#maAlvo').checked = !!o.alvo;
    $('#maAlmas').checked = !!o.almas;
  }
  $('#maAlvo').addEventListener('change', (e) => noJogo({ alvo: e.target.checked }));
  $('#maAlmas').addEventListener('change', (e) => noJogo({ almas: e.target.checked }));
  // O botão faz o mesmo que o Ctrl+Alt+M: liga e desliga a leitura.
  $('#maLerColecao').addEventListener('click', () => window.api.lerColecaoMascotes());

  // O que o Ctrl+Alt+M leu: marca-se com um clique; o palpite (pela luz do
  // texto) vem já escolhido, e o que não deu para adivinhar fica por escolher.
  let lidas = [];
  function painelLidas(r) {
    const p = $('#maLidas');
    if (r.erro) {
      $('#maJogoDica').textContent = 'Não consegui ler o ecrã: ' + r.erro;
      return;
    }
    $('#maLerColecao').textContent = r.aLer ? 'Parar a leitura' : 'Ler a coleção do ecrã';
    $('#maLerColecao').classList.toggle('primario', !!r.aLer);
    lidas = r.lidas;
    if (r.contador) {
      cfg.jogo = { ...(cfg.jogo || {}), [cfg.atual]: { ...r.contador, quando: r.quando } };
      guardar();
      contar();
    }
    if (r.aLer) {
      // A ler: só se mostra o que já entrou; os visto/por marcar ficam para o fim.
      $('#maJogoDica').textContent = `a ler… ${r.leituras} ecrã(s) lidos · Ctrl+Alt+M para parar`;
      p.hidden = false;
      p.innerHTML = `<h4>A ler a coleção — percorre-a no jogo. ${lidas.length} mascote(s) até agora</h4>
        <div class="ma-lidas-lista">${lidas.map((m) => `<span>${esc(m.nome)}</span>`).join('') || '<span class="dim">ainda nenhuma</span>'}</div>`;
      return;
    }
    $('#maJogoDica').textContent = `lido às ${new Date(r.quando).toLocaleTimeString('pt-PT')} · ${r.leituras || 1} ecrã(s)`;
    if (!lidas.length) {
      p.hidden = false;
      p.innerHTML = '<p class="dim">Não reconheci nenhuma mascote. Abre a janela Pets no jogo (separador Pets, ALL), com o jogo à frente, e volta a carregar em Ctrl+Alt+M; depois faz scroll até ao fim da lista.</p>';
      return;
    }
    const c = colecao();
    p.hidden = false;
    p.innerHTML = `<h4>Li ${lidas.length} mascote(s) no ecrã — marca as que já tens</h4>
      <div class="ma-lidas-lista">${lidas
        .map((m, i) => {
          const ja = c[m.id] && c[m.id].tem;
          const marcada = ja || m.tem === true;
          return `<label class="chk" title="${m.tem ? 'vi o círculo do nível: está obtida' : 'não vi o círculo do nível (em falta, ou a carta estava cortada)'}">
            <input type="checkbox" data-i="${i}" ${marcada ? 'checked' : ''} /> ${esc(m.nome)}${m.nivel ? ` <span class="dim">nív. ${m.nivel}${m.almas ? ` · ${m.almas.tem}/${m.almas.precisa}` : m.nivel >= 3 ? ' · MAX' : ''}</span>` : ''}${m.tem == null && !ja ? ' <span class="dim">?</span>' : ''}</label>`;
        })
        .join('')}</div>
      <div class="acoes"><button class="primario" id="maLidasOk">Guardar</button><button id="maLidasFora" class="tz-acertar">Fechar</button>
      <span class="dim">Só junta: o que já estava marcado não se desmarca.</span></div>`;
    $('#maLidasOk').onclick = () => {
      const c2 = colecao();
      for (const x of p.querySelectorAll('input[data-i]')) {
        if (!x.checked) continue;
        const m = lidas[+x.dataset.i];
        c2[m.id] = { ...(c2[m.id] || {}), tem: true };
        // O nível visto no círculo da carta (o jogo só mostra 1–3): não baixa o que já lá estava.
        if (m.nivel && !(c2[m.id].nivel >= m.nivel)) c2[m.id].nivel = m.nivel;
        // As almas lidas na carta são o estado de agora: substituem as escritas antes (só se o nível bate).
        if (m.almas && c2[m.id].nivel === m.nivel) {
          c2[m.id].almas = m.almas.tem;
          c2[m.id].almasPrecisa = m.almas.precisa;
        }
      }
      guardar();
      p.hidden = true;
      desenhar();
    };
    $('#maLidasFora').onclick = () => (p.hidden = true);
  }
  window.api.aoLerColecao(painelLidas);

  // O chat contou uma alma: a coleção mudou do lado do main.
  window.api.aoMudaremMascotes((m) => {
    if (!m || !m.personagens) return;
    cfg = m;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#maLista')) return contar();
    desenhar();
  });

  async function arrancar() {
    const [d, r] = await Promise.all([window.api.definicoes(), window.api.mascotes()]);
    if (d.mascotes && d.mascotes.personagens) cfg = d.mascotes;
    if (!r.mascotes.length) {
      $('#maEstado').innerHTML = 'Esta versão da app veio sem a lista de mascotes (<code>src/dados/mascotes.json</code>). Gera-se com <code>node scripts/gerar-mascotes.js</code>.';
      $('#maEstado').className = 'estado erro';
      return;
    }
    lista = r.mascotes
      .map((m) => ({ ...m, chave: normalizar(`${m.nome} ${m.outro || ''}`) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    personagens();
    desenhar();
    noJogo();
  }

  arrancar();
})();
