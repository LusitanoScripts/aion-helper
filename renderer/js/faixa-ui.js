// As faixas por baixo dos cartões do jogo. O main manda o que pôr e onde, já em
// coordenadas desta janela; aqui só se desenha.
(function () {
  'use strict';

  const P = window.Precos;
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

  function faixaHTML(f) {
    const partes = [];
    if (f.preco) {
      const p = f.preco;
      partes.push(`<div class="linha">
        <span class="rotulo">${esc(p.base === 'vendido' ? 'média vendida' : p.base === 'referência' ? 'referência 72 h' : 'anúncio mais barato')}</span>
        <span class="preco">${P.formatarKinah(p.valor)}</span>
        <span class="dim">recebes ${P.formatarKinah(P.liquido(p.valor))} · ${esc(p.anuncios)} anúncios · ${esc(p.servidor)}</span>
      </div>`);
      if (p.deOutro) partes.push(`<div class="aviso">${esc(p.deOutro)}</div>`);
      if (p.avisos && p.avisos.length) partes.push(`<div class="aviso">⚠ ${esc(p.avisos.join(' · '))}</div>`);
      if (p.outros) partes.push(`<div class="dim">ou ${esc(p.outros)}</div>`);
    } else if (f.motivo) {
      partes.push(`<div class="fora">${esc(f.motivo)}</div>`);
    }
    if (f.venda) partes.push(`<div class="venda v-${esc(f.venda.onde)}">${esc(f.venda.frase)}</div>`);
    if (f.nota) partes.push(`<div class="nota">${esc(f.nota)}</div>`);
    partes.push(`<div class="atalho">${f.nota ? 'Ctrl+Alt+N muda a nota' : 'Ctrl+Alt+N escreve uma nota para este item'}</div>`);
    return `<div class="faixa" style="left:${f.x}px;top:${f.y}px;width:${f.largura}px">${partes.join('')}</div>`;
  }

  window.api.aoMostrarFaixas((faixas) => {
    document.getElementById('faixas').innerHTML = faixas.map(faixaHTML).join('');
  });
})();
