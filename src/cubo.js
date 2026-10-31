'use strict';

// Os Hidden Cubes no ecrã: o cubo vermelho que brilha, visto no mundo. Não
// aparece no minimapa nem no mapa, por isso a app procura-o na própria imagem
// do jogo e avisa. Só se olha para o ecrã — nada de memória nem de rede: se o
// cubo não está à vista (atrás de uma rocha, debaixo de água funda), não se vê.
//
// Medido na captura do utilizador (2560×1440, 24 Out 2026, Altgard, cubo sobre
// a água a ~uns 40 m): disco de 19×19 px, 266 píxeis vermelhos (74% da caixa),
// cor média 205,118,103, com o desenho das rodas em rosa claro (228,136,114) e
// o miolo escuro (139,65,47). É o cubo em 3D, não um ícone: o tamanho muda com
// a distância, por isso aceita-se uma gama larga e decide-se pela forma.
//
// O que engana: o cabelo do pet (186,117,85, mas 23×16 e meio desfeito), a
// barra de vida (fina), ícones vermelhos do radar (pequenos demais).

const REF_ALTURA = 1440;
const BANDO = 6; // ecrãs normais: 0–5 brilhos rosa (a metade); zonas enfeitadas: 24–59

// Vermelho-rosado com brilho: o vermelho bem acima do verde e do azul.
function vermelho(px, i) {
  const r = px[i];
  return r >= 120 && r - px[i + 1] >= 40 && r - px[i + 2] >= 30;
}

/**
 * Os cubos de uma imagem: [{ x, y, lado }] (centro e lado da caixa, em píxeis da
 * imagem). k = píxeis da imagem por píxel de 1440p (0,5 para o ecrã de 1440p
 * reduzido a metade).
 *
 * solto: regras de forma mais largas e sem a regra do bando — só para pôr o anel
 * por baixo de um rótulo "Hidden Cube" já lido (aí sabe-se que há cubo). Os cubos
 * reais ao sol ou vistos de lado dão cheio 0,48–0,54 e disco 0,57–0,66.
 */
function encontrarCubos(img, k = 1, { solto = false } = {}) {
  const { largura: W, altura: H, px } = img;
  // Cada mancha fica marcada com o seu número (para depois olhar para os cantos).
  const visto = new Int32Array(W * H);
  let id = 0;
  const out = [];
  const pilha = [];
  // Abaixo de 14 px (a 1440p) já está longe, e a metade sobram 6 píxeis de
  // qualquer brilho (um ícone em chamas na mochila passava assim).
  const min = Math.max(6, 14 * k);
  const max = 140 * k;
  let brilhos = 0; // manchas rosa claro de qualquer forma (enfeites, candeeiros…)
  for (let y0 = 0; y0 < H; y0++) {
    for (let x0 = 0; x0 < W; x0++) {
      const k0 = y0 * W + x0;
      if (visto[k0] || !vermelho(px, k0 * 4)) continue;
      visto[k0] = ++id;
      pilha.push(k0);
      let n = 0, sx = 0, sy = 0, sg = 0, sb = 0, claros = 0, x1 = x0, x2 = x0, y1 = y0, y2 = y0;
      while (pilha.length) {
        const q = pilha.pop();
        const qx = q % W;
        const qy = (q / W) | 0;
        n++;
        sx += qx;
        sy += qy;
        sg += px[q * 4 + 1];
        sb += px[q * 4 + 2];
        if (px[q * 4] >= 200 && px[q * 4 + 1] >= 100) claros++;
        if (qx < x1) x1 = qx;
        if (qx > x2) x2 = qx;
        if (qy < y1) y1 = qy;
        if (qy > y2) y2 = qy;
        if (qx > 0 && !visto[q - 1] && vermelho(px, (q - 1) * 4)) (visto[q - 1] = id), pilha.push(q - 1);
        if (qx < W - 1 && !visto[q + 1] && vermelho(px, (q + 1) * 4)) (visto[q + 1] = id), pilha.push(q + 1);
        if (qy > 0 && !visto[q - W] && vermelho(px, (q - W) * 4)) (visto[q - W] = id), pilha.push(q - W);
        if (qy < H - 1 && !visto[q + W] && vermelho(px, (q + W) * 4)) (visto[q + W] = id), pilha.push(q + W);
      }
      const w = x2 - x1 + 1;
      const h = y2 - y1 + 1;
      // Só rosa (verde e azul parecidos, como no cubo: 114/99); o texto dourado
      // e o laranja das abóboras de longe não contam.
      if (Math.max(w, h) >= Math.max(3, 0.3 * min) && n >= 4 && claros >= 0.35 * n && (sg - sb) / n <= 35) brilhos++;
      // Redondo e cheio: um disco enche ~79% da caixa; o desenho e o miolo
      // escuro abrem uns buracos. Barras, letras e bocados de pet ficam fora.
      if (w < min || h < min || w > max || h > max) continue;
      if (w > h * 1.3 || h > w * 1.3) continue;
      const cheio = n / (w * h);
      if (cheio < (solto ? 0.4 : 0.55) || cheio > 0.92) continue;
      // O cubo brilha: ~60% dos píxeis são rosa claro. Os ícones vermelhos dos
      // itens (mochila, cartões) ficam entre 16 e 29%.
      const fClaros = claros / n;
      if (fClaros < 0.35 || fClaros > 0.9) continue;
      // Redondo de verdade: a mancha comparada com o disco da caixa. O cubo dá
      // 0,83; um ícone de habilidade vermelho da barra (quadrado, com a arte por
      // dentro) dá 0,65 e passava em tudo o resto — visto ao vivo, 24 Out.
      if (pareceDisco(visto, W, id, x1, y1, w, h) < (solto ? 0.5 : 0.74)) continue;
      out.push({ x: sx / n, y: sy / n, lado: Math.max(w, h), claros: fClaros });
    }
  }
  // Os enfeites vêm em bando: filas de candeeiros, abóboras e fantasmas de
  // Halloween têm o mesmo rosa e, a 10 px, a mesma forma do cubo (24 Out, em
  // Altgard). O cubo está sozinho no mato; com muitos brilhos no ecrã é uma zona
  // enfeitada e não se avisa nada.
  if (process.env.AION_CUBO_DEPURAR) console.error('brilhos', brilhos);
  return brilhos >= BANDO && !solto ? [] : out;
}

/** Interseção sobre união da mancha `id` com o disco inscrito na caixa (1 = disco perfeito). */
function pareceDisco(visto, W, id, x1, y1, w, h) {
  const cx = x1 + (w - 1) / 2;
  const cy = y1 + (h - 1) / 2;
  const R = (w + h) / 4;
  let inter = 0, uniao = 0;
  for (let y = y1; y < y1 + h; y++) {
    for (let x = x1; x < x1 + w; x++) {
      const d = Math.hypot(x - cx, y - cy) <= R;
      const m = visto[y * W + x] === id;
      if (d && m) inter++;
      if (d || m) uniao++;
    }
  }
  return inter / uniao;
}

/**
 * Um cubo só conta depois de visto em `confirmar` leituras seguidas mais ou menos
 * no mesmo sítio (a câmara mexe-se, por isso há folga): um clarão vermelho de um
 * feitiço não chega. Esquece-se ao fim de `esquecer` leituras sem o ver.
 */
class Seguidor {
  constructor({ raio = 90, confirmar = 2, esquecer = 2 } = {}) {
    this.raio = raio;
    this.confirmar = confirmar;
    this.esquecer = esquecer;
    this.vistos = []; // { x, y, lado, vezes, falta, avisado }
  }

  /** Recebe os cubos desta leitura; devolve { confirmados, novos } (novos = ainda não avisados). */
  ver(cubos, k = 1) {
    const raio = this.raio * k;
    const livres = new Set(this.vistos.keys());
    for (const c of cubos) {
      let melhor = -1;
      let dMelhor = raio;
      for (const i of livres) {
        const v = this.vistos[i];
        const d = Math.hypot(v.x - c.x, v.y - c.y);
        if (d <= dMelhor) (dMelhor = d), (melhor = i);
      }
      if (melhor >= 0) {
        livres.delete(melhor);
        const v = this.vistos[melhor];
        Object.assign(v, { x: c.x, y: c.y, lado: c.lado, vezes: v.vezes + 1, falta: 0 });
      } else {
        this.vistos.push({ x: c.x, y: c.y, lado: c.lado, vezes: 1, falta: 0, avisado: false });
      }
    }
    for (const i of livres) this.vistos[i].falta++;
    this.vistos = this.vistos.filter((v) => v.falta <= this.esquecer);
    const confirmados = this.vistos.filter((v) => v.vezes >= this.confirmar && v.falta === 0);
    const novos = confirmados.filter((v) => !v.avisado);
    for (const v of novos) v.avisado = true;
    return { confirmados, novos };
  }

  limpar() {
    this.vistos = [];
  }
}


// O rótulo que o jogo escreve por cima do cubo quando se está perto (visto a 24
// Out: "Hidden Cube", verde-água, ~65,133,97). O ocr.ps1 (ROTULOS) só dá ao OCR
// os píxeis desta cor — o texto tal como está, sobre a relva, não se lê.
function verdeAgua(px, i) {
  const r = px[i];
  const g = px[i + 1];
  const b = px[i + 2];
  return g >= 95 && g - r >= 45 && b >= 60 && g - b >= 15 && g - b <= 70;
}

// "Hidden Cube" com folga para o OCR (l/1/I no lugar do i, espaço a mais ou a
// menos); no cliente em português o nome ainda não foi visto — aceita "Cubo
// Oculto/Escondido/Secreto".
const ROTULO = /h\s*[il1|!]\s*d\s*d?\s*e\s*n\s*c\s*[uv]\s*[b6]\s*[e3a]|cubo\s*(oculto|escondido|secreto)/i;

/** As linhas do OCR que são o rótulo de um cubo: [{ x, y }] (centro da linha). */
function rotulosDeCubo(linhas) {
  return linhas.filter((l) => ROTULO.test(l.t)).map((l) => ({ x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2, altura: l.y2 - l.y1 }));
}

module.exports = { REF_ALTURA, encontrarCubos, Seguidor, verdeAgua, rotulosDeCubo };
