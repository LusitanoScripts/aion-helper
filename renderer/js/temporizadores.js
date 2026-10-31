// A aba dos temporizadores: o que vem a seguir (eventos, chefes, resets) na hora
// da região, e as cargas das masmorras a partir do número que o jogo mostra.
// As contas estão em src/temporizadores.js; aqui é só desenhar e guardar.
(function () {
  'use strict';

  const T = window.Temporizadores;
  const { esc } = window.U;
  const $ = (s) => document.querySelector(s);

  // O que se guarda nas definições (chave `temporizadores`).
  let cfg = {
    regiao: 'eu',
    acertoEventos: 0, // minutos
    acertoReset: 0, // minutos
    avisoMin: 5,
    avisos: {}, // id do evento → true
    cargas: {}, // id → { valor, em }
    acertos: {}, // id da carga → ms de uma carga que o jogo mostrou
    escondidas: [], // categorias desligadas
  };
  const disparados = new Set(); // "id|inicio" já avisados

  function guardar() {
    window.api.mudarDefinicoes({ temporizadores: cfg });
  }

  const tz = () => T.regiao(cfg.regiao).tz;
  const acertosCargas = () => ({ ...cfg.acertos, reset: cfg.acertoReset });
  const acertoDe = (ev) => (ev.utc ? cfg.acertoReset : cfg.acertoEventos);

  function horaEm(ms, zona, comDia) {
    return new Intl.DateTimeFormat('pt-PT', {
      timeZone: zona,
      hour: '2-digit',
      minute: '2-digit',
      ...(comDia ? { weekday: 'short' } : {}),
    }).format(new Date(ms));
  }
  const horaLocal = (ms, comDia) => horaEm(ms, undefined, comDia);

  const CERTEZA = {
    alta: ['', 'Várias fontes concordam'],
    media: ['≈', 'Tirado dos ficheiros do cliente ou de 2 fontes; ainda não confirmado por nós no jogo'],
    baixa: ['?', 'Só uma fonte, ou as fontes não batem certo'],
  };
  function selo(c) {
    const [s, t] = CERTEZA[c] || CERTEZA.baixa;
    return s ? `<span class="tz-certeza ${c}" title="${esc(t)}">${s}</span>` : '';
  }

  // ── eventos ───────────────────────────────────────────────────────────────

  function desenharFiltros() {
    $('#tzFiltros').innerHTML = Object.entries(T.CATEGORIAS)
      .map(([id, nome]) => `<button class="chip ${cfg.escondidas.includes(id) ? '' : 'on'}" data-cat="${id}">${esc(nome)}</button>`)
      .join('');
  }

  function desenharEventos() {
    const agora = Date.now();
    const linhas = T.EVENTOS.filter((e) => !cfg.escondidas.includes(e.cat))
      .map((e) => ({ e, prox: T.proximas(e, agora, tz(), 4, acertoDe(e)) }))
      .filter((x) => x.prox.length)
      .sort((a, b) => a.prox[0].inicio - b.prox[0].inicio);
    $('#tzEventos').innerHTML = linhas.length
      ? linhas
          .map(
            ({ e }) => `<div class="tz-ev" data-id="${e.id}">
              <div class="tz-ev-cab">
                <span class="tz-cat ${e.cat}"></span>
                <span class="tz-nome">${esc(e.nome)} ${selo(e.certeza)}</span>
                <span class="tz-falta" data-falta></span>
                <button class="tz-sino ${cfg.avisos[e.id] ? 'on' : ''}" data-sino title="Avisar ${cfg.avisoMin} min antes">🔔</button>
              </div>
              <div class="tz-ev-sub"><span data-horas></span> · <span class="dim">${esc(e.nota || '')}</span></div>
            </div>`,
          )
          .join('')
      : '<p class="dim pad">Nada a mostrar: liga uma categoria acima.</p>';
    atualizarEventos();
  }

  function atualizarEventos() {
    const agora = Date.now();
    for (const div of document.querySelectorAll('#tzEventos .tz-ev')) {
      const e = T.EVENTOS.find((x) => x.id === div.dataset.id);
      const prox = T.proximas(e, agora, tz(), 4, acertoDe(e));
      if (!prox.length) continue;
      const a = prox[0];
      const ativo = a.inicio <= agora;
      div.classList.toggle('ativo', ativo);
      div.querySelector('[data-falta]').textContent = ativo ? `a decorrer · acaba em ${T.falta(a.fim - agora)}` : T.falta(a.inicio - agora);
      // Hora local (a do PC); com mais de um dia de distância, leva o dia da semana.
      div.querySelector('[data-horas]').textContent = prox
        .slice(0, e.cada && e.cada <= 60 ? 4 : 3)
        .map((p) => horaLocal(p.inicio, p.inicio - agora > 20 * 3600e3))
        .join(' · ');
    }
    avisar(agora);
  }

  function avisar(agora) {
    const antes = cfg.avisoMin * 60e3;
    for (const e of T.EVENTOS) {
      if (!cfg.avisos[e.id]) continue;
      const [p] = T.proximas(e, agora, tz(), 1, acertoDe(e));
      if (!p || p.inicio <= agora) continue;
      const chave = `${e.id}|${p.inicio}`;
      if (p.inicio - agora > antes || disparados.has(chave)) continue;
      disparados.add(chave);
      try {
        new Notification(`${e.nome} daqui a ${Math.round((p.inicio - agora) / 60e3)} min`, {
          body: `Às ${horaLocal(p.inicio)}. ${e.nota || ''}`.trim(),
        });
      } catch {
        // Sem notificações no sistema: fica só a lista.
      }
    }
  }

  // ── cargas ────────────────────────────────────────────────────────────────

  function desenharCargas() {
    $('#tzCargas').innerHTML = T.CARGAS.map(
      (c) => `<div class="tz-carga" data-id="${c.id}">
        <div class="tz-carga-cab">
          <span class="tz-nome">${esc(c.nome)} ${selo(c.certeza)}</span>
          <span class="tz-valor"><input type="number" min="0" max="${c.max}" data-valor /> / ${c.max}</span>
        </div>
        <div class="barra-t"><i data-barra></i></div>
        <div class="tz-carga-sub"><span data-estado></span></div>
        <div class="tz-carga-sub dim">${esc(c.nota)}${
          c.estimada
            ? ` <button class="link" data-acertar title="Escreve o tempo que o jogo mostra até à próxima carga">a hora da próxima carga é estimada: acertar</button>`
            : ''
        }</div>
      </div>`,
    ).join('');
    atualizarCargas(true);
  }

  function atualizarCargas(tudo) {
    const agora = Date.now();
    for (const div of document.querySelectorAll('#tzCargas .tz-carga')) {
      const c = T.CARGAS.find((x) => x.id === div.dataset.id);
      const st = T.estadoCarga(c, cfg.cargas[c.id], agora, acertosCargas());
      const inp = div.querySelector('[data-valor]');
      // Não mexe no número enquanto se escreve.
      if (tudo || document.activeElement !== inp) inp.value = st.valor == null ? '' : st.valor;
      inp.placeholder = '?';
      div.querySelector('[data-barra]').style.width = st.valor == null ? '0' : `${(100 * st.valor) / c.max}%`;
      const mais = `+${c.mais} em ${T.falta(st.proxima - agora)} (${horaLocal(st.proxima, st.proxima - agora > 20 * 3600e3)})`;
      let txt;
      if (st.valor == null) txt = `${mais} · escreve quantas tens`;
      else if (st.cheio === true) txt = c.repor ? 'tudo por gastar' : `cheio: o que cair agora perde-se`;
      else txt = `${mais} · cheio ${c.repor ? 'no reset' : 'em ' + T.falta(st.cheio - agora)}`;
      div.querySelector('[data-estado]').textContent = txt;
      div.classList.toggle('cheio', st.cheio === true && !c.repor);
    }
  }

  $('#tzCargas').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-valor]');
    if (!inp) return;
    const id = inp.closest('.tz-carga').dataset.id;
    if (inp.value === '') delete cfg.cargas[id];
    else cfg.cargas[id] = { valor: Math.max(0, Math.round(+inp.value)), em: Date.now() };
    guardar();
    atualizarCargas(true);
  });

  // "acertar": o prompt() não existe no Electron, por isso é um campo no cartão.
  $('#tzCargas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-acertar]');
    if (!b) return;
    const sub = b.parentElement;
    if (sub.querySelector('[data-acerto]')) return;
    b.insertAdjacentHTML(
      'afterend',
      ' <input data-acerto class="tz-acerto-campo" placeholder="1:25 ou 40" title="O tempo até à próxima carga que o jogo mostra (h:mm ou minutos). Enter para guardar." />',
    );
    sub.querySelector('[data-acerto]').focus();
  });
  $('#tzCargas').addEventListener('keydown', (e) => {
    const inp = e.target.closest('[data-acerto]');
    if (!inp || e.key !== 'Enter') return;
    const id = inp.closest('.tz-carga').dataset.id;
    const [a, b] = inp.value.trim().split(':').map(Number);
    const min = b == null ? a : a * 60 + b;
    if (!Number.isFinite(min) || min < 0) return;
    cfg.acertos[id] = Date.now() + min * 60e3;
    guardar();
    inp.remove();
    atualizarCargas(true);
  });

  // ── barra de cima ─────────────────────────────────────────────────────────

  function relogios() {
    const agora = Date.now();
    const r = T.regiao(cfg.regiao);
    const [dia] = T.proximas(T.EVENTOS.find((e) => e.id === 'reset-dia'), agora, r.tz, 1, cfg.acertoReset);
    const [sem] = T.proximas(T.EVENTOS.find((e) => e.id === 'reset-semana'), agora, r.tz, 1, cfg.acertoReset);
    $('#tzRelogios').innerHTML = `
      <div><span>Hora do servidor</span><b>${horaEm(agora, r.tz)}</b></div>
      <div><span>A tua hora</span><b>${horaLocal(agora)}</b></div>
      <div><span>Reset diário</span><b>${T.falta(dia.inicio - agora)}</b></div>
      <div><span>Reset semanal</span><b>${T.falta(sem.inicio - agora)}</b></div>`;
  }

  function opcoesAcerto(sel, valor) {
    const ops = [];
    for (let h = -12; h <= 12; h++) ops.push(`<option value="${h * 60}">${h === 0 ? 'como está' : (h > 0 ? '+' : '') + h + ' h'}</option>`);
    sel.innerHTML = ops.join('');
    sel.value = String(valor);
  }

  $('#tzRegiao').addEventListener('change', (e) => {
    cfg.regiao = e.target.value;
    guardar();
    desenharEventos();
    relogios();
  });
  $('#tzAvisoMin').addEventListener('change', (e) => {
    cfg.avisoMin = +e.target.value;
    guardar();
    desenharEventos();
  });
  $('#tzAcertar').addEventListener('click', () => ($('#tzAcerto').hidden = !$('#tzAcerto').hidden));
  $('#tzAcertoEventos').addEventListener('change', (e) => {
    cfg.acertoEventos = +e.target.value;
    guardar();
    desenharEventos();
  });
  $('#tzAcertoReset').addEventListener('change', (e) => {
    cfg.acertoReset = +e.target.value;
    guardar();
    desenharEventos();
    atualizarCargas(true);
  });
  $('#tzFiltros').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    const c = b.dataset.cat;
    cfg.escondidas = cfg.escondidas.includes(c) ? cfg.escondidas.filter((x) => x !== c) : [...cfg.escondidas, c];
    guardar();
    desenharFiltros();
    desenharEventos();
  });
  $('#tzEventos').addEventListener('click', (e) => {
    if (!e.target.closest('[data-sino]')) return;
    const id = e.target.closest('.tz-ev').dataset.id;
    if (cfg.avisos[id]) delete cfg.avisos[id];
    else cfg.avisos[id] = true;
    guardar();
    e.target.closest('[data-sino]').classList.toggle('on', !!cfg.avisos[id]);
  });

  async function arrancar() {
    const d = await window.api.definicoes();
    cfg = { ...cfg, ...(d.temporizadores || {}) };
    $('#tzRegiao').innerHTML = T.REGIOES.map((r) => `<option value="${r.id}">${esc(r.nome)}</option>`).join('');
    $('#tzRegiao').value = cfg.regiao;
    $('#tzAvisoMin').value = String(cfg.avisoMin);
    opcoesAcerto($('#tzAcertoEventos'), cfg.acertoEventos);
    opcoesAcerto($('#tzAcertoReset'), cfg.acertoReset);
    desenharFiltros();
    desenharEventos();
    desenharCargas();
    relogios();
    let ordem = '';
    setInterval(() => {
      relogios();
      atualizarCargas(false);
      // A ordem muda quando um evento acaba: aí redesenha; senão só os números.
      const agora = Date.now();
      const nova = T.EVENTOS.map((e) => (T.proximas(e, agora, tz(), 1, acertoDe(e))[0] || {}).inicio).join();
      if (nova !== ordem) {
        ordem = nova;
        desenharEventos();
      } else atualizarEventos();
    }, 1000);
  }

  arrancar();
})();
