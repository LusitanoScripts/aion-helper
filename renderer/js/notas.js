// A aba das notas: escrever a nota de um item (vinda do Ctrl+Alt+N, com o nome
// do último cartão lido) e ver todas as que há.
(function () {
  'use strict';

  const { esc } = window.U;
  const $ = (s) => document.querySelector(s);

  function abrirAba() {
    document.querySelector('#abas [data-aba=notas]').click();
  }

  async function lista(todas) {
    const ns = todas || (await window.api.notas());
    $('#notasLista').innerHTML = ns.length
      ? ns
          .map(
            (n) => `<div class="nota-item" data-nome="${esc(n.nome)}">
              <div class="nome">${esc(n.nome)}</div>
              <div class="texto">${esc(n.texto)}</div>
            </div>`,
          )
          .join('')
      : '<p class="dim">Ainda não há notas. Passa o rato por um item no jogo, carrega em <b>Ctrl+Alt+P</b> e depois em <b>Ctrl+Alt+N</b>.</p>';
  }

  function editar(nome, texto) {
    $('#notaNome').value = nome || '';
    $('#notaTexto').value = texto || '';
    $('#notaTexto').focus();
  }

  async function notaDe(nome) {
    const ns = await window.api.notas();
    const n = ns.find((x) => window.U.normalizar(x.nome) === window.U.normalizar(nome));
    return n ? n.texto : '';
  }

  // Ctrl+Alt+N: abre aqui com o nome do último cartão lido. Com dois cartões
  // (o do item e o do equipado, para comparar), o primeiro é o que se apontou.
  window.api.aoEditarNota(async ({ nomes }) => {
    abrirAba();
    const lidos = (nomes || []).filter(Boolean);
    $('#notaEscolha').innerHTML = lidos.length > 1
      ? 'Último cartão lido: ' + lidos.map((n) => `<button class="chip" data-nome="${esc(n)}">${esc(n)}</button>`).join(' ')
      : '';
    if (lidos.length) editar(lidos[0], await notaDe(lidos[0]));
    else editar('', '');
  });

  $('#notaEscolha').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-nome]');
    if (b) editar(b.dataset.nome, await notaDe(b.dataset.nome));
  });
  $('#notasLista').addEventListener('click', (e) => {
    const d = e.target.closest('.nota-item');
    if (d) editar(d.dataset.nome, d.querySelector('.texto').textContent);
  });

  async function guardar() {
    const nome = $('#notaNome').value.trim();
    if (!nome) {
      $('#notaNome').focus();
      return;
    }
    await lista(await window.api.escreverNota(nome, $('#notaTexto').value));
    if (window.Mochila && window.Mochila.notasMudaram) window.Mochila.notasMudaram();
    $('#notaGuardada').textContent = $('#notaTexto').value.trim() ? 'guardada ✓' : 'apagada';
    setTimeout(() => ($('#notaGuardada').textContent = ''), 2000);
  }

  $('#btnGuardarNota').addEventListener('click', guardar);
  $('#btnApagarNota').addEventListener('click', async () => {
    $('#notaTexto').value = '';
    await guardar();
  });
  $('#notaTexto').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) guardar();
  });

  // O resultado de cada Ctrl+Alt+P aparece na barra de estado, para se perceber
  // quando a faixa não aparece (nenhum cartão no ecrã, OCR em baixo…).
  window.api.aoLerCartoes((r) => {
    const e = $('#cartoesEstado');
    if (r.erro) e.innerHTML = `<span class="erro">Ctrl+Alt+P falhou: ${esc(r.erro)}</span>`;
    else if (!r.faixas.length) e.textContent = `Ctrl+Alt+P: não vi nenhum cartão de item no ecrã (${r.ms} ms).`;
    else e.textContent = r.auto ? `cartão: ${r.faixas.map((f) => f.nome).join(' · ')}` : `Ctrl+Alt+P: ${r.faixas.map((f) => f.nome).join(' · ')} (${r.ms} ms)`;
  });

  window.api.atalhos().then((a) => {
    if (a.falhas.length) {
      $('#cartoesEstado').innerHTML = `<span class="erro">Outro programa já usa ${esc(a.falhas.join(' e '))}: esse atalho não funciona.</span>`;
    }
  });

  window.api.definicoes().then((d) => {
    $('#cartoesAuto').checked = d.automatico !== false;
  });
  $('#cartoesAuto').addEventListener('change', (e) => window.api.cartoesAuto(e.target.checked));

  lista();
})();
