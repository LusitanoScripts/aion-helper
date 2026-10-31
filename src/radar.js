'use strict';

// O modo recolha: os losangos dos recursos (minério, plantas…) no radar do
// canto, com a distância e a direção de cada um. Só se olha para o ecrã — nada
// de teclas nem de rato: quem anda e apanha é o jogador.
//
// Medido nas capturas do utilizador (2560×1440, 24 Out 2026):
// - o mapa do radar tem 331×221 px, encostado a 29 px da direita da janela e a
//   133 px do topo (por baixo da barra do nome da zona); igual numa zona aberta
//   (Fafnite Deposit) e numa masmorra (Accursed Sword);
// - o jogador está sempre no centro desse retângulo;
// - o losango é ciano (141,255,238 no miolo), 9–10 × 13–14 px, ~68 píxeis;
//   há losangos apagados (~95,172,161) — recursos noutro andar;
// - "Orichalcum · Distance 55m" bate com o losango a 54,9 px do centro: ~1 m por
//   píxel a 1440p. Passar o rato num losango mostra a distância verdadeira, e a
//   app acerta a escala com isso (o zoom do radar muda-a).

const REF_ALTURA = 1440;
const ZONA = { direita: 29, topo: 133, largura: 331, altura: 221 };
const METROS_POR_PX = 1; // a 1440p, zoom por omissão

/** O retângulo do mapa do radar, em coordenadas do ecrã, para a janela [x, y, w, h] do jogo. */
function zonaDoRadar(janela, ajuste = null) {
  const [jx, jy, jw, jh] = janela;
  const k = jh / REF_ALTURA;
  const z = { ...ZONA, ...(ajuste || {}) };
  const w = Math.round(z.largura * k);
  const h = Math.round(z.altura * k);
  return [Math.round(jx + jw - (z.direita + z.largura) * k), Math.round(jy + z.topo * k), w, h];
}

// Ciano dos losangos: verde e azul muito acima do vermelho. A estrada, a areia e
// a água do mapa ficam longe disto; o anel à volta do jogador é fino demais para
// passar o filtro da forma.
function ciano(px, i) {
  const r = px[i];
  const g = px[i + 1];
  const b = px[i + 2];
  return g >= 150 && b >= 140 && g - r >= 60 && b - r >= 50;
}

/**
 * Os losangos de uma imagem do radar: [{ x, y, claro }] com x, y relativos à
 * imagem. k = escala da interface (altura da janela / 1440).
 */
function encontrarRecursos(img, k = 1) {
  const { largura: W, altura: H, px } = img;
  const visto = new Uint8Array(W * H);
  const out = [];
  const pilha = [];
  for (let y0 = 0; y0 < H; y0++) {
    for (let x0 = 0; x0 < W; x0++) {
      const k0 = y0 * W + x0;
      if (visto[k0] || !ciano(px, k0 * 4)) continue;
      visto[k0] = 1;
      pilha.push(k0);
      let n = 0, sx = 0, sy = 0, sg = 0, x1 = x0, x2 = x0, y1 = y0, y2 = y0;
      while (pilha.length) {
        const q = pilha.pop();
        const qx = q % W;
        const qy = (q / W) | 0;
        n++;
        sx += qx;
        sy += qy;
        sg += px[q * 4 + 1];
        if (qx < x1) x1 = qx;
        if (qx > x2) x2 = qx;
        if (qy < y1) y1 = qy;
        if (qy > y2) y2 = qy;
        if (qx > 0 && !visto[q - 1] && ciano(px, (q - 1) * 4)) (visto[q - 1] = 1), pilha.push(q - 1);
        if (qx < W - 1 && !visto[q + 1] && ciano(px, (q + 1) * 4)) (visto[q + 1] = 1), pilha.push(q + 1);
        if (qy > 0 && !visto[q - W] && ciano(px, (q - W) * 4)) (visto[q - W] = 1), pilha.push(q - W);
        if (qy < H - 1 && !visto[q + W] && ciano(px, (q + W) * 4)) (visto[q + W] = 1), pilha.push(q + W);
      }
      const w = x2 - x1 + 1;
      const h = y2 - y1 + 1;
      // Forma de losango: mais alto que largo, ~metade da caixa cheia. Um losango
      // cortado pela borda do radar fica de fora (não se sabe onde é o centro).
      if (w < 6 * k || w > 13 * k || h < 9 * k || h > 17 * k || h < w) continue;
      const cheio = n / (w * h);
      if (cheio < 0.35 || cheio > 0.8) continue;
      out.push({ x: sx / n, y: sy / n, claro: sg / n >= 215 });
    }
  }
  return out;
}

/** O centro (o jogador) de uma imagem do radar com w×h píxeis. */
function centroDe(w, h) {
  return { x: (w - 1) / 2, y: (h - 1) / 2 };
}

const SETAS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/**
 * Distância (m) e seta de um losango, a partir do centro do radar. A seta é em
 * relação ao radar (cima = cima do radar), não necessariamente ao norte.
 * mPorPx já é a escala desta janela (a de 1440p ÷ k).
 */
function descrever(r, centro, mPorPx) {
  const dx = r.x - centro.x;
  const dy = r.y - centro.y;
  const px = Math.hypot(dx, dy);
  const ang = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = cima, sentido dos ponteiros
  return { ...r, px, metros: Math.round(px * mPorPx), seta: SETAS[Math.round(((ang + 360) % 360) / 45) % 8] };
}

/** "Distance 55m" / "Distância: 55 m" no texto da dica do jogo → 55, ou null. */
function distanciaDaDica(linhas) {
  const t = linhas.map((l) => l.t).join(' ');
  const m = t.match(/dist[aâ]nc[ei]a?\s*[:.]?\s*(\d{1,4})\s*m\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * Segue os losangos de leitura para leitura, para saber quais são novos. O
 * jogador anda, por isso os losangos deslizam: casa-se pelo mais perto. Um
 * losango tapado por um instante (a seta do jogador, outro ícone) não volta a
 * contar como novo, porque só se esquece ao fim de `esquecer` leituras.
 */
class Rasto {
  constructor({ raio = 12, esquecer = 4 } = {}) {
    this.raio = raio;
    this.esquecer = esquecer;
    this.conhecidos = []; // { x, y, falta }
    this.voltas = 0;
  }

  /** Recebe os losangos desta leitura e devolve os novos (vazio na primeira). */
  ver(recursos, k = 1) {
    const raio = this.raio * k;
    const livres = new Set(this.conhecidos.keys());
    const novos = [];
    for (const r of recursos) {
      let melhor = -1;
      let dMelhor = raio;
      for (const i of livres) {
        const c = this.conhecidos[i];
        const d = Math.hypot(c.x - r.x, c.y - r.y);
        if (d <= dMelhor) (dMelhor = d), (melhor = i);
      }
      if (melhor >= 0) {
        livres.delete(melhor);
        Object.assign(this.conhecidos[melhor], { x: r.x, y: r.y, falta: 0 });
      } else {
        this.conhecidos.push({ x: r.x, y: r.y, falta: 0 });
        if (this.voltas > 0) novos.push(r);
      }
    }
    for (const i of livres) this.conhecidos[i].falta++;
    this.conhecidos = this.conhecidos.filter((c) => c.falta <= this.esquecer);
    this.voltas++;
    return novos;
  }

  limpar() {
    this.conhecidos = [];
    this.voltas = 0;
  }
}

module.exports = { REF_ALTURA, ZONA, METROS_POR_PX, zonaDoRadar, encontrarRecursos, centroDe, descrever, distanciaDaDica, Rasto };
