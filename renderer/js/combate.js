// A aba Combate: as lutas que o medidor de DPS gravou a partir da janela
// "Análise de combate" do jogo. Lista, detalhe com a curva e as habilidades, e
// comparar duas. As contas estão em src/medidor.js; aqui é só desenhar.
(function () {
  'use strict';

  const { esc } = window.U;
  const $ = (s) => document.querySelector(s);

  let lutas = [];
  let escolhida = null; // id
  const marcadas = []; // até 2 ids, para comparar
  let comparar = false;
  let aApagar = null; // id à espera de confirmação

  /** 1420000 → "1,42M", 35500 → "35,5K", 812 → "812". */
  function curto(n) {
    if (n == null) return '—';
    const f = (v, c) => v.toLocaleString('pt-PT', { maximumFractionDigits: c });
    if (n >= 1e9) return f(n / 1e9, 2) + 'B';
    if (n >= 1e6) return f(n / 1e6, 2) + 'M';
    if (n >= 1e3) return f(n / 1e3, n >= 1e5 ? 0 : 1) + 'K';
    return f(n, 0);
  }
  const duracao = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const quando = (iso) => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const porId = (id) => lutas.find((l) => l.id === id);

  // ── estado do medidor ───────────────────────────────────────────────────
  function desenharEstado(e) {
    $('#cbLigado').checked = e.ligado;
    $('#medidorLigado').checked = e.ligado;
    const f = $('#cbFase');
    f.className = 'cb-fase' + (e.fase === 'em luta' ? ' vivo' : e.fase === 'à procura' ? ' procura' : '');
    if (e.fase === 'em luta') f.textContent = `em luta · ${e.alvo || 'alvo?'} · ${curto(e.total)} · ${curto(e.dps)}/s`;
    else if (e.fase === 'à procura') f.textContent = 'à procura da janela Análise de combate…';
    else f.textContent = e.fase;
  }
  const ligar = async (on) => desenharEstado(await window.api.ligarMedidor(on));
  $('#cbLigado').addEventListener('change', (ev) => ligar(ev.target.checked));
  $('#medidorLigado').addEventListener('change', (ev) => ligar(ev.target.checked));
  window.api.aoMudarMedidor(desenharEstado);
  window.api.medidor().then(desenharEstado);

  // ── lista ───────────────────────────────────────────────────────────────
  function desenharAlvos() {
    const sel = $('#cbAlvo');
    const atual = sel.value;
    const alvos = [...new Set(lutas.map((l) => l.alvo || '(sem nome)'))].sort();
    sel.innerHTML = '<option value="">Todos</option>' + alvos.map((a) => `<option>${esc(a)}</option>`).join('');
    sel.value = alvos.includes(atual) ? atual : '';
  }

  function desenharLista() {
    const filtro = $('#cbAlvo').value;
    const vis = lutas.filter((l) => !filtro || (l.alvo || '(sem nome)') === filtro);
    // O melhor DPS de cada alvo leva estrela.
    const melhor = {};
    for (const l of lutas) {
      const k = l.alvo || '';
      if (!melhor[k] || l.dps > melhor[k].dps) melhor[k] = l;
    }
    $('#cbLista').innerHTML = vis.length
      ? vis
          .map(
            (l) => `<tr data-id="${esc(l.id)}" class="${l.id === escolhida && !comparar ? 'sel' : ''}">
        <td class="cb-marca"><input type="checkbox" ${marcadas.includes(l.id) ? 'checked' : ''} title="Marcar para comparar" /></td>
        <td class="dim">${esc(quando(l.inicio))}</td>
        <td>${esc(l.alvo || '(sem nome)')}${melhor[l.alvo || ''] === l && lutas.filter((x) => (x.alvo || '') === (l.alvo || '')).length > 1 ? '<span class="melhor" title="Melhor DPS neste alvo">★</span>' : ''}</td>
        <td class="num">${duracao(l.duracao)}</td>
        <td class="num"><b>${curto(l.total)}</b></td>
        <td class="num">${curto(l.dps)}/s</td>
        <td class="etq">${esc(l.build || '')}</td>
      </tr>`
          )
          .join('')
      : '<tr><td class="vazio" colspan="7">Ainda não há lutas gravadas. Liga o medidor e abre a Análise de combate no jogo (Ctrl+X).</td></tr>';
    $('#cbComparar').disabled = marcadas.length !== 2;
  }

  $('#cbAlvo').addEventListener('change', desenharLista);
  $('#cbLista').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    if (ev.target.matches('input[type=checkbox]')) {
      const i = marcadas.indexOf(id);
      if (i >= 0) marcadas.splice(i, 1);
      else {
        marcadas.push(id);
        if (marcadas.length > 2) marcadas.shift();
      }
      desenharLista();
      return;
    }
    escolhida = id;
    comparar = false;
    aApagar = null;
    desenharLista();
    desenharDetalhe();
  });
  $('#cbComparar').addEventListener('click', () => {
    comparar = true;
    desenharLista();
    desenharDetalhe();
  });

  // ── curva ───────────────────────────────────────────────────────────────
  /** DPS segundo a segundo, alisado em 3 s: [[s, dps]]. */
  function dpsPorSegundo(curva) {
    const v = [];
    for (let i = 1; i < curva.length; i++) {
      const ds = curva[i][0] - curva[i - 1][0];
      if (ds > 0) v.push([curva[i][0], (curva[i][1] - curva[i - 1][1]) / ds]);
    }
    return v.map(([s], i) => {
      const jan = v.slice(Math.max(0, i - 1), i + 2);
      return [s, jan.reduce((a, [, d]) => a + d, 0) / jan.length];
    });
  }

  function svgCurvas(series) {
    const W = 430;
    const H = 150;
    const m = { e: 40, d: 8, c: 8, b: 18 };
    const pts = series.map((l) => dpsPorSegundo(l.curva));
    const maxS = Math.max(1, ...pts.flat().map(([s]) => s));
    const maxD = Math.max(1, ...pts.flat().map(([, d]) => d));
    const x = (s) => m.e + (s / maxS) * (W - m.e - m.d);
    const y = (d) => H - m.b - (d / maxD) * (H - m.c - m.b);
    const linhas = pts
      .map((p, i) => `<polyline class="s${i}" fill="none" stroke-width="1.8" stroke-linejoin="round" points="${p.map(([s, d]) => `${x(s).toFixed(1)},${y(d).toFixed(1)}`).join(' ')}" />`)
      .join('');
    const marcas = [0, 0.5, 1].map((f) => `<text x="${m.e - 4}" y="${y(maxD * f) + 3}" text-anchor="end">${curto(maxD * f)}</text>`).join('');
    return `<svg class="cb-curva" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="DPS ao longo da luta">
      <line class="eixo" x1="${m.e}" y1="${H - m.b}" x2="${W - m.d}" y2="${H - m.b}" />
      ${marcas}
      <text x="${m.e}" y="${H - 4}">0:00</text><text x="${W - m.d}" y="${H - 4}" text-anchor="end">${duracao(maxS)}</text>
      ${linhas}</svg>`;
  }

  function tabelaHabilidades(hab) {
    if (!hab || !hab.length) return '<p class="dim" style="font-size:12px;margin-bottom:12px">As habilidades ainda não são lidas: falta ver como o jogo mostra o detalhe da Análise de combate.</p>';
    const max = Math.max(...hab.map((h) => h.dano || 0), 1);
    const pct = (v) => (v == null ? '—' : v.toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + '%');
    return `<table><thead><tr><th>Habilidade</th><th class="num">Dano</th><th class="num">%</th><th class="num">Acertos</th><th class="num">Crít.</th></tr></thead><tbody>${hab
      .map(
        (h) => `<tr><td>${esc(h.nome || '?')}<div class="barra-hab" style="width:${Math.round(((h.dano || 0) / max) * 100)}%"></div></td>
      <td class="num">${curto(h.dano)}</td><td class="num">${pct(h.pct)}</td><td class="num">${h.acertos ?? '—'}</td><td class="num">${pct(h.critico)}</td></tr>`
      )
      .join('')}</tbody></table>`;
  }

  // ── detalhe e comparação ────────────────────────────────────────────────
  function desenharDetalhe() {
    const el = $('#cbDetalhe');
    if (comparar && marcadas.length === 2) return desenharComparacao(el, porId(marcadas[0]), porId(marcadas[1]));
    const l = porId(escolhida);
    if (!l) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `<h3>${esc(l.alvo || '(sem nome)')}</h3>
      <div class="sub">${esc(quando(l.inicio))}${l.personagem ? ' · ' + esc(l.personagem) : ''}</div>
      <div class="cb-numeros">
        <div><b>${curto(l.total)}</b><span>Total</span></div>
        <div><b>${curto(l.dps)}</b><span>DPS</span></div>
        <div><b>${curto(l.picoDps)}</b><span>Pico 5 s</span></div>
        <div><b>${duracao(l.duracao)}</b><span>Duração</span></div>
      </div>
      ${svgCurvas([l])}
      <div class="cb-legenda"><span><i style="background:var(--gold)"></i>DPS por segundo (média de 3 s)</span></div>
      ${tabelaHabilidades(l.habilidades)}
      <div class="cb-editar">
        <span>Alvo</span><input id="cbEdAlvo" value="${esc(l.alvo || '')}" placeholder="nome do alvo" />
        <span>Etiqueta</span><input id="cbEdBuild" value="${esc(l.build || '')}" placeholder="ex.: Build B, com poções" maxlength="40" />
      </div>
      <div class="cb-acoes">
        <button id="cbGravar" class="tz-acertar">Gravar</button>
        <button id="cbApagar" class="tz-acertar perigo">${aApagar === l.id ? 'Carrega outra vez para apagar' : 'Apagar luta'}</button>
      </div>`;
    $('#cbGravar').addEventListener('click', async () => {
      const novo = await window.api.mudarLuta(l.id, { alvo: $('#cbEdAlvo').value, build: $('#cbEdBuild').value });
      if (novo) Object.assign(l, novo);
      desenharAlvos();
      desenharLista();
      desenharDetalhe();
    });
    $('#cbApagar').addEventListener('click', async () => {
      if (aApagar !== l.id) {
        aApagar = l.id;
        return desenharDetalhe();
      }
      await window.api.apagarLuta(l.id);
      lutas = lutas.filter((x) => x.id !== l.id);
      const i = marcadas.indexOf(l.id);
      if (i >= 0) marcadas.splice(i, 1);
      escolhida = null;
      aApagar = null;
      desenharAlvos();
      desenharLista();
      desenharDetalhe();
    });
  }

  function desenharComparacao(el, a, b) {
    const dif = (va, vb) => {
      if (!va || vb == null) return '';
      const p = ((vb - va) / va) * 100;
      const t = (p >= 0 ? '+' : '') + p.toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + '%';
      return `<em class="${p >= 0 ? 'sobe' : 'desce'}">${t}</em>`;
    };
    const nome = (l) => `${esc(l.alvo || '(sem nome)')} · ${esc(quando(l.inicio))}${l.build ? ' · ' + esc(l.build) : ''}`;
    const comuns = (a.habilidades || []).filter((h) => (b.habilidades || []).some((k) => k.nome === h.nome));
    el.innerHTML = `<h3>Comparar</h3>
      <div class="cb-legenda"><span><i style="background:var(--gold)"></i>${nome(a)}</span></div>
      <div class="cb-legenda"><span><i style="background:var(--teal)"></i>${nome(b)}</span></div>
      <div class="cb-numeros">
        <div><b>${curto(b.dps)}</b><span>DPS</span> ${dif(a.dps, b.dps)}</div>
        <div><b>${curto(b.total)}</b><span>Total</span> ${dif(a.total, b.total)}</div>
        <div><b>${curto(b.picoDps)}</b><span>Pico 5 s</span> ${dif(a.picoDps, b.picoDps)}</div>
        <div><b>${duracao(b.duracao)}</b><span>Duração</span> ${dif(a.duracao, b.duracao)}</div>
      </div>
      <p class="dim" style="font-size:11px;margin:-6px 0 10px">Valores da 2.ª luta (azul) e a diferença para a 1.ª (dourada).</p>
      ${svgCurvas([a, b])}
      ${
        comuns.length
          ? `<table><thead><tr><th>Habilidade</th><th class="num">1.ª</th><th class="num">2.ª</th><th class="num">Dif.</th></tr></thead><tbody>${comuns
              .map((h) => {
                const k = b.habilidades.find((x) => x.nome === h.nome);
                return `<tr><td>${esc(h.nome)}</td><td class="num">${curto(h.dano)}</td><td class="num">${curto(k.dano)}</td><td class="num">${dif(h.dano, k.dano)}</td></tr>`;
              })
              .join('')}</tbody></table>`
          : '<p class="dim" style="font-size:12px">Sem habilidades em comum para comparar.</p>'
      }`;
  }

  // ── carregar ────────────────────────────────────────────────────────────
  async function carregar() {
    lutas = await window.api.lutas();
    desenharAlvos();
    desenharLista();
    desenharDetalhe();
  }
  window.api.aoNovaLuta((l) => {
    lutas.unshift(l);
    desenharAlvos();
    desenharLista();
  });
  carregar();

  // Para os testes visuais (AION_JS) e o resto da app.
  window.Combate = { recarregar: carregar, curto, dpsPorSegundo };
})();
