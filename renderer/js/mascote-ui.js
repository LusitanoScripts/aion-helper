// O aviso das mascotes por cima do jogo. O main manda o que pôr e onde, já em
// coordenadas desta janela; aqui só se desenha.
(function () {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

  // Almas para o nível seguinte (como na coleção do jogo: nível 1 → 25, nível 2 → 75; o 3 é o máximo).
  const ALMAS_POR_NIVEL = { 1: 25, 2: 75 };

  function almasHTML(a) {
    if (a.tem && a.nivel >= 3) return '<div class="m-max">nível máximo</div>';
    const precisa = a.tem && a.nivel ? ALMAS_POR_NIVEL[a.nivel] || a.almasPrecisa : null;
    if (precisa) {
      const tem = Math.min(precisa, a.almas || 0);
      return `<div>almas <b>${tem}/${precisa}</b> <span class="dim">· faltam ${precisa - tem} para o nív. ${a.nivel + 1}</span></div>`;
    }
    return `<div class="dim">${esc(a.almas)} alma(s) contadas</div>`;
  }

  function alvoHTML(a) {
    const estado = a.tem
      ? `<span class="m-tem">✔ já a tens</span>${a.nivel ? ` · nív. ${esc(a.nivel)}` : ''}`
      : '<span class="m-falta">✘ falta-te esta mascote</span>';
    return `<div class="faixa mascote" style="left:${a.x}px;top:${a.y}px">
      <div class="linha"><span class="rotulo">mascote${a.grau ? ' · ' + esc(a.grau) : ''}</span></div>
      <div class="m-nome">${esc(a.nome)}${a.outro && a.outro !== a.nome ? ` <span class="dim">${esc(a.outro)}</span>` : ''}</div>
      <div>${estado}</div>
      ${almasHTML(a)}
    </div>`;
  }

  // Dois toques curtos quando aparece um recurso novo no radar; três a subir
  // quando aparece um Hidden Cube.
  let somVisto = 0;
  let somCubo = 0;
  let audio = null;
  function tocar(notas = [880, 1175]) {
    try {
      audio = audio || new AudioContext();
      if (audio.state === 'suspended') audio.resume();
      notas.forEach((freq, i) => {
        const t = i * 0.16;
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, audio.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.14);
        o.connect(g).connect(audio.destination);
        o.start(audio.currentTime + t);
        o.stop(audio.currentTime + t + 0.15);
      });
    } catch {
      /* sem som segue na mesma */
    }
  }

  function radarHTML(r) {
    const lista = r.recursos.length
      ? r.recursos
          .map(
            (x) => `<div class="r-item${x.novo ? ' r-novo' : ''}${x.claro ? '' : ' r-outro'}">
              <span class="r-seta">${esc(x.seta)}</span><b>${r.aproximado ? '≈' : ''}${esc(x.metros)} m</b>${x.claro ? '' : ' <span class="dim">outro andar</span>'}</div>`,
          )
          .join('')
      : '<div class="dim">nada no radar</div>';
    const mais = r.total > r.recursos.length ? `<div class="dim">+${r.total - r.recursos.length} mais longe</div>` : '';
    return `<div class="faixa mascote radar-r" style="left:${r.x}px;top:${r.y}px">
      <div class="linha"><span class="rotulo">recolha · ${esc(r.total)} no radar</span></div>
      ${lista}${mais}
      ${r.aproximado ? '<div class="atalho">passa o rato num losango para acertar a distância</div>' : ''}
      <div class="atalho">${esc(r.atalho)} desliga</div>
    </div>`;
  }

  function cuboHTML(c) {
    const aneis = (c.marcas || [])
      .map((m) => `<div class="cubo-anel" style="left:${m.x - m.r}px;top:${m.y - m.r}px;width:${2 * m.r}px;height:${2 * m.r}px"></div>`)
      .join('');
    return `${aneis}<div class="faixa mascote cubo-r" style="left:${c.x}px;top:${c.y}px">
      <div class="cubo-t">◆ ${esc(c.texto)}</div>
      <div class="atalho">${esc(c.atalho)} desliga</div>
    </div>`;
  }

  window.api.aoMostrarMascote(({ alvo, aviso, radar, cubo }) => {
    document.getElementById('cubo').innerHTML = cubo ? cuboHTML(cubo) : '';
    if (cubo && cubo.somId > somCubo) tocar([660, 880, 1320]);
    somCubo = cubo ? cubo.somId : somCubo;
    // Só se mexe no painel quando os números mudam: reescrever a cada leitura fazia-o piscar.
    const htmlRadar = radar ? radarHTML(radar) : '';
    const elRadar = document.getElementById('radar');
    if (elRadar.innerHTML !== htmlRadar && elRadar.dataset.html !== htmlRadar) {
      elRadar.innerHTML = htmlRadar;
      elRadar.dataset.html = htmlRadar;
    }
    // somId sobe a cada recurso novo; recomeça a 0 quando o modo volta a ligar.
    if (!radar) somVisto = 0;
    else if (radar.somId !== somVisto) {
      if (radar.somId > somVisto) tocar();
      somVisto = radar.somId;
    }
    document.getElementById('alvo').innerHTML = alvo ? alvoHTML(alvo) : '';
    document.getElementById('aviso').innerHTML = aviso
      ? `<div class="faixa mascote aviso-m" style="left:${aviso.x}px;top:${aviso.y}px">${esc(aviso.texto)}</div>`
      : '';
  });
})();
