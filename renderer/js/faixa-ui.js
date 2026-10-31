// As faixas por baixo dos cartões do jogo. O main manda o que pôr e onde, já em
// coordenadas desta janela; aqui só se desenha.
(function () {
  'use strict';

  const P = window.Precos;
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

  /** Título: o da carta contra o efeito equipado, atributo a atributo. */
  function tituloHTML(f) {
    const t = f.titulo;
    const num = (d) => `${d.delta > 0 ? '+' : d.delta < 0 ? '−' : ''}${Math.abs(d.delta)}${d.pct ? '%' : ''}`;
    const linhas = t.diferencas
      .map((d) => `<div class="tl ${d.delta > 0 ? 'sobe' : d.delta < 0 ? 'desce' : 'igual'}"><b>${esc(num(d))}</b> ${esc(d.nome)} <span class="dim">${esc(d.de)} → ${esc(d.para)}</span></div>`)
      .join('');
    return `<div class="faixa" style="left:${f.x}px;top:${f.y}px;width:${f.largura}px">
      <div class="tl-cab">Trocar <b>${esc(t.equipado.nome || 'o equipado')}</b> por <b>${esc(t.escolhido.nome || 'este')}</b></div>
      ${linhas}
      <div class="atalho">Atributos diferentes não se somam: compara o que te faz falta · Ctrl+Alt+P para comparar outro</div>
    </div>`;
  }

  function faixaHTML(f) {
    if (f.titulo) return tituloHTML(f);
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
