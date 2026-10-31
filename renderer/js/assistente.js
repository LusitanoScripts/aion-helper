// A aba Assistente: conversa com o Gemini (via processo principal) e a chave nas Definições.
// A conversa fica só em memória: fechar a app começa uma nova.
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const { esc } = window.U;

  const SUGESTOES = [
    'Dá-me dicas para as missões que tenho no canto do ecrã.',
    'Analisa a minha mochila: o que vendo no mercado, o que dou à loja e o que guardo?',
    'O que há para fazer na próxima hora?',
    'Quanto vale um Cristal de Vida no meu servidor?',
    'Sugere uma build de Gladiador para PvE a partir das habilidades e do Daevanion.',
    'Olha para as minhas builds guardadas e diz-me o que mudarias.',
  ];

  // [o que aparece enquanto espera, o nome na lista de fontes]
  const FERRAMENTAS = {
    missoes_no_ecra: ['a ler as missões no ecrã', 'missões no ecrã'],
    pesquisar_web: ['a pesquisar na web', 'pesquisa Google'],
    procurar_item: ['a procurar o item', 'itens'],
    preco_item: ['a ver o preço', 'preços'],
    mochila: ['a ler a mochila', 'mochila'],
    horarios: ['a ver os horários', 'horários'],
    classes: ['a ver as classes', 'classes'],
    habilidades_classe: ['a ver as habilidades', 'habilidades'],
    daevanion_classe: ['a ver o Daevanion', 'Daevanion'],
    builds_guardadas: ['a ler as tuas builds', 'as tuas builds'],
  };

  let historico = []; // [{ papel: 'eu'|'assistente', texto }]
  let anexos = []; // imagens coladas para a próxima pergunta: [{ tipo, dados (base64), url }]
  const MAX_ANEXOS = 3;
  const LADO_MAX = 1600; // px: chega para ler um cartão e poupa quota
  let temChave = false;
  let ocupado = false;

  // ── texto das respostas ────────────────────────────────────────────────────
  /** Markdown simples e seguro: escapa tudo primeiro, depois negrito, itálico, código e listas. */
  function formatar(texto) {
    const linhas = esc(texto).split(/\r?\n/);
    const out = [];
    let lista = null;
    const inline = (s) =>
      s
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const l of linhas) {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
      if (m) {
        const tipo = /^\s*\d/.test(l) ? 'ol' : 'ul';
        if (!lista || lista.tipo !== tipo) {
          if (lista) out.push(`</${lista.tipo}>`);
          lista = { tipo };
          out.push(`<${tipo}>`);
        }
        out.push(`<li>${inline(m[1])}</li>`);
        continue;
      }
      if (lista) {
        out.push(`</${lista.tipo}>`);
        lista = null;
      }
      const h = /^\s*#{1,4}\s+(.*)$/.exec(l);
      if (h) out.push(`<h4>${inline(h[1])}</h4>`);
      else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    }
    if (lista) out.push(`</${lista.tipo}>`);
    return out.join('');
  }

  // ── conversa ───────────────────────────────────────────────────────────────
  function bolha(papel, html, extra = '') {
    const d = document.createElement('div');
    d.className = `as-msg as-${papel}${extra ? ' ' + extra : ''}`;
    d.innerHTML = html;
    $('#asConversa').appendChild(d);
    d.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return d;
  }

  function desenharSugestoes() {
    $('#asSugestoes').innerHTML = historico.length
      ? ''
      : SUGESTOES.map((s) => `<button type="button" class="as-sug" data-sug="${esc(s)}">${esc(s)}</button>`).join('');
  }

  function estadoChave() {
    $('#asSemChave').hidden = temChave;
    $('#asForm').hidden = !temChave;
    $('#asSugestoes').hidden = !temChave;
    $('#asAutoLinha').hidden = !temChave;
    $('#asConversa').hidden = !temChave;
  }

  // ── imagens coladas ────────────────────────────────────────────────────────
  /** Lê a imagem e reduz para JPEG até LADO_MAX px (o CSP não deixa usar blob:, por isso vai por data:). */
  function reduzir(ficheiro) {
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onerror = () => reject(new Error('não consegui ler a imagem'));
      leitor.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('imagem inválida'));
        img.onload = () => {
          const k = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k);
          c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.9);
          resolve({ tipo: 'image/jpeg', dados: url.slice(url.indexOf(',') + 1), url });
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(ficheiro);
    });
  }

  async function juntarImagens(ficheiros) {
    for (const f of ficheiros) {
      if (!f || !/^image\//.test(f.type) || anexos.length >= MAX_ANEXOS) continue;
      try {
        anexos.push(await reduzir(f));
      } catch {
        /* imagem estragada: ignora-se */
      }
    }
    desenharAnexos();
  }

  function desenharAnexos() {
    $('#asAnexos').innerHTML = anexos
      .map((a, i) => `<span class="as-anexo"><img src="${a.url}" alt="" /><button type="button" data-tira="${i}" title="Tirar">✕</button></span>`)
      .join('');
  }

  $('#asAnexos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tira]');
    if (!b) return;
    anexos.splice(+b.dataset.tira, 1);
    desenharAnexos();
  });
  $('#asPergunta').addEventListener('paste', (e) => {
    const itens = [...((e.clipboardData && e.clipboardData.items) || [])];
    const fotos = itens.filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile());
    if (!fotos.length) return; // texto: cola normalmente
    e.preventDefault();
    juntarImagens(fotos);
  });
  $('#asForm').addEventListener('dragover', (e) => e.preventDefault());
  $('#asForm').addEventListener('drop', (e) => {
    const fotos = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => /^image\//.test(f.type));
    if (!fotos.length) return;
    e.preventDefault();
    juntarImagens(fotos);
  });

  async function enviar(pergunta) {
    pergunta = String(pergunta || '').trim();
    if ((!pergunta && !anexos.length) || ocupado) return;
    ocupado = true;
    const imagens = anexos;
    anexos = [];
    desenharAnexos();
    $('#asEnviar').disabled = true;
    $('#asPergunta').value = '';
    bolha(
      'eu',
      (imagens.length ? `<div class="as-fotos">${imagens.map((a) => `<img src="${a.url}" alt="" />`).join('')}</div>` : '') +
        esc(pergunta).replace(/\n/g, '<br>'),
    );
    const espera = bolha('assistente', '<span class="as-pensa">a pensar…</span>', 'as-espera');
    $('#asSugestoes').innerHTML = '';
    try {
      const r = await window.api.assistentePerguntar(historico, pergunta, imagens.map(({ tipo, dados }) => ({ tipo, dados })));
      // As imagens não voltam a ir nas perguntas seguintes (só o texto): poupa quota.
      const marca = imagens.length ? ` [colou ${imagens.length} imagem(ns)]` : '';
      historico.push({ papel: 'eu', texto: (pergunta || 'O que vês nesta imagem?') + marca }, { papel: 'assistente', texto: r.texto });
      espera.classList.remove('as-espera');
      const fontes = [...new Set((r.usadas || []).map((n) => (FERRAMENTAS[n] || [n, n])[1]))];
      espera.innerHTML =
        formatar(r.texto) +
        `<div class="as-fontes">${fontes.length ? 'Com dados da app: ' + esc(fontes.join(', ')) : 'Sem dados da app nesta resposta'} · ${esc(r.modelo || '')}</div>`;
    } catch (e) {
      espera.classList.remove('as-espera');
      espera.classList.add('as-erro');
      espera.innerHTML = esc(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      ocupado = false;
      $('#asEnviar').disabled = false;
      $('#asPergunta').focus();
    }
  }

  // Dica automática das missões (main.js): aparece como mensagem do Assistente.
  window.api.aoDicaAssistente((r) => {
    historico.push({ papel: 'assistente', texto: r.texto });
    const fontes = [...new Set((r.usadas || []).map((n) => (FERRAMENTAS[n] || [n, n])[1]))];
    bolha(
      'assistente',
      '<div class="as-etiqueta">Dica automática · ' + esc((r.missoes || []).join(', ')) + '</div>' +
        formatar(r.texto) +
        '<div class="as-fontes">' + (fontes.length ? 'Com dados da app: ' + esc(fontes.join(', ')) : '') + '</div>',
      'as-dica',
    );
    desenharSugestoes();
  });
  $('#asAuto').addEventListener('change', (e) => window.api.mudarDefinicoes({ dicasMissoes: e.target.checked }));

  window.api.aoUsarAssistente((nome) => {
    const p = document.querySelector('.as-espera .as-pensa');
    if (p) p.textContent = ((FERRAMENTAS[nome] || [])[0] || 'a ver os dados') + '…';
  });

  $('#asForm').addEventListener('submit', (e) => {
    e.preventDefault();
    enviar($('#asPergunta').value);
  });
  $('#asPergunta').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar($('#asPergunta').value);
    }
  });
  $('#asSugestoes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sug]');
    if (b) enviar(b.dataset.sug);
  });
  $('#asLimpar').addEventListener('click', () => {
    historico = [];
    $('#asConversa').innerHTML = '';
    desenharSugestoes();
  });
  $('#asIrDefs').addEventListener('click', () => {
    document.querySelector('#abas button[data-aba="definicoes"]').click();
    $('#geminiChave').focus();
  });

  // ── chave (Definições) ─────────────────────────────────────────────────────
  function mostrarEstadoChave(g) {
    temChave = !!(g && g.temChave);
    $('#geminiEstado').innerHTML = temChave
      ? `<span class="ok-txt">Chave guardada</span>${g.modelo ? ` · modelo ${esc(g.modelo)}` : ''}`
      : 'Sem chave';
    $('#geminiApagar').disabled = !temChave;
    estadoChave();
  }

  $('#geminiGuardar').addEventListener('click', async () => {
    const chave = $('#geminiChave').value.trim();
    if (!chave) return;
    $('#geminiGuardar').disabled = true;
    $('#geminiEstado').textContent = 'a testar a chave…';
    try {
      mostrarEstadoChave(await window.api.assistenteChave(chave));
      $('#geminiChave').value = '';
    } catch (e) {
      $('#geminiEstado').innerHTML = `<span class="erro-txt">${esc(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</span>`;
    } finally {
      $('#geminiGuardar').disabled = false;
    }
  });
  $('#geminiApagar').addEventListener('click', async () => {
    mostrarEstadoChave(await window.api.assistenteChave(''));
  });

  window.api.definicoes().then((d) => {
    mostrarEstadoChave(d.gemini);
    $('#asAuto').checked = !!d.dicasMissoes;
  });
  desenharSugestoes();
})();
