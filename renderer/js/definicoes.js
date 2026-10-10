// A aba das definições: que servidores servem de reserva quando o teu não tem
// anúncios de um item. Cada pessoa escolhe — a app vai ser partilhada, e o
// servidor certo para um Elyos da América não é o de um Asmodiano da Europa.
(function () {
  'use strict';

  const { esc, facao } = window.U;
  const $ = (s) => document.querySelector(s);
  let estado = null;

  function estadoOCR(i) {
    const pedido = i.idioma.split('-')[0];
    const tem = i.ocr && i.ocr.split('-')[0] === pedido;
    $('#idiomaEstado').innerHTML = tem
      ? `OCR do Windows: ${esc(i.ocr)}`
      : `<span class="aviso-txt">O Windows não tem o OCR de ${esc(i.idiomas ? i.idiomas[i.idioma] : i.idioma)}: está a usar ${esc(i.ocr || '?')}. Instala o pacote de idioma (Definições do Windows → Hora e idioma → Idioma) para ler bem os nomes.</span>`;
  }

  async function carregarIdioma() {
    const i = await window.api.idioma();
    $('#idiomaJogo').innerHTML = Object.entries(i.idiomas)
      .map(([k, v]) => `<option value="${k}"${k === i.idioma ? ' selected' : ''}>${esc(v)}</option>`)
      .join('');
    estadoOCR(i);
  }

  $('#idiomaJogo').addEventListener('change', async (e) => {
    $('#idiomaEstado').textContent = 'A mudar…';
    const r = await window.api.mudarIdioma(e.target.value);
    estadoOCR({ ...r, idiomas: null });
    // Os nomes da lista de preços vêm agora neste idioma.
    if (window.App && window.App.recarregar) window.App.recarregar();
  });

  async function carregar() {
    carregarIdioma();
    desenharAlertas(await window.api.alertas());
    estado = await window.api.reservas();
    desenhar();
    // Sem tamanhos guardados, mede-se já: sem eles não se sabe que servidores valem a pena.
    if (!Object.keys(estado.tamanhos).length) medir();
  }

  async function medir() {
    $('#btnMedir').disabled = true;
    $('#reservasEstado').textContent = 'A medir o mercado de cada servidor…';
    try {
      estado.tamanhos = await window.api.medirReservas();
      estado = { ...(await window.api.reservas()), tamanhos: estado.tamanhos };
      $('#reservasEstado').textContent = '';
    } catch (e) {
      $('#reservasEstado').textContent = 'Não consegui medir: ' + e.message;
    } finally {
      $('#btnMedir').disabled = false;
    }
    desenhar();
  }

  window.api.aoProgressoReservas((p) => {
    $('#reservasEstado').textContent = `A medir o mercado de cada servidor… ${p.feitos}/${p.total}`;
  });

  function desenhar() {
    if (!estado) return;
    const { servidores, tamanhos, marcados, escolhido, automatico } = estado;
    const auto = servidores.find((s) => s.id === automatico);
    const meu = servidores.find((s) => s.id === escolhido);
    $('#reservasModo').innerHTML = marcados.length
      ? `Estás a usar <b>${marcados.length}</b> servidor${marcados.length > 1 ? 'es' : ''} de reserva, do mercado maior para o menor.
         <button id="btnLimparReservas" class="link">voltar ao automático</button>`
      : `Automático: ${auto ? `<b>${esc(auto.nome)}</b> (${esc(auto.regiao)}, ${esc(facao(auto.facao))}), o maior da tua região e fação` : 'ainda a calcular'}.
         Marca servidores abaixo para escolheres tu.`;

    const maior = Math.max(1, ...Object.values(tamanhos).map(Number));
    const grupos = new Map();
    for (const s of servidores) {
      const g = s.regiaoNome || s.regiao;
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(s);
    }
    // A região do teu servidor primeiro: é aí que estão as reservas que fazem sentido.
    const ordem = [...grupos.keys()].sort((a, b) => (b === (meu && (meu.regiaoNome || meu.regiao))) - (a === (meu && (meu.regiaoNome || meu.regiao))));
    $('#reservasLista').innerHTML = ordem
      .map((g) => {
        const lista = grupos
          .get(g)
          .slice()
          .sort((a, b) => (tamanhos[b.id] || 0) - (tamanhos[a.id] || 0));
        return `<div class="reg"><h4>${esc(g)}</h4>${lista
          .map((s) => {
            const n = tamanhos[s.id];
            const eMeu = s.id === escolhido;
            const pct = n ? Math.max(2, Math.round((n / maior) * 100)) : 0;
            return `<label class="srv${eMeu ? ' meu' : ''}" title="${eMeu ? 'É o teu servidor (escolhe-se na aba Preços)' : ''}">
              <input type="checkbox" value="${s.id}" ${marcados.includes(s.id) ? 'checked' : ''} ${eMeu ? 'disabled' : ''} />
              <span class="n">${esc(s.nome)}${eMeu ? ' <small>(o teu)</small>' : ''}${s.id === automatico && !marcados.length ? ' <small class="auto">automático</small>' : ''}</span>
              <span class="f f-${esc((s.facao || '').toLowerCase())}">${esc(facao(s.facao))}</span>
              <span class="barra-t"><i style="width:${pct}%"></i></span>
              <span class="q">${n == null ? '—' : n + ' itens'}</span>
            </label>`;
          })
          .join('')}</div>`;
      })
      .join('');
  }

  $('#reservasLista').addEventListener('change', async () => {
    const ids = [...document.querySelectorAll('#reservasLista input:checked')].map((i) => Number(i.value));
    estado.marcados = await window.api.mudarReservas(ids);
    desenhar();
  });
  $('#reservasModo').addEventListener('click', async (e) => {
    if (e.target.id !== 'btnLimparReservas') return;
    estado.marcados = await window.api.mudarReservas([]);
    desenhar();
  });
  $('#btnMedir').addEventListener('click', medir);
  // As ligações do "Sobre" abrem no navegador.
  document.querySelector('#definicoes').addEventListener('click', (e) => {
    const a = e.target.closest('[data-link]');
    if (!a) return;
    e.preventDefault();
    window.api.abrirLink(a.dataset.link);
  });

  function desenharAlertas(lista) {
    $('#alertasLista').innerHTML = lista.length
      ? lista
          .map(
            (a) => `<div class="alerta-item">
              <span class="n">${esc(a.nome)}</span>
              <span class="dim">${esc(a.nomeServidor)} · ${window.Precos.formatarKinah(a.limite)} ou menos${a.avisado != null ? ` · avisado a ${window.Precos.formatarKinah(a.avisado)}` : ''}</span>
              <button class="link" data-item="${a.itemId}" data-srv="${a.servidor}">tirar</button>
            </div>`,
          )
          .join('')
      : '<p class="dim">Ainda não tens alertas.</p>';
  }
  $('#alertasLista').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-item]');
    if (b) desenharAlertas(await window.api.apagarAlerta(Number(b.dataset.item), Number(b.dataset.srv)));
  });
  window.api.aoMudaremAlertas(desenharAlertas);
  $('#btnDiagnostico').addEventListener('click', async () => {
    $('#btnDiagnostico').disabled = true;
    try {
      const dir = await window.api.guardarDiagnostico();
      $('#diagnosticoEstado').textContent = 'Guardado em ' + dir;
    } catch (e) {
      $('#diagnosticoEstado').textContent = 'Não consegui guardar: ' + e.message;
    } finally {
      $('#btnDiagnostico').disabled = false;
    }
  });

  // Carrega quando se abre a aba (e de cada vez: o servidor escolhido pode ter mudado).
  document.querySelector('#abas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-aba="definicoes"]');
    if (b) carregar();
  });
})();
