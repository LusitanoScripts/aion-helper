'use strict';

// Comparar títulos no jogo: o que sobe e o que desce se trocares o efeito equipado.
//
// A ficha oficial da NC só traz os 3 títulos equipados (um por categoria:
// Attack, Defense, Etc), não os que tens — por isso lê-se do ecrã, onde a janela
// dos títulos mostra as duas coisas ao mesmo tempo:
//  - a grelha de cartas (3 lado a lado); a escolhida tem os botões "Equip
//    Effect" / "Equip Title" por baixo do nome e dos atributos ("Critical Attack 17");
//  - à direita, "Equipped Effect": um bloco por categoria (nome + atributos, com
//    o valor encostado à direita, que o OCR dá numa linha à parte).
// A categoria vê-se pelo ícone (espada = ataque, escudo = defesa, estrela = outros):
// compara-se o ícone da carta com o de cada bloco equipado e fica o mais parecido.
// Medido em capturas do cliente em inglês (12 out. 2026).

const BOTOES = /equip\s*effect|equipar\s*efeito/i;
const TITULO = /equip\s*title|equipar\s*t[ií]tulo/i;
const PAINEL = /equipped\s*effect|efeito\s*equipado/i;
const NUMERO = /^[+-]?\d[\d.,]*\s*%?$/;

function mediana(v) {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1] || 0;
}

/**
 * Segmentos de texto: as linhas do OCR da mesma altura juntam-se só se estiverem
 * perto (a mesma carta), ou se a da direita for só um número (o valor encostado
 * à direita do painel) e o segmento ainda não tiver número. Assim o texto de
 * cartas vizinhas não se mistura.
 */
function segmentos(linhas) {
  let L = (linhas || []).map((l) => ({ ...l, t: String(l.t || '').trim(), cy: (l.y1 + l.y2) / 2 })).filter((l) => l.t);
  const h = mediana(L.map((l) => l.y2 - l.y1));
  // O ícone do título às vezes sai como texto ("ZOA", 76–85 px de altura): fora.
  if (h) L = L.filter((l) => l.y2 - l.y1 <= h * 2.2);
  L.sort((a, b) => a.cy - b.cy || a.x1 - b.x1);
  const filas = [];
  for (const l of L) {
    const f = filas.find((x) => Math.abs(x.cy - l.cy) <= Math.max(6, (l.y2 - l.y1) * 0.6));
    if (f) f.partes.push(l);
    else filas.push({ cy: l.cy, partes: [l] });
  }
  const out = [];
  for (const f of filas) {
    f.partes.sort((a, b) => a.x1 - b.x1);
    let s = null;
    for (const p of f.partes) {
      const perto = s && p.x1 - s.x2 < h * 4;
      const valor = s && NUMERO.test(p.t) && !/\d\s*%?$/.test(s.t);
      if (s && (perto || valor)) {
        s.t += ' ' + p.t;
        s.x2 = Math.max(s.x2, p.x2);
        s.y1 = Math.min(s.y1, p.y1);
        s.y2 = Math.max(s.y2, p.y2);
      } else {
        s = { t: p.t, x1: p.x1, x2: p.x2, y1: p.y1, y2: p.y2, cy: f.cy };
        out.push(s);
      }
    }
  }
  out.sort((a, b) => a.cy - b.cy || a.x1 - b.x1);
  return { segs: out, h: h || 16 };
}

/** "Attack Bonus 20" / "Cooldown Reduction +3%" → { nome, valor, pct } ou null. */
function atributo(t) {
  const m = /^(.*?[A-Za-zÀ-ú].*?)\s*([+-]?\d[\d.,]*)\s*(%?)$/.exec(String(t).trim());
  if (!m) return null;
  const nome = m[1].replace(/[:+]\s*$/, '').trim();
  if (nome.length < 2) return null; // "HP", "MP" são atributos a sério
  return { nome, valor: Number(m[2].replace(/,/g, '')), pct: m[3] === '%' };
}

/** "111-Fated Encounter" (o OCR lê "Ill" como "111") → "Ill-Fated Encounter". */
function limparNome(t) {
  return String(t || '')
    .replace(/^[^A-Za-zÀ-ú0-9]+/, '')
    .replace(/^1(?=1?[1Il][-\s])/, 'I')
    .replace(/^I1(?=[1l][-\s])/, 'Il')
    .replace(/^Il1(?=[-\s])/, 'Ill')
    .trim();
}

/** Ícone (recorte quadrado, cinzento, 24×24, normalizado) para comparar categorias. */
function assinaturaIcone(img, cx, cy, lado) {
  if (!img) return null;
  const N = 24;
  const out = new Float32Array(N * N);
  let soma = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = Math.round(cx - lado / 2 + ((i + 0.5) * lado) / N);
      const y = Math.round(cy - lado / 2 + ((j + 0.5) * lado) / N);
      let v = 0;
      if (x >= 0 && y >= 0 && x < img.largura && y < img.altura) {
        const k = (y * img.largura + x) * 4;
        v = (img.px[k] + img.px[k + 1] + img.px[k + 2]) / 3;
      }
      out[j * N + i] = v;
      soma += v;
    }
  }
  // Só a FORMA: os traços do ícone são os píxeis bem mais claros que o fundo do
  // recorte (a carta é azul clara e o painel escuro — comparar cinzentos dava o
  // escudo mais parecido com a espada). Fica 1 nos traços e −1 no resto.
  const media = soma / out.length;
  let dp = 0;
  for (let i = 0; i < out.length; i++) dp += (out[i] - media) ** 2;
  dp = Math.sqrt(dp / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i] > media + dp * 0.8 ? 1 : -1;
  return out;
}

/**
 * Semelhança de dois ícones: sobreposição dos traços (interseção / união), com
 * até 3 células de folga para recortes um pouco desalinhados. Numa captura real:
 * espadas 0,43–0,49 com a espada equipada e 0,23–0,31 com o escudo; escudo 0,61 vs 0,28.
 */
function semelhancaIcone(a, b) {
  const N = Math.round(Math.sqrt(a.length));
  let melhor = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      let inter = 0;
      let uniao = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const xa = x + dx;
          const ya = y + dy;
          const va = xa >= 0 && ya >= 0 && xa < N && ya < N && a[ya * N + xa] > 0;
          const vb = b[y * N + x] > 0;
          if (va && vb) inter++;
          if (va || vb) uniao++;
        }
      }
      if (uniao) melhor = Math.max(melhor, inter / uniao);
    }
  }
  return melhor;
}

/**
 * A comparação, se o ecrã tiver a carta escolhida e o painel do efeito equipado:
 * { escolhido, equipado, diferencas, x, y, largura } ou null. `img` (opcional) é a
 * imagem do ecrã, para escolher a categoria pelo ícone; sem ela fica o bloco que
 * partilha mais atributos com a carta.
 */
function compararTitulos(linhas, img = null) {
  const { segs, h } = segmentos(linhas);
  const bot = segs.find((s) => BOTOES.test(s.t));
  const pai = segs.find((s) => PAINEL.test(s.t));
  if (!bot || !pai) return null;

  // Carta: segmentos da mesma coluna por cima dos botões; atributos até ao nome.
  const naColuna = (s) => Math.abs(s.x1 - bot.x1) < h * 5 && s.y2 <= bot.y1 + 2 && bot.y1 - s.y2 < h * 14;
  const acima = segs.filter(naColuna).sort((a, b) => b.cy - a.cy);
  const attrsCarta = [];
  let nomeCarta = null;
  let linhaNome = null;
  for (const s of acima) {
    const a = atributo(s.t);
    if (a) {
      attrsCarta.unshift(a);
      continue;
    }
    if (attrsCarta.length) {
      nomeCarta = limparNome(s.t);
      linhaNome = s;
    }
    break;
  }
  if (!attrsCarta.length) return null;

  // Painel: blocos (nome + atributos) por baixo de "Equipped Effect", na mesma coluna.
  const noPainel = segs.filter((s) => s.y1 > pai.y2 && s.x1 >= pai.x1 - h * 2 && s.x1 < pai.x1 + h * 14 && s.y1 - pai.y2 < h * 40);
  const blocos = [];
  let ant = pai;
  for (const s of noPainel) {
    if (s.y1 - ant.y2 > h * 10) break;
    ant = s;
    const a = atributo(s.t);
    if (a && blocos.length) blocos[blocos.length - 1].atributos.push(a);
    else if (!a) blocos.push({ nome: limparNome(s.t), seg: s, atributos: [] });
  }
  const equipados = blocos.filter((b) => b.atributos.length);
  if (!equipados.length) return null;

  // Que bloco é da mesma categoria? Pelo ícone; sem imagem, pelos atributos em comum.
  let equipado = equipados[0];
  let porIcone = false;
  const titBot = segs.find((s) => TITULO.test(s.t) && Math.abs(s.cy - bot.cy) < h);
  if (img && linhaNome && titBot) {
    const sigCarta = assinaturaIcone(img, titBot.x2 + h * 2.2, linhaNome.cy + h * 4.9, h * 6.2);
    let melhor = -Infinity;
    for (const b of equipados) {
      const c = semelhancaIcone(sigCarta, assinaturaIcone(img, b.seg.x1 - h * 5.3, b.seg.cy + h * 1.9, h * 8.5));
      if (c > melhor) {
        melhor = c;
        equipado = b;
      }
    }
    porIcone = true;
  } else {
    const nomes = new Set(attrsCarta.map((a) => a.nome.toLowerCase()));
    let melhor = -1;
    for (const b of equipados) {
      const comum = b.atributos.filter((a) => nomes.has(a.nome.toLowerCase())).length;
      if (comum > melhor) {
        melhor = comum;
        equipado = b;
      }
    }
  }

  const chave = (a) => a.nome.toLowerCase() + (a.pct ? '%' : '');
  const mapa = new Map();
  for (const a of equipado.atributos) mapa.set(chave(a), { nome: a.nome, pct: a.pct, de: a.valor, para: 0 });
  for (const a of attrsCarta) {
    const e = mapa.get(chave(a)) || { nome: a.nome, pct: a.pct, de: 0, para: 0 };
    e.para = a.valor;
    mapa.set(chave(a), e);
  }
  const diferencas = [...mapa.values()].map((d) => ({ ...d, delta: Math.round((d.para - d.de) * 100) / 100 }));
  diferencas.sort((a, b) => b.delta - a.delta);
  const direita = titBot ? titBot.x2 : bot.x2;
  const esq = Math.min(bot.x1, linhaNome ? linhaNome.x1 : bot.x1) - h * 0.7;
  return {
    escolhido: { nome: nomeCarta, atributos: attrsCarta },
    equipado: { nome: equipado.nome, atributos: equipado.atributos },
    categoriaPorIcone: porIcone,
    diferencas,
    x: Math.round(esq),
    y: Math.round(bot.y2 + h * 0.9),
    largura: Math.round(Math.max(direita - esq + h, 360)),
  };
}

module.exports = { compararTitulos, segmentos, atributo, limparNome, assinaturaIcone, semelhancaIcone };
