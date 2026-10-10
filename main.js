'use strict';

const { app, BrowserWindow, ipcMain, shell, desktopCapturer, screen, dialog, globalShortcut, Notification, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const sources = require('./src/sources');
const { Cache } = require('./src/cache');
const { Nomes } = require('./src/names');
const { Definicoes } = require('./src/settings');
const I = require('./src/imagem');
const { carregarCatalogo } = require('./src/icones');
const { lerMochila } = require('./src/mochila');
const { OCR, gravarTemp } = require('./src/ocr');
const { encontrarCartoes, casarNome } = require('./src/cartoes');
const { Notas } = require('./src/notas');
const { Vigia } = require('./src/vigia');
const { Loja, ondeVender } = require('./src/loja');
const { Alertas } = require('./src/alertas');
const habilidades = require('./src/habilidades');
const B = require('./src/builds');
const personagem = require('./src/personagem');
const P = require('./src/pricing');

const ATALHO_CARTAO = 'Control+Alt+P';
const ATALHO_NOTA = 'Control+Alt+N';
const FAIXA_SEGUNDOS = 12;

const PRECOS_FRESCOS_MS = 15 * 60e3; // o exchange recolhe de 15 em 15 min
const SERVIDORES_MS = 24 * 3600e3;
const HABILIDADES_MS = 7 * 24 * 3600e3; // só mudam com atualizações do jogo

let win = null;
let cache;
let nomes;
let defs;
let catalogo = null; // { chave, cat } — refaz-se quando muda o conjunto de ícones
let ocr = null;
let notas = null;
let loja = null;
let alertas = null;
let builds = null;
let janelaFaixa = null;
let relogioFaixa = null;
let ultimosCartoes = []; // nomes do último Ctrl+Alt+P, para o Ctrl+Alt+N
let atalhosFalhados = [];
let vigia = null;
const errosRecentes = []; // os últimos 30, com hora — vão para o diagnóstico
let ultimoCartaoManual = null; // { png, linhas, faixas, quando } do último Ctrl+Alt+P

function registarErro(onde, e) {
  errosRecentes.push({ quando: new Date().toISOString(), onde, erro: (e && (e.stack || e.message)) || String(e) });
  if (errosRecentes.length > 30) errosRecentes.shift();
}

// No modo de teste (AION_CAPTURA) corre ao lado da app verdadeira, se estiver aberta.
if (!process.env.AION_CAPTURA && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

function enviar(canal, dados) {
  if (win && !win.isDestroyed()) win.webContents.send(canal, dados);
}

function criarJanela() {
  const b = defs.todas().limites || { width: 980, height: 680 };
  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    ...(b.x != null ? { x: b.x, y: b.y } : {}),
    minWidth: 720,
    minHeight: 460,
    frame: false,
    backgroundColor: '#0b0e14',
    show: false,
    title: 'Aion Helper',
    alwaysOnTop: !!defs.todas().pin,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (process.env.AION_CAPTURA) capturarParaTeste(process.env.AION_CAPTURA);

  let gravar;
  const guardarLimites = () => {
    clearTimeout(gravar);
    gravar = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) {
        defs.mudar({ limites: win.getBounds() });
      }
    }, 400);
  };
  win.on('move', guardarLimites);
  win.on('resize', guardarLimites);

  // Ligações externas abrem no navegador, nunca dentro da janela.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Só para testes (`AION_CAPTURA=ficheiro.png`): espera pela tabela, abre o
 * detalhe do item com mais anúncios, guarda uma imagem da janela e sai.
 * É a única forma de confirmar o renderer a sério sem alguém a olhar.
 */
function capturarParaTeste(destino) {
  const fs = require('fs');
  win.webContents.once('did-finish-load', () => corridaDeTeste().catch((e) => {
    // Um erro no teste tem de se ver e fechar a app — sem isto ficava pendurada.
    console.error('teste falhou:', e && e.stack);
    app.exit(1);
  }));
  async function corridaDeTeste() {
    const js = (c) => win.webContents.executeJavaScript(c);
    for (let i = 0; i < 60; i++) {
      if (await js("document.querySelectorAll('#tabela tbody tr[data-id]').length")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (process.env.AION_DIAGNOSTICO) {
      console.log('diagnóstico:', await guardarDiagnostico());
      app.quit();
      return;
    }
    if (process.env.AION_ABA) {
      // Abre uma aba e fotografa-a (a das Definições mede os mercados à primeira).
      await js(`document.querySelector('#abas [data-aba=${JSON.stringify(process.env.AION_ABA)}]').click()`);
      // AION_JS: um script a correr no renderer antes da foto (para preencher a aba como um utilizador).
      if (process.env.AION_JS) console.log('AION_JS:', await js(fs.readFileSync(process.env.AION_JS, 'utf8')));
      await new Promise((r) => setTimeout(r, Number(process.env.AION_CAPTURA_ESPERA || 4000)));
      // Sem AION_JS a foto é do topo; com ele, o script decide onde fica o scroll.
      if (!process.env.AION_JS) await js("document.querySelectorAll('main.aba:not([hidden]) *').forEach((e) => (e.scrollTop = 0))");
      win.setSize(1000, 720);
      await new Promise((r) => setTimeout(r, 500));
      fs.writeFileSync(destino, (await win.webContents.capturePage()).toPNG());
      app.quit();
      return;
    }
    if (process.env.AION_CARTAO) {
      // A faixa a sério, sobre uma captura: OCR → cartões → faixas → a janela
      // transparente desenha-as → compõe-se por cima da captura e grava-se.
      // As notas vêm de uma pasta temporária, para não tocar nas verdadeiras.
      notas = new Notas(fs.mkdtempSync(path.join(require('os').tmpdir(), 'aion-notas-')));
      notas.escrever('Botas do Caos', 'guardar para o Perseguidor');
      const f = process.env.AION_CARTAO;
      const img = I.lerPNG(fs.readFileSync(f));
      // AION_CARTAO_OCR: um OCR já lido (JSON) em vez do verdadeiro — para provar a faixa com preço.
      const lidas = process.env.AION_CARTAO_OCR ? JSON.parse(fs.readFileSync(process.env.AION_CARTAO_OCR, 'utf8')) : await ocr.ler(f);
      const faixas = await faixasDosCartoes(img, lidas);
      console.log('faixas:', JSON.stringify(faixas.map(({ nome, preco, motivo, nota }) => ({ nome, preco: preco && preco.valor, base: preco && preco.base, motivo, nota }))));
      const k = screen.getPrimaryDisplay().scaleFactor;
      const ecraFalso = { bounds: { x: 0, y: 0, width: Math.round(img.largura / k), height: Math.round(img.altura / k) }, scaleFactor: k };
      const jan = mostrarFaixas(ecraFalso, faixas);
      await new Promise((r) => setTimeout(r, 1500));
      const cap = await jan.webContents.capturePage();
      const sz = cap.getSize();
      const cima = I.deBGRA(cap.toBitmap(), sz.width, sz.height);
      for (let y = 0; y < Math.min(img.altura, cima.altura); y++) {
        for (let x = 0; x < Math.min(img.largura, cima.largura); x++) {
          const s = (y * cima.largura + x) * 4;
          const d = (y * img.largura + x) * 4;
          const al = cima.px[s + 3] / 255;
          for (let c = 0; c < 3; c++) img.px[d + c] = Math.round(cima.px[s + c] * al + img.px[d + c] * (1 - al));
        }
      }
      fs.writeFileSync(destino, I.escreverPNG(img));
      app.quit();
      return;
    }
    if (process.env.AION_MOCHILA) {
      await js("document.querySelector('#abas [data-aba=mochila]').click(); window.Mochila.teste()");
      for (let i = 0; i < 400; i++) {
        if (await js("/casas ocupadas|Falhou|Não encontrei/.test(document.querySelector('#mochilaEstado').textContent)")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, Number(process.env.AION_CAPTURA_ESPERA || 4000)));
      fs.writeFileSync(destino, (await win.webContents.capturePage()).toPNG());
      console.log('mochila:', await js("document.querySelector('#mochilaEstado').textContent"));
      app.quit();
      return;
    }
    await js(`(() => {
      const trs = [...document.querySelectorAll('#tabela tbody tr[data-id]')];
      const n = (tr) => Number(tr.children[4].textContent) || 0;
      const tr = trs.sort((a, b) => n(b) - n(a))[0];
      if (tr) tr.click();
    })()`);
    await new Promise((r) => setTimeout(r, Number(process.env.AION_CAPTURA_ESPERA || 4000)));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(destino, img.toPNG());
    const erros = await js("document.querySelector('#estado').textContent");
    console.log('estado:', erros);
    app.quit();
  }
}

/**
 * Lê da cache se estiver fresca; senão vai à rede; se a rede falhar, devolve a
 * cache velha **com aviso**. Uma origem em baixo não pode deixar a app vazia
 * quando há dados de há uma hora que continuam a servir.
 */
async function comCache(chave, frescoMs, buscar) {
  const fresco = cache.ler(chave, frescoMs);
  if (fresco) return { dados: fresco.dados, idadeMs: fresco.idadeMs, origem: 'cache' };
  try {
    const dados = await buscar();
    cache.gravar(chave, dados);
    return { dados, idadeMs: 0, origem: 'rede' };
  } catch (e) {
    const velho = cache.ler(chave);
    if (velho) return { dados: velho.dados, idadeMs: velho.idadeMs, origem: 'cache-velha', erro: e.message };
    throw e;
  }
}

// ── índice de itens ─────────────────────────────────────────────────────────

let indice = null;
/**
 * src/dados/itens.json (gerado por scripts/gerar-itens.js), com os nomes no
 * idioma do jogo. Só há nomes em pt-BR e en-US no índice; nos outros idiomas
 * procura-se em inglês, e a ficha de cada item vem no idioma certo.
 */
function indiceItens() {
  const idioma = idiomaDoJogo();
  if (indice && indice.idioma === idioma) return indice.resposta;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'dados', 'itens.json'), 'utf8'));
  } catch {
    return { gerado: null, itens: [] };
  }
  const itens = j.itens.map((x) => ({
    id: x.id,
    nome: x.n[idioma] || x.n['en-US'] || x.n['pt-BR'],
    outro: idioma === 'en-US' ? x.n['pt-BR'] : x.n['en-US'],
    grau: x.g,
    grauNome: (idioma === 'pt-BR' && x.gn) || x.g,
    c1: x.c1,
    c2: x.c2,
    cat: x.cat,
    icone: x.i ? 'https://assets.playnccdn.com/static-aion2-gamedata/resources/' + x.i : null,
    nivel: x.l,
    tr: x.t,
    classes: x.cl,
  }));
  indice = { idioma, resposta: { gerado: j.gerado, itens } };
  return indice.resposta;
}

function idiomaDoJogo() {
  return (defs && defs.todas().idioma) || sources.IDIOMA;
}

// ── mochila ────────────────────────────────────────────────────────────────

/** Tamanho do mercado (nº de itens) de cada servidor, guardado um dia. Só pede os que faltam. */
async function tamanhosDe(ids, aoProgresso) {
  const guardado = cache.ler('tamanhos', 24 * 3600e3);
  const mapa = guardado ? { ...guardado.dados } : {};
  const falta = ids.filter((id) => !(id in mapa));
  let feitos = 0;
  for (const id of falta) {
    try {
      mapa[id] = (await sources.tamanho(id)).itens;
    } catch {
      mapa[id] = 0;
    }
    feitos++;
    if (aoProgresso && feitos % 5 === 0) aoProgresso({ feitos, total: falta.length });
  }
  if (falta.length) cache.gravar('tamanhos', mapa);
  return mapa;
}

/**
 * Os servidores de reserva, por ordem — para quando o escolhido não tem anúncios
 * de um item (medido a 6 Out: o Odar tinha 27 anúncios ao todo; um servidor novo
 * tem o mercado quase vazio, não é falta de cobertura).
 *  · Os que a pessoa marcou nas Definições, do mercado maior para o menor.
 *  · Sem nenhum marcado: o maior da mesma região e fação (os preços entre fações
 *    não são os mesmos), se tiver 100+ itens; senão o por omissão do exchange.
 */
async function servidoresDeReferencia(lista) {
  const todos = lista.servidores || [];
  const escolhido = defs.todas().servidor || lista.omissao;
  const marcados = (defs.todas().referencias || []).filter((id) => id !== escolhido && todos.some((s) => s.id === id));
  if (marcados.length) {
    const t = await tamanhosDe(marcados);
    return marcados.slice().sort((a, b) => (t[b] || 0) - (t[a] || 0));
  }
  return [await referenciaAutomatica(lista)].filter((id) => id && id !== escolhido);
}

async function referenciaAutomatica(lista) {
  const todos = lista.servidores || [];
  const escolhido = defs.todas().servidor || lista.omissao;
  const s = todos.find((x) => x.id === escolhido);
  if (!s) return lista.omissao || null;
  const irmaos = todos.filter((x) => x.regiao === s.regiao && x.facao === s.facao && x.id !== escolhido);
  if (!irmaos.length) return lista.omissao || null;
  const t = await tamanhosDe(irmaos.map((x) => x.id));
  const maior = irmaos.slice().sort((a, b) => (t[b.id] || 0) - (t[a.id] || 0))[0];
  return maior && (t[maior.id] || 0) >= 100 ? maior.id : lista.omissao || null;
}

/** As linhas de preço de cada servidor de reserva: [{ servidor, nomeServidor, linhas }]. */
async function referencias() {
  const lista = (cache.ler('servidores') || { dados: {} }).dados;
  const out = [];
  for (const id of await servidoresDeReferencia(lista)) {
    try {
      const linhas = (await comCache('itens-' + id, 6 * 3600e3, () => sources.itensDoServidor(id))).dados;
      const s = (lista.servidores || []).find((x) => x.id === id);
      out.push({ servidor: id, nomeServidor: s ? s.nome : String(id), linhas });
    } catch {
      /* um servidor em baixo não estraga os outros */
    }
  }
  // Os nomes dos itens das reservas também fazem falta: é deles que sai o catálogo de ícones.
  const ids = [...new Set(out.flatMap((r) => r.linhas.map((l) => l.id)))];
  if (nomes.emFalta(ids).length) nomes.completar(ids).catch(() => {});
  return out;
}

/** Os ícones de todos os itens conhecidos, a 68 px (descarregados uma vez). */
async function catalogoDe() {
  // O catálogo inteiro: todos os itens com nome e ícone já conhecidos, de todos os servidores.
  const fichas = nomes.todosConhecidos();
  const chave = Object.keys(fichas).sort().join(',');
  if (catalogo && catalogo.chave === chave) return catalogo.cat;
  const cat = await carregarCatalogo(fichas, path.join(app.getPath('userData'), 'cache', 'icones68'), {
    aoProgresso: (p) => enviar('mochila:progresso', { fase: 'icones', ...p }),
  });
  catalogo = { chave, cat };
  return cat;
}

/**
 * Uma foto de cada ecrã, à resolução física. A janela da app esconde-se antes:
 * está sempre por cima e pode estar a tapar a mochila. Volta com showInactive,
 * que devolver o foco tirava o teclado ao jogo.
 */
async function fotografarEcras() {
  const visivel = !!(win && win.isVisible() && !win.isMinimized());
  if (visivel) win.hide();
  try {
    await new Promise((r) => setTimeout(r, 250)); // o Windows precisa de redesenhar o que estava por baixo
    // Um pedido por ecrã, ao tamanho físico dele: o thumbnailSize é um só para
    // todas as fontes, e um ecrã mais pequeno vinha ampliado — os moldes dos
    // algarismos são ao píxel e deixavam de bater.
    const out = [];
    for (const d of screen.getAllDisplays()) {
      const tamanho = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
      const fontes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: tamanho });
      const f = fontes.find((s) => String(s.display_id) === String(d.id)) || (fontes.length === 1 ? fontes[0] : null);
      if (!f) continue;
      const { width, height } = f.thumbnail.getSize();
      out.push({ nome: `${f.name} ${width}×${height}`, img: I.deBGRA(f.thumbnail.toBitmap(), width, height), alturaEcra: height });
    }
    return out;
  } finally {
    if (visivel && win && !win.isDestroyed()) win.showInactive();
  }
}

function recortePNG(img, x, y, lado = 65) {
  return 'data:image/png;base64,' + I.escreverPNG(I.recortar(img, x, y, lado, lado)).toString('base64');
}

/** Lê a mochila nas imagens dadas e fica com a que tiver mais casas. */
async function lerNasImagens(imagens, servidor) {
  const refs = await referencias();
  const cat = await catalogoDe();
  enviar('mochila:progresso', { fase: 'ler' });
  let melhor = null;
  for (const { nome, img, alturaEcra } of imagens) {
    const r = lerMochila(img, cat, { alturaEcra });
    // Os recortes vêm da imagem usada (reescalada, se o ecrã não for 1440p).
    if (r && (!melhor || r.casas.length > melhor.r.casas.length)) melhor = { nome, img: r.img, original: img, r };
  }
  if (!melhor) return { encontrada: false, ecras: imagens.map((i) => `${i.nome} (${i.img.largura}×${i.img.altura})`) };
  // A última foto fica guardada: quando uma leitura sai mal, é o que permite ver porquê.
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'ultima-mochila.png'), I.escreverPNG(melhor.original));
  } catch {
    /* diagnóstico apenas */
  }
  // Para cada item reconhecido: a ficha (o renderer só tem as do servidor escolhido)
  // e a linha do servidor de referência, para quando o escolhido não o tem à venda.
  const ids = [...new Set(melhor.r.casas.flatMap((c) => c.ids || []))];
  const todas = nomes.todosConhecidos();
  const fichas = {};
  const refLinhas = {}; // id → { linha, servidor } do primeiro servidor de reserva que o tem
  for (const id of ids) {
    if (todas[id]) fichas[id] = todas[id];
    for (const r of refs) {
      if (r.servidor === Number(servidor)) continue;
      const l = r.linhas.find((x) => x.id === id && x.price);
      if (l) {
        refLinhas[id] = { linha: l, servidor: r.nomeServidor };
        break;
      }
    }
  }
  const lojas = {};
  for (const id of ids) {
    const un = fichas[id] ? loja.de(fichas[id].nome) : null;
    if (un != null) lojas[id] = un;
  }
  return {
    encontrada: true,
    lojas,
    ecra: melhor.nome,
    resolucao: `${melhor.original.largura}×${melhor.original.altura}`,
    experimental: melhor.r.escala !== 1,
    icones: cat.tamanho,
    fichas,
    ref: { linhas: refLinhas },
    casas: melhor.r.casas.map((c) => ({ ...c, recorte: recortePNG(melhor.img, c.x, c.y) })),
  };
}

// ── cartões do jogo: a faixa por baixo ─────────────────────────────────────

/** A janela transparente das faixas, por cima do ecrã dado. Não apanha o rato. */
function faixaPara(ecra) {
  if (!janelaFaixa || janelaFaixa.isDestroyed()) {
    janelaFaixa = new BrowserWindow({
      ...ecra.bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      show: false,
      title: 'Aion Helper · faixa',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    janelaFaixa.setIgnoreMouseEvents(true);
    janelaFaixa.setAlwaysOnTop(true, 'screen-saver');
    janelaFaixa.loadFile(path.join(__dirname, 'renderer', 'faixa.html'));
    janelaFaixa.on('closed', () => (janelaFaixa = null));
  } else {
    janelaFaixa.setBounds(ecra.bounds);
  }
  return janelaFaixa;
}

function esconderFaixas() {
  clearTimeout(relogioFaixa);
  if (janelaFaixa && !janelaFaixa.isDestroyed()) janelaFaixa.hide();
}

/** Itens com nome conhecido no servidor escolhido: [{ id, nome }] e as linhas de preço. */
function itensDoServidor() {
  const lista = (cache.ler('servidores') || { dados: {} }).dados;
  const servidor = defs.todas().servidor || lista.omissao;
  const linhas = (cache.ler('itens-' + Number(servidor)) || {}).dados || [];
  const s = (lista.servidores || []).find((x) => x.id === servidor);
  return {
    servidor,
    nomeServidor: s ? s.nome : String(servidor),
    linhas,
    // Todos os nomes conhecidos: um item que o Odar não tem continua a ser reconhecido.
    itens: Object.entries(nomes.todosConhecidos()).map(([id, f]) => ({ id: Number(id), nome: f.nome })),
  };
}

/** O preço a afirmar para um id: média vendida → referência 72 h → anúncio mais barato. */
async function precoDe(id, ctx) {
  const linha = ctx.linhas.find((l) => l.id === id);
  if (!linha) return null;
  const p = P.precoDaLinha(linha);
  const base = { anuncios: linha.listings, servidor: ctx.nomeServidor };
  if (p.base === 'vendido') return { ...base, valor: p.valor, base: 'vendido' };
  try {
    const r = await comCache(`item-${ctx.servidor}-${id}`, PRECOS_FRESCOS_MS, async () => ({
      historico: await sources.historico(id, ctx.servidor),
      profundidade: { unidades: null, pontos: [] },
    }));
    const ref = P.referenciaDoHistorico(r.dados.historico || []).valor;
    if (ref != null) return { ...base, valor: ref, base: 'referência' };
  } catch {
    /* sem histórico fica o anúncio, com os avisos */
  }
  return p.valor == null ? null : { ...base, valor: p.valor, base: 'pedido', avisos: P.avisos(linha) };
}

/** Do que o OCR leu até às faixas, em píxeis da imagem. Separado da captura para se testar com ficheiros. */
async function faixasDosCartoes(img, linhasOCR) {
  const faixas = [];
  for (const c of encontrarCartoes(img, linhasOCR)) faixas.push(await faixaDoCartao(c));
  return faixas;
}

/**
 * A faixa de um cartão: { nome, x, y, largura, preco|null, motivo|null, nota }.
 * x, y e largura vêm nas mesmas coordenadas do cartão (imagem ou ecrã).
 */
async function faixaDoCartao(c) {
  const ctx = itensDoServidor();
  const refs = (await referencias()).filter((r) => r.servidor !== Number(ctx.servidor));
  {
    const casado = casarNome(c.nome, c.cortado, ctx.itens);
    const nota = notas.de(c.nome, c.cortado);
    let preco = null;
    let motivo = null;
    if (casado) {
      let precos = (await Promise.all(casado.ids.map(async (id) => ({ id, p: await precoDe(id, ctx) })))).filter((x) => x.p);
      // Sem anúncios no servidor escolhido: o primeiro servidor de reserva que tiver, e di-lo.
      for (const r of refs) {
        if (precos.length) break;
        precos = (await Promise.all(casado.ids.map(async (id) => ({ id, p: await precoDe(id, r) })))).filter((x) => x.p);
        for (const x of precos) x.p.deOutro = `sem anúncios em ${ctx.nomeServidor}: este é o preço de ${r.nomeServidor}`;
      }
      precos.sort((a, b) => a.p.valor - b.p.valor);
      if (precos.length) {
        preco = { ...precos[0].p };
        if (precos.length > 1) preco.outros = precos.slice(1).map((x) => ctx.itens.find((i) => i.id === x.id).nome).join(', ');
      } else motivo = `sem anúncios agora em ${[ctx.nomeServidor, ...refs.map((r) => r.nomeServidor)].join(', ')}`;
    } else {
      // Não é "não se vende": o aion2.exchange só segue ~500 itens do mercado.
      motivo = ctx.itens.length
        ? 'sem preço conhecido: o aion2.exchange não segue este item'
        : 'ainda sem a lista do mercado: abre a aba Preços uma vez';
    }
    // O preço da loja: o que o cartão mostra agora, ou o que já se viu antes.
    if (c.loja) loja.aprender(c.nome, c.loja.unidade);
    const lojaUn = c.loja ? c.loja.unidade : loja.de(c.nome, c.cortado);
    const venda = ondeVender(preco ? preco.valor : null, lojaUn);
    return { nome: c.nome, cortado: c.cortado, x: c.x, y: c.fundo, largura: c.largura, preco, motivo, nota: nota && nota.texto, venda };
  }
}

async function fotografarEcra(ecra) {
  const tamanho = { width: Math.round(ecra.size.width * ecra.scaleFactor), height: Math.round(ecra.size.height * ecra.scaleFactor) };
  const fontes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: tamanho });
  const f = fontes.find((s) => String(s.display_id) === String(ecra.id)) || (fontes.length === 1 ? fontes[0] : null);
  if (!f) throw new Error('não consegui fotografar o ecrã');
  const { width, height } = f.thumbnail.getSize();
  return { img: I.deBGRA(f.thumbnail.toBitmap(), width, height), png: f.thumbnail.toPNG() };
}

/** Mostra as faixas por cima do ecrã dado; as faixas vêm em píxeis da imagem desse ecrã. */
function mostrarFaixas(ecra, faixas, { temporizador = true } = {}) {
  // Píxeis da imagem → coordenadas da janela (DIP): divide-se pela escala do ecrã.
  const k = ecra.scaleFactor;
  const jan = faixaPara(ecra);
  const mostrar = () => {
    jan.webContents.send('faixas:mostrar', faixas.map((f) => ({ ...f, x: f.x / k, y: f.y / k, largura: f.largura / k })));
    jan.showInactive();
    clearTimeout(relogioFaixa);
    if (temporizador) relogioFaixa = setTimeout(esconderFaixas, FAIXA_SEGUNDOS * 1000);
  };
  if (jan.webContents.isLoading()) jan.webContents.once('did-finish-load', mostrar);
  else mostrar();
  return jan;
}

/** Faixas em píxeis físicos do ecrã → mostradas na janela do ecrã onde estão. */
function mostrarFaixasDoEcra(faixas) {
  if (!faixas.length) {
    esconderFaixas();
    return;
  }
  const dip = (p) => (process.platform === 'win32' ? screen.screenToDipPoint(p) : p);
  const p0 = dip({ x: faixas[0].x, y: faixas[0].y });
  const ecra = screen.getDisplayNearestPoint(p0);
  const k = ecra.scaleFactor;
  // mostrarFaixas divide por k; aqui passa-se já relativo ao canto do ecrã, em físicos.
  const rel = faixas.map((f) => {
    const d = dip({ x: f.x, y: f.y });
    return { ...f, x: (d.x - ecra.bounds.x) * k, y: (d.y - ecra.bounds.y) * k };
  });
  mostrarFaixas(ecra, rel, { temporizador: false });
}

function vigiaLigar(on) {
  if (!vigia) {
    vigia = new Vigia({
      ocr,
      faixaDe: async (c) => {
        const f = await faixaDoCartao(c);
        ultimosCartoes = [f.nome];
        enviar('cartoes:lidos', { faixas: [{ nome: f.nome, preco: f.preco, motivo: f.motivo }], ms: 0, auto: true });
        return f;
      },
      mostrar: mostrarFaixasDoEcra,
      aoErro: (e) => registarErro('vigia', e),
    });
  }
  if (on) vigia.ligar();
  else vigia.desligar();
  return !!on;
}

let aLer = false;
async function lerCartoes() {
  if (aLer) return;
  aLer = true;
  try {
    const ecra = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    esconderFaixas();
    await new Promise((r) => setTimeout(r, 60)); // a faixa anterior não pode sair na foto
    const t0 = Date.now();
    const { img, png } = await fotografarEcra(ecra);
    const linhas = await ocr.ler(gravarTemp(png, 'cartao.png'));
    const faixas = await faixasDosCartoes(img, linhas);
    ultimoCartaoManual = { png, linhas, faixas, quando: new Date().toISOString() };
    ultimosCartoes = faixas.map((f) => f.nome);
    enviar('cartoes:lidos', { faixas: faixas.map(({ nome, preco, motivo }) => ({ nome, preco, motivo })), ms: Date.now() - t0 });
    if (faixas.length) mostrarFaixas(ecra, faixas);
  } catch (e) {
    registarErro('Ctrl+Alt+P', e);
    enviar('cartoes:lidos', { erro: e.message });
  } finally {
    aLer = false;
  }
}

function abrirNota() {
  if (!win) return;
  esconderFaixas();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  enviar('notas:editar', { nomes: ultimosCartoes });
}

/**
 * Junta numa pasta o que é preciso para perceber porque é que algo falhou: as
 * últimas capturas, o que o OCR leu, os erros, e como é o ecrã. É o que alguém
 * da comunidade manda quando diz "não funciona" — sem isto, era pedir capturas
 * às cegas. Não leva notas nem dados da conta; as capturas mostram o que estiver
 * no ecrã do jogo, e a aba diz isso.
 */
async function guardarDiagnostico() {
  const quando = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(app.getPath('userData'), 'diagnosticos', quando);
  fs.mkdirSync(dir, { recursive: true });
  const ud = app.getPath('userData');
  const copiar = (de, para) => {
    try {
      fs.copyFileSync(path.join(ud, de), path.join(dir, para));
      return true;
    } catch {
      return false;
    }
  };
  const tem = { mochila: copiar('ultima-mochila.png', 'ultima-mochila.png') };
  if (ultimoCartaoManual) {
    fs.writeFileSync(path.join(dir, 'ultimo-cartao.png'), ultimoCartaoManual.png);
    fs.writeFileSync(
      path.join(dir, 'ultimo-cartao.json'),
      JSON.stringify({ quando: ultimoCartaoManual.quando, linhasOCR: ultimoCartaoManual.linhas, faixas: ultimoCartaoManual.faixas }, null, 1),
    );
  }
  // Uma foto do ecrã do jogo agora, se ele estiver aberto (a app está à frente, por
  // isso a foto é do ecrã onde o jogo costuma estar: o principal).
  try {
    const { png } = await fotografarEcra(screen.getPrimaryDisplay());
    fs.writeFileSync(path.join(dir, 'ecra-agora.png'), png);
  } catch (e) {
    registarErro('diagnóstico: foto do ecrã', e);
  }
  const lista = (cache.ler('servidores') || { dados: {} }).dados;
  const info = {
    app: { versao: app.getVersion(), electron: process.versions.electron, so: `${process.platform} ${require('os').release()}` },
    ecras: screen.getAllDisplays().map((d) => ({ limites: d.bounds, escala: d.scaleFactor, principal: d.id === screen.getPrimaryDisplay().id })),
    definicoes: { ...defs.todas(), limites: undefined },
    servidor: (lista.servidores || []).find((s) => s.id === (defs.todas().servidor || lista.omissao)) || null,
    vigia: vigia ? { ligada: vigia.ligado, cartoesAbertos: vigia.cartoes.length, ultimaLeitura: vigia.ultimaLeitura } : null,
    atalhosFalhados,
    ocr: ocr && ocr.proc ? 'a correr' : 'parado',
    nomesConhecidos: Object.keys(nomes.todosConhecidos()).length,
    temUltimaMochila: tem.mochila,
    erros: errosRecentes,
  };
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 1));
  if (!process.env.AION_CAPTURA) shell.openPath(dir);
  return dir;
}

/**
 * Verifica os alertas de preço. Corre ao arrancar (passado meio minuto) e de 15
 * em 15 minutos, o ritmo a que o aion2.exchange recolhe; pedir mais vezes só
 * carregava o servidor dele sem dados novos.
 */
async function verificarAlertas() {
  const lista = alertas.todos();
  if (!lista.length) return;
  const mapas = new Map();
  for (const srv of [...new Set(lista.map((a) => a.servidor))]) {
    try {
      const linhas = (await comCache('itens-' + srv, PRECOS_FRESCOS_MS, () => sources.itensDoServidor(srv))).dados;
      mapas.set(srv, new Map(linhas.filter((l) => l.price).map((l) => [l.id, l.price])));
    } catch (e) {
      registarErro('alertas', e);
    }
  }
  for (const a of alertas.verificar((srv) => mapas.get(srv) || null)) {
    if (!Notification.isSupported()) continue;
    const n = new Notification({
      title: `${a.nome}: ${P.formatarKinah(a.atual)}`,
      body: `Em ${a.nomeServidor} está a ${P.formatarKinah(a.atual)} (o teu alerta: ${P.formatarKinah(a.limite)} ou menos).`,
      silent: false,
    });
    n.on('click', () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    n.show();
  }
  enviar('alertas:mudaram', alertas.todos());
}

function registarAtalhos() {
  const falhas = [];
  if (!globalShortcut.register(ATALHO_CARTAO, lerCartoes)) falhas.push(ATALHO_CARTAO);
  if (!globalShortcut.register(ATALHO_NOTA, abrirNota)) falhas.push(ATALHO_NOTA);
  return falhas;
}

function registarIPC() {
  ipcMain.handle('win:minimize', () => win && win.minimize());
  ipcMain.handle('win:close', () => app.quit());
  ipcMain.handle('win:pin', (_e, on) => {
    if (win) win.setAlwaysOnTop(!!on);
    defs.mudar({ pin: !!on });
    return !!on;
  });
  ipcMain.handle('link:abrir', (_e, url) => {
    if (/^https:\/\//.test(String(url))) shell.openExternal(String(url));
  });

  ipcMain.handle('defs:todas', () => defs.todas());
  ipcMain.handle('notas:todas', () => notas.todas());
  ipcMain.handle('notas:escrever', (_e, { nome, texto }) => notas.escrever(nome, texto));
  ipcMain.handle('cartoes:ler', () => lerCartoes());
  ipcMain.handle('diagnostico:guardar', () => guardarDiagnostico());
  ipcMain.handle('alertas:todos', () => alertas.todos());
  ipcMain.handle('idioma:estado', async () => {
    await ocr.arrancar().catch(() => {});
    return { idioma: nomes.idioma, idiomas: sources.IDIOMAS, ocr: ocr.idiomaOCR };
  });
  ipcMain.handle('idioma:mudar', async (_e, idioma) => {
    if (!sources.IDIOMAS[idioma]) throw new Error('idioma desconhecido: ' + idioma);
    defs.mudar({ idioma });
    // Nomes noutro idioma, e o OCR a ler nesse idioma (recomeça o processo).
    nomes = new Nomes(cache, idioma);
    catalogo = null;
    const ligada = vigia && vigia.ligado;
    if (vigia) vigia.desligar();
    ocr.parar();
    ocr = new OCR(idioma);
    if (vigia) vigia.ocr = ocr;
    await ocr.arrancar().catch(() => {});
    if (ligada) vigia.ligar();
    return { idioma, ocr: ocr.idiomaOCR };
  });
  ipcMain.handle('alertas:definir', (_e, a) => alertas.definir(a));
  ipcMain.handle('alertas:apagar', (_e, { itemId, servidor }) => alertas.apagar(itemId, servidor));

  // Definições: os servidores de reserva.
  ipcMain.handle('reservas:estado', async () => {
    const lista = (cache.ler('servidores') || { dados: {} }).dados;
    const t = cache.ler('tamanhos');
    return {
      escolhido: defs.todas().servidor || lista.omissao,
      marcados: defs.todas().referencias || [],
      automatico: await referenciaAutomatica(lista).catch(() => null),
      servidores: lista.servidores || [],
      tamanhos: t ? t.dados : {},
    };
  });
  ipcMain.handle('reservas:medir', async () => {
    const lista = (cache.ler('servidores') || { dados: {} }).dados;
    return tamanhosDe((lista.servidores || []).map((s) => s.id), (p) => enviar('reservas:progresso', p));
  });
  ipcMain.handle('reservas:mudar', (_e, ids) => {
    defs.mudar({ referencias: (ids || []).map(Number) });
    return defs.todas().referencias;
  });
  ipcMain.handle('cartoes:auto', (_e, on) => {
    defs.mudar({ automatico: !!on });
    return vigiaLigar(!!on);
  });
  ipcMain.handle('atalhos:estado', () => ({ cartao: ATALHO_CARTAO, nota: ATALHO_NOTA, falhas: atalhosFalhados }));
  ipcMain.handle('defs:mudar', (_e, alt) => defs.mudar(alt));

  // ── builds de habilidades ─────────────────────────────────────────────────
  const idiomaNC = () => defs.todas().idioma || sources.IDIOMA;
  const classesNC = () => comCache('classes-' + idiomaNC(), HABILIDADES_MS, () => habilidades.classes(idiomaNC()));
  ipcMain.handle('clip:escrever', (_e, t) => clipboard.writeText(String(t).slice(0, 20000)));
  ipcMain.handle('builds:todas', () => builds.todas());
  ipcMain.handle('builds:nova', (_e, classe) => builds.guardar(B.novaBuild(classe)));
  ipcMain.handle('builds:guardar', (_e, b) => builds.guardar(b));
  ipcMain.handle('builds:apagar', (_e, id) => builds.apagar(id));
  ipcMain.handle('builds:exportar', (_e, b) => B.exportar(b));
  ipcMain.handle('builds:importar', (_e, codigo) => builds.guardar(B.importar(codigo)));
  ipcMain.handle('builds:limites', () => ({ barras: B.BARRAS, casas: B.CASAS, nivelMax: B.NIVEL_MAX, especMax: B.ESPEC_MAX, regioes: habilidades.REGIOES }));
  ipcMain.handle('builds:classes', () => classesNC());
  ipcMain.handle('builds:habilidades', async (_e, nomeClasse) => {
    const { dados: lista } = await classesNC();
    const classe = lista.find((c) => c.nome === nomeClasse);
    if (!classe) throw new Error('classe desconhecida: ' + nomeClasse);
    return comCache(`habilidades-${nomeClasse}-${idiomaNC()}`, HABILIDADES_MS, () => habilidades.habilidadesDaClasse(classe, { idioma: idiomaNC() }));
  });
  ipcMain.handle('builds:procurarPersonagem', async (_e, { nome, regiao }) => {
    if (!habilidades.REGIOES[regiao]) throw new Error('região desconhecida');
    const { dados: lista } = await classesNC();
    const achados = await habilidades.procurarPersonagens(String(nome || '').slice(0, 40), { regiao, idioma: idiomaNC() });
    // A pesquisa diz o pcId; a app fala em classes.
    return achados.map((a) => {
      const c = lista.find((x) => x.pcIds.includes(a.pcId));
      return { ...a, classe: c ? c.nome : null, classeTexto: c ? c.texto : '?' };
    });
  });
  // ── personagem, Daevanion e itens ──────────────────────────────────────────
  const opcoesNC = (regiao) => {
    if (regiao && !habilidades.REGIOES[regiao]) throw new Error('região desconhecida');
    return { idioma: idiomaNC(), regiao: regiao || defs.todas().regiaoNC || 'eu' };
  };
  const refDe = (r) => ({ servidor: Number(r.servidor), personagem: String(r.personagem || '').slice(0, 200) });
  ipcMain.handle('pers:ficha', (_e, r) => personagem.ficha(refDe(r), opcoesNC(r.regiao)));
  ipcMain.handle('pers:item', (_e, { ref, item }) => personagem.itemEquipado(refDe(ref), item, opcoesNC(ref.regiao)));
  ipcMain.handle('pers:tabuleiro', (_e, { ref, id }) => personagem.tabuleiro(refDe(ref), Number(id), opcoesNC(ref.regiao)));
  ipcMain.handle('dv:tabuleiros', async (_e, nomeClasse) => {
    const { dados: lista } = await classesNC();
    const classe = lista.find((c) => c.nome === nomeClasse);
    if (!classe) throw new Error('classe desconhecida: ' + nomeClasse);
    return comCache(`tabuleiros-${nomeClasse}-${idiomaNC()}`, HABILIDADES_MS, () => personagem.tabuleirosDaClasse(classe, { idioma: idiomaNC() }));
  });
  ipcMain.handle('itens:indice', () => indiceItens());
  ipcMain.handle('itens:ficha', (_e, { id, encantamento }) => {
    const n = Number(id);
    const enc = Math.max(0, Math.min(30, Number(encantamento) || 0));
    return comCache(`item-${n}-${enc}-${idiomaNC()}`, 30 * 24 * 3600e3, async () => {
      const f = await personagem.item(n, { idioma: idiomaNC(), encantamento: enc });
      if (!f) throw new Error('A NC não conhece esse item no Global');
      return f;
    });
  });

  ipcMain.handle('builds:doPersonagem', (_e, { servidor, personagem, regiao }) =>
    habilidades.habilidadesDoPersonagem({ servidor, personagem }, { idioma: idiomaNC(), regiao }));

  ipcMain.handle('dados:servidores', () => comCache('servidores', SERVIDORES_MS, sources.servidores));

  ipcMain.handle('dados:itens', async (_e, { servidor, forcar } = {}) => {
    const chave = 'itens-' + Number(servidor);
    const r = await comCache(chave, forcar ? 0 : PRECOS_FRESCOS_MS, () => sources.itensDoServidor(Number(servidor)));
    // A idade dos preços é a da última recolha do exchange, não a do nosso pedido:
    // ir buscar agora dados que ele recolheu há 7 h continua a ser ver preços de há 7 h.
    let recolha = null;
    try {
      recolha = (await comCache('saude', 5 * 60e3, sources.saude)).dados;
    } catch {
      /* sem saúde não se mostra a idade; os preços servem na mesma */
    }
    const ids = r.dados.map((l) => l.id);
    const fichas = nomes.conhecidos(ids);
    // Os nomes que faltam chegam depois, por evento — a lista não espera por eles.
    const nomesEmFalta = nomes.emFalta(ids).length;
    if (nomesEmFalta) {
      nomes
        .completar(ids, (lote, progresso) => enviar('nomes:lote', { lote, progresso }))
        .catch((e) => enviar('nomes:lote', { lote: {}, progresso: { fim: true, erro: e.message } }));
    }
    return { ...r, fichas, recolha, nomesEmFalta };
  });

  ipcMain.handle('mochila:ler', async (_e, { servidor }) => {
    const imagens = await fotografarEcras();
    return lerNasImagens(imagens, servidor);
  });

  ipcMain.handle('mochila:abrir', async (_e, { servidor }) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Escolhe uma captura do ecrã com a mochila aberta',
      filters: [{ name: 'Imagens PNG', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const f = r.filePaths[0];
    return lerNasImagens([{ nome: path.basename(f), img: I.lerPNG(fs.readFileSync(f)) }], servidor);
  });

  // Só para testes: lê uma imagem dada pelo caminho (AION_MOCHILA).
  ipcMain.handle('mochila:teste', async (_e, { servidor }) => {
    const f = process.env.AION_MOCHILA;
    if (!f) return null;
    return lerNasImagens([{ nome: path.basename(f), img: I.lerPNG(fs.readFileSync(f)) }], servidor);
  });

  ipcMain.handle('dados:item', async (_e, { id, servidor }) => {
    const chave = `item-${Number(servidor)}-${Number(id)}`;
    return comCache(chave, PRECOS_FRESCOS_MS, async () => {
      const [historico, profundidade] = await Promise.all([
        sources.historico(Number(id), Number(servidor)),
        sources.profundidade(Number(id), Number(servidor)).catch(() => ({ unidades: null, pontos: [] })),
      ]);
      return { historico, profundidade };
    });
  });
}

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  cache = new Cache(path.join(dir, 'cache'));
  defs = new Definicoes(dir);
  notas = new Notas(dir);
  nomes = new Nomes(cache, defs.todas().idioma || sources.IDIOMA);
  loja = new Loja(dir);
  alertas = new Alertas(dir);
  // No modo de teste as builds vão para uma pasta temporária, para não tocar nas verdadeiras.
  builds = new B.Builds(process.env.AION_CAPTURA ? fs.mkdtempSync(path.join(require('os').tmpdir(), 'aion-builds-')) : dir);
  ocr = new OCR(defs.todas().idioma || sources.IDIOMA);
  // Arranca já: acordar o motor custa ~0,5 s, e o primeiro Ctrl+Alt+P não deve pagá-lo.
  ocr.arrancar().catch(() => {});
  registarIPC();
  atalhosFalhados = registarAtalhos();
  criarJanela();
  // Modo automático: ligado por omissão. Não gasta nada com o jogo fechado ou atrás.
  if (defs.todas().automatico !== false && !process.env.AION_CAPTURA) vigiaLigar(true);
  if (!process.env.AION_CAPTURA) {
    // O Windows só mostra notificações de apps com nome próprio.
    app.setAppUserModelId('com.lusitanoscripts.aionhelper');
    setTimeout(() => verificarAlertas().catch((e) => registarErro('alertas', e)), 30e3);
    setInterval(() => verificarAlertas().catch((e) => registarErro('alertas', e)), PRECOS_FRESCOS_MS);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (vigia) vigia.desligar();
  if (ocr) ocr.parar();
});

app.on('window-all-closed', () => app.quit());
