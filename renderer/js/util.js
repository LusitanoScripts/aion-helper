// Ajudas do renderer. Tudo dentro de uma função: os <script> clássicos partilham
// um só âmbito global e um `const` solto aqui colidia com o app.js.
(function () {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Escapa texto para meter em HTML. Tudo o que vem da rede passa por aqui. */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  /** Minúsculas e sem acentos, para procurar "pedra" e achar "Pedra de Superação". */
  function normalizar(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  function idade(ms) {
    if (ms == null) return '';
    const min = Math.round(ms / 60e3);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `há ${h} h`;
    return `há ${Math.round(h / 24)} dias`;
  }

  /** Linha de evolução em SVG; devolve '' com menos de 2 pontos. */
  function sparkline(valores, { largura = 260, altura = 56 } = {}) {
    const v = valores.filter((x) => Number.isFinite(x));
    if (v.length < 2) return '';
    const min = Math.min(...v);
    const max = Math.max(...v);
    const amp = max - min || 1;
    const pts = v
      .map((y, i) => `${((i / (v.length - 1)) * largura).toFixed(1)},${(altura - 4 - ((y - min) / amp) * (altura - 8)).toFixed(1)}`)
      .join(' ');
    return `<svg class="spark" viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none"><polyline points="${pts}" /></svg>`;
  }

  /** A fação como se diz em português (o aion2.exchange manda em inglês). */
  function facao(f) {
    return { Asmodian: 'Asmodiano', Elyos: 'Elyos' }[f] || f || '';
  }

  window.U = { esc, normalizar, idade, sparkline, facao };
})();
