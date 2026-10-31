'use strict';

// O canto direito do ecrã do jogo (nome da zona, minimapa e o seguidor de
// missões), a partir das linhas do OCR.
//
// Não se tenta separar títulos de passos: à resolução nativa têm quase a mesma
// altura (18 vs 17 px, medido em 1440p numa masmorra), e a diferença que se via
// numa captura vinha das letras com perna e dos "[ ]", não do tamanho da letra.
// O Gemini percebe a estrutura pela ordem do texto; aqui só se limpa:
//  - fora o relógio do minimapa e o lixo de 1–2 letras dos ícones;
//  - as frases que o jogo parte em duas linhas voltam a juntar-se;
//  - "[LV. 451" (o OCR leu "]" como "1") passa a "[Lv. 45]".

// O relógio do minimapa, com ou sem os dois pontos (o OCR às vezes perde-os: "1347").
const RELOGIO = /^\W*(\d{1,2}:\d{2}(:\d{2})?|\d{3,6})\W*$/;

/** "[LV. 451 Daeva Trapped" → "[Lv. 45] Daeva Trapped"; tira o lixo do ícone ao fim ("...A"). */
function limparLinha(t) {
  return String(t)
    .trim()
    // O losango/número à esquerda do título sai como lixo ("•", "-q '"): fora até à primeira letra ou "[",
    // e uma minúscula solta antes de uma maiúscula.
    .replace(/^[^\p{L}\p{N}[(]+/u, '')
    .replace(/^\p{Ll}(?!\p{L})\s*['’`"]?\s*(?=[\p{Lu}[])/u, '')
    .replace(/^\[?\s*L[vV]\.?\s*(\d{2})\s*[\]1l|I]?\s+/, (_m, n) => `[Lv. ${n}] `)
    .replace(/\.\.\.\s*\S?$/, '…')
    .replace(/\s+/g, ' ');
}

/** Linhas do OCR ([{ x1, y1, x2, y2, t }]) → { linhas: [texto] }, de cima para baixo. */
function organizarMissoes(linhas) {
  const L = (linhas || [])
    .map((l) => ({ ...l, t: limparLinha(l.t || '') }))
    .filter((l) => l.t.length >= 3 && !RELOGIO.test(l.t))
    .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const out = [];
  let ant = null;
  for (const l of L) {
    const h = l.y2 - l.y1;
    // Continuação: começa em minúscula, logo por baixo, e a anterior não acabou com contagem nem reticências.
    if (ant && /^[a-zà-ú]/.test(l.t) && l.y1 - ant.y2 < h * 1.4 && !/(\(\d+\/\d+\)|…)$/.test(ant.t)) {
      ant.t += ' ' + l.t;
      ant.y2 = l.y2;
      continue;
    }
    ant = { t: l.t, y2: l.y2 };
    out.push(ant);
  }
  return { linhas: out.map((x) => x.t) };
}

/** A mesma linha com outra contagem ("(0/4)" → "(2/4)") não conta como nova. */
function chaveLinha(t) {
  return String(t)
    .toLowerCase()
    .replace(/\(\d+\/\d+\)/g, '')
    .replace(/[^a-z0-9à-ú]+/g, '');
}

/** Chave do conjunto, para saber se mudou alguma coisa. */
function chaveMissoes(r) {
  return (r.linhas || []).map(chaveLinha).join('|');
}

/** As linhas de `r` que não estavam em `antes` (comparadas sem contagens). */
function linhasNovas(r, antes) {
  const vistas = new Set(((antes && antes.linhas) || []).map(chaveLinha));
  return (r.linhas || []).filter((t) => !vistas.has(chaveLinha(t)));
}

/** Texto para o Gemini. */
function textoMissoes(r, novas) {
  if (!r.linhas || !r.linhas.length) return 'Não vi texto no canto direito do ecrã.';
  const nova = new Set((novas || []).map(chaveLinha));
  return (
    'Texto do canto direito do ecrã do jogo, de cima para baixo (nome da zona, depois o seguidor de missões: ' +
    'títulos de missão seguidos dos seus passos/objetivos; "…" = cortado no ecrã):\n' +
    r.linhas.map((t) => `- ${t}${nova.has(chaveLinha(t)) ? '   [NOVO]' : ''}`).join('\n')
  );
}

module.exports = { organizarMissoes, chaveMissoes, linhasNovas, textoMissoes, limparLinha };
