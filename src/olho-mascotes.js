'use strict';

// As mascotes vistas no ecrã do jogo. Tudo a partir do que o OCR lê — nada de
// rede nem de memória do jogo:
//
//  - o alvo: o nome do monstro escolhido aparece no topo do ecrã; se for uma
//    mascote, a faixa diz se já a tens;
//  - o chat: quando cai uma alma, o jogo escreve uma linha com "Alma" e o nome;
//    a app soma-a à coleção do personagem;
//  - a coleção: com a janela da coleção aberta, Ctrl+Alt+M lê os nomes que lá
//    estão e propõe marcá-los.
//
// As zonas do ecrã (onde está o nome do alvo, onde está o chat) estão em frações
// da janela do jogo e são PALPITES até haver capturas do jogo: ficam nas
// definições para se acertarem sem mexer no código.

const ZONAS = {
  alvo: { x: 0.3, y: 0.0, w: 0.4, h: 0.14 },
  chat: { x: 0.0, y: 0.5, w: 0.34, h: 0.46 },
};

// A palavra que marca a alma na linha do chat, por idioma do cliente.
const PALAVRA_ALMA = /(^| )(alma|soul|seele|ame)( |$)|魂/;

/** Minúsculas, sem acentos, só letras/algarismos e um espaço entre palavras. */
function normal(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ' ')
    .trim();
}

/** As mascotes prontas a procurar: [{ id, nome, chave }], as mais compridas primeiro. */
function catalogo(lista) {
  return lista
    .map((m) => ({ id: m.id, nome: m.nome, chave: normal(m.nome) }))
    .filter((m) => m.chave.length >= 3)
    .sort((a, b) => b.chave.length - a.chave.length);
}

/** Quantos erros de OCR se aceitam num nome deste tamanho. */
function tolerancia(n) {
  if (n <= 4) return 0;
  if (n <= 8) return 1;
  if (n <= 14) return 2;
  return 3;
}

/**
 * O pedaço de `texto` mais parecido com `padrao` (distância de edição com
 * início e fim livres no texto). { dist, ini, fim } — fim exclusivo.
 */
function procurar(padrao, texto) {
  const m = padrao.length;
  const n = texto.length;
  let ant = new Array(n + 1).fill(0);
  let antIni = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    const curIni = new Array(n + 1);
    cur[0] = i;
    curIni[0] = 0;
    for (let j = 1; j <= n; j++) {
      const sub = ant[j - 1] + (padrao[i - 1] === texto[j - 1] ? 0 : 1);
      const del = ant[j] + 1; // falta uma letra no texto
      const ins = cur[j - 1] + 1; // letra a mais no texto
      if (sub <= del && sub <= ins) {
        cur[j] = sub;
        curIni[j] = antIni[j - 1];
      } else if (del <= ins) {
        cur[j] = del;
        curIni[j] = antIni[j];
      } else {
        cur[j] = ins;
        curIni[j] = curIni[j - 1];
      }
    }
    ant = cur;
    antIni = curIni;
  }
  let melhor = { dist: Infinity, ini: 0, fim: 0 };
  for (let j = 1; j <= n; j++) if (ant[j] < melhor.dist) melhor = { dist: ant[j], ini: antIni[j], fim: j };
  return melhor;
}

const letra = (c) => !!c && c !== ' ';

/**
 * As mascotes cujo nome aparece no texto. Cada pedaço do texto só conta para
 * uma (a de nome mais comprido: "Aranha Cinzenta" e não "Aranha"), e o nome tem
 * de bater em palavras inteiras.
 */
function nomesNoTexto(texto, cat) {
  const t = normal(texto);
  if (!t) return [];
  const achados = [];
  for (const m of cat) {
    if (m.chave.length > t.length + tolerancia(m.chave.length)) continue;
    const tol = tolerancia(m.chave.length);
    let r;
    const exato = t.indexOf(m.chave);
    if (exato >= 0) r = { dist: 0, ini: exato, fim: exato + m.chave.length };
    else if (tol) r = procurar(m.chave, t);
    else continue;
    if (r.dist > tol) continue;
    // Palavras inteiras: nada de "Aranha" dentro de "Aranhas".
    if (letra(t[r.ini - 1]) || letra(t[r.fim])) continue;
    if (achados.some((a) => r.ini < a.fim && a.ini < r.fim)) continue;
    achados.push({ id: m.id, nome: m.nome, dist: r.dist, ini: r.ini, fim: r.fim });
  }
  return achados.sort((a, b) => a.ini - b.ini);
}

/** Nas linhas do OCR, as mascotes que aparecem: [{ id, nome, dist, linha }]. */
function nomesNasLinhas(linhas, cat) {
  const out = [];
  for (const l of linhas) for (const a of nomesNoTexto(l.t, cat)) out.push({ id: a.id, nome: a.nome, dist: a.dist, linha: l });
  return out;
}

/** A mascote do alvo: a mais acima e mais certa das que aparecem na zona do alvo. */
function mascoteDoAlvo(linhas, cat) {
  const v = nomesNasLinhas(linhas, cat);
  v.sort((a, b) => a.dist - b.dist || a.linha.y1 - b.linha.y1);
  return v[0] || null;
}

/** As linhas do chat que anunciam uma alma: { chave da linha → { id, nome, n } }. */
function almasNoChat(linhas, cat) {
  const out = new Map();
  for (const l of linhas) {
    const t = normal(l.t);
    if (!PALAVRA_ALMA.test(t)) continue;
    const a = nomesNoTexto(l.t, cat)[0];
    if (!a) continue;
    const k = t;
    const e = out.get(k) || { id: a.id, nome: a.nome, n: 0 };
    e.n++;
    out.set(k, e);
  }
  return out;
}

/**
 * Almas novas entre duas leituras do chat. O chat sobe; a mesma linha continua
 * lá até sair por cima. Uma linha nova é uma que agora aparece mais vezes do
 * que antes. Pura — é o que o teste exercita.
 */
function almasNovas(antes, agora) {
  const novas = [];
  for (const [k, e] of agora) {
    const mais = e.n - ((antes.get(k) || {}).n || 0);
    if (mais > 0) novas.push({ id: e.id, nome: e.nome, n: mais });
  }
  return novas;
}

/** Os nomes de mascotes vistos num ecrã da coleção, cada um com a luz do seu texto. */
function vistosNaColecao(linhas, cat, luzDe) {
  const vistos = new Map();
  for (const a of nomesNasLinhas(linhas, cat)) {
    if (vistos.has(a.id)) continue;
    vistos.set(a.id, { id: a.id, nome: a.nome, luz: luzDe ? luzDe(a.linha) : null });
  }
  return [...vistos.values()];
}

/**
 * Obtidas ou em falta pela luz do texto (as obtidas costumam vir claras e as em
 * falta apagadas): se as luzes se dividem em dois grupos com um salto grande, o
 * de cima é "tem"; senão fica null (não deu para adivinhar).
 */
function dividirPorLuz(lista) {
  const out = lista.map((x) => ({ ...x, tem: null }));
  const luzes = out.map((x) => x.luz).filter((x) => x != null).sort((a, b) => a - b);
  if (luzes.length < 2) return out;
  // O maior salto entre luzes seguidas; só conta se for grande.
  let salto = 0;
  let corte = null;
  for (let i = 1; i < luzes.length; i++) {
    if (luzes[i] - luzes[i - 1] > salto) {
      salto = luzes[i] - luzes[i - 1];
      corte = (luzes[i] + luzes[i - 1]) / 2;
    }
  }
  if (salto >= 40) for (const x of out) if (x.luz != null) x.tem = x.luz > corte;
  return out;
}

/** Um só ecrã da coleção: os nomes vistos, já divididos em obtidas/em falta. */
function lerColecao(linhas, cat, luzDe) {
  return dividirPorLuz(vistosNaColecao(linhas, cat, luzDe));
}

/**
 * A leitura contínua da coleção (Ctrl+Alt+M liga, outro Ctrl+Alt+M pára): junta
 * o que cada ecrã mostra enquanto o jogador percorre a coleção. A luz de cada
 * mascote é a mediana das vezes que foi vista: o rato por cima acende uma em
 * falta, e um ecrã a meio da animação apaga uma obtida — a mediana ignora os dois.
 */
/**
 * O contador do próprio jogo no topo da coleção ("Collection Status 84/200",
 * "Estado da Coleção 84/200"): { tem, total } ou null. É a verdade contra a
 * qual se confere a leitura dos nomes — que falha se o idioma da app não for o
 * do jogo, ou se não se percorrer a coleção toda.
 */
function contadorColecao(linhas) {
  for (const l of linhas || []) {
    const t = String(l.t || '');
    if (!/collect|cole[cç]|sammlung|收集|コレクション/i.test(t)) continue;
    const m = /(\d{1,3})\s*\/\s*(\d{2,3})/.exec(t);
    if (m && +m[1] <= +m[2]) return { tem: +m[1], total: +m[2] };
  }
  return null;
}

class Colecao {
  constructor() {
    this.vistas = new Map(); // id → { id, nome, luzes: [] }
    this.leituras = 0;
    this.contador = null; // { tem, total } do jogo, se aparecer no ecrã
  }

  juntar(linhas, cat, luzDe) {
    this.leituras++;
    this.contador = contadorColecao(linhas) || this.contador;
    let novas = 0;
    for (const v of vistosNaColecao(linhas, cat, luzDe)) {
      let e = this.vistas.get(v.id);
      if (!e) {
        e = { id: v.id, nome: v.nome, luzes: [] };
        this.vistas.set(v.id, e);
        novas++;
      }
      if (v.luz != null) e.luzes.push(v.luz);
    }
    return novas;
  }

  lista() {
    const mediana = (l) => {
      if (!l.length) return null;
      const o = [...l].sort((a, b) => a - b);
      const m = o.length >> 1;
      return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
    };
    return dividirPorLuz([...this.vistas.values()].map((e) => ({ id: e.id, nome: e.nome, luz: mediana(e.luzes) })));
  }
}

/** Retângulo de uma zona (frações) dentro da janela [x, y, w, h], em píxeis. */
function zonaNaJanela(z, janela) {
  const [x, y, w, h] = janela;
  return { x: Math.round(x + z.x * w), y: Math.round(y + z.y * h), w: Math.round(z.w * w), h: Math.round(z.h * h) };
}

class VigiaMascotes {
  /**
   * @param ocr         o src/ocr.js (ver, lerZona)
   * @param cat         () => catalogo atual
   * @param opcoes      () => { alvo: bool, almas: bool, zonas }
   * @param aoAlvo      (achado|null, janela) => void — achado: { id, nome, linha }
   * @param aoAlmas     (novas) => void
   */
  constructor({ ocr, cat, opcoes, aoAlvo, aoAlmas, intervaloMs = 1500, processo = 'AION2', aoErro = null, ignorar = null }) {
    Object.assign(this, { ocr, cat, opcoes, aoAlvo, aoAlmas, intervaloMs, processo, aoErro, ignorar });
    this.ligado = false;
    this.relogio = null;
    this.alvo = null; // id mostrado agora
    this.falhasAlvo = 0;
    this.chat = null; // a última leitura do chat (null = ainda sem base)
  }

  ligar() {
    if (this.ligado) return;
    this.ligado = true;
    this.chat = null;
    this.volta();
  }

  desligar() {
    this.ligado = false;
    clearTimeout(this.relogio);
    if (this.alvo != null) {
      this.alvo = null;
      this.aoAlvo(null);
    }
  }

  async volta() {
    if (!this.ligado) return;
    try {
      await this.passo();
    } catch (e) {
      if (this.aoErro) this.aoErro(e);
    }
    if (this.ligado) this.relogio = setTimeout(() => this.volta(), this.intervaloMs);
  }

  async passo() {
    const o = this.opcoes();
    const cat = this.cat();
    if (!cat.length || (!o.alvo && !o.almas)) return;
    const v = await this.ocr.ver(this.processo);
    if (!v.jogo || !v.janela) {
      // Sem o jogo à frente não se lê nada, e o chat perde a base (pode ter andado).
      this.chat = null;
      if (this.alvo != null) {
        this.alvo = null;
        this.aoAlvo(null);
      }
      return;
    }
    const zonas = { ...ZONAS, ...(o.zonas || {}) };
    // O texto dos avisos da própria app (desenhados por cima do jogo, na mesma zona)
    // não conta: sem isto o aviso "Slime" era lido como o alvo e ficava para sempre.
    const tapadas = (this.ignorar && this.ignorar()) || [];
    const limpar = (linhas) =>
      tapadas.length
        ? linhas.filter((l) => {
            const cx = (l.x1 + l.x2) / 2;
            const cy = (l.y1 + l.y2) / 2;
            return !tapadas.some(([x, y, w, h]) => cx >= x && cx < x + w && cy >= y && cy < y + h);
          })
        : linhas;
    if (o.alvo) {
      const z = zonaNaJanela(zonas.alvo, v.janela);
      const a = mascoteDoAlvo(limpar(await this.ocr.lerZona(z.x, z.y, z.w, z.h)), cat);
      if (a) {
        this.falhasAlvo = 0;
        if (a.id !== this.alvo) {
          this.alvo = a.id;
          this.aoAlvo(a, v.janela);
        }
      } else if (this.alvo != null && ++this.falhasAlvo >= 2) {
        // Duas leituras seguidas sem nome: o alvo foi largado.
        this.alvo = null;
        this.aoAlvo(null);
      }
    }
    if (o.almas) {
      const z = zonaNaJanela(zonas.chat, v.janela);
      const agora = almasNoChat(limpar(await this.ocr.lerZona(z.x, z.y, z.w, z.h)), cat);
      // A primeira leitura é só a base: o que já estava no chat não conta.
      if (this.chat) {
        const novas = almasNovas(this.chat, agora);
        if (novas.length) this.aoAlmas(novas, v.janela);
      }
      this.chat = agora;
    }
  }
}

module.exports = {
  ZONAS,
  normal,
  catalogo,
  procurar,
  nomesNoTexto,
  nomesNasLinhas,
  mascoteDoAlvo,
  almasNoChat,
  almasNovas,
  vistosNaColecao,
  dividirPorLuz,
  lerColecao,
  Colecao,
  contadorColecao,
  zonaNaJanela,
  VigiaMascotes,
};
