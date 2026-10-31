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
const OM = require('./src/olho-mascotes');
const CR = require('./src/colecao-retratos');
const { Loja, ondeVender } = require('./src/loja');
const { Alertas } = require('./src/alertas');
const habilidades = require('./src/habilidades');
const B = require('./src/builds');
const personagem = require('./src/personagem');
const P = require('./src/pricing');
const A = require('./src/assistente');
const T = require('./src/temporizadores');
const D = require('./src/daevanion');
const M = require('./src/missoes');
const TT = require('./src/titulos');
const R = require('./src/radar');
const CB = require('./src/cubo');
const MD = require('./src/medidor');
const { Lutas } = require('./src/lutas');

const ATALHO_CARTAO = 'Control+Alt+P';
const ATALHO_NOTA = 'Control+Alt+N';
const ATALHO_MASCOTES = 'Control+Alt+M';
const ATALHO_RECOLHA = 'Control+Alt+R';
const ATALHO_CUBOS = 'Control+Alt+H';
const ATALHO_MEDIDOR = 'Control+Alt+D';
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
let vigiaMascotes = null;
let janelaMascote = null;
let relogioAviso = null;
let catMascotes = null; // OM.catalogo da lista no idioma do jogo
let catRetratos = null; // CR.catalogoRetratos — os retratos oficiais, para ler a coleção
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
    // Abrir a app outra vez (atalho, Freedeck…) traz a janela; se ela já não existir, cria-a.
    if (!win || win.isDestroyed()) {
      if (app.isReady()) criarJanela();
      return;
    }
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
  // Fechar a janela principal por fora (barra de tarefas, Alt+F4) também fecha a app:
  // as janelas escondidas das faixas e das mascotes deixavam-na viva e sem janela.
  win.on('closed', () => {
    win = null;
    if (!process.env.AION_CAPTURA) app.quit();
  });
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
      const faixas = await faixasDoEcra(img, lidas);
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
    if (process.env.AION_MASCOTE) {
      // As mascotes a sério, sobre uma captura: OCR → alvo, almas e coleção →
      // o aviso compõe-se por cima da captura (destino) e a aba vai para destino.aba.png.
      const f = process.env.AION_MASCOTE;
      const img = I.lerPNG(fs.readFileSync(f));
      const linhas = await ocr.ler(f);
      const cat = catalogoMascotes();
      const alvo = OM.mascoteDoAlvo(linhas, cat);
      console.log('alvo:', alvo && alvo.nome, '· almas:', JSON.stringify(OM.almasNovas(new Map(), OM.almasNoChat(linhas, cat))));
      if (alvo) mostrarMascote('alvo', { nome: alvo.nome, grau: 'Comum', tem: false, almas: 0, x: alvo.linha.x1, y: alvo.linha.y2 + 6 });
      avisoMascote('+1 alma: Abelha Mutante (1)', [0, 0, img.largura, img.altura], 30);
      await js("document.querySelector('#abas [data-aba=mascotes]').click()");
      enviar('mascotes:colecao', { lidas: OM.lerColecao(linhas, cat, (l) => luzDoTexto(img, l)), quando: new Date().toISOString() });
      await new Promise((r) => setTimeout(r, 2000));
      fs.writeFileSync(destino + '.aba.png', (await win.webContents.capturePage()).toPNG());
      const cap = await janelaMascote.webContents.capturePage();
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

// ── mascotes ────────────────────────────────────────────────────────────────

/** src/dados/mascotes.json (gerado por scripts/gerar-mascotes.js), no idioma do jogo. */
function listaMascotes() {
  const idioma = idiomaDoJogo() === 'pt-BR' ? 'pt-BR' : 'en-US';
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'dados', 'mascotes.json'), 'utf8'));
  } catch {
    return { gerado: null, mascotes: [] };
  }
  const ICONES = 'https://assets.playnccdn.com/static-aion2-gamedata/resources/';
  return {
    gerado: j.gerado,
    mascotes: j.mascotes.map((m) => ({
      id: m.id,
      nome: m.n[idioma] || m.n['en-US'],
      outro: idioma === 'en-US' ? m.n['pt-BR'] : m.n['en-US'],
      grau: m.g,
      grauNome: (idioma === 'pt-BR' && m.gn) || m.g,
      icone: m.i ? ICONES + m.i : null,
      fontes: m.f[idioma] || [],
      alma: m.alma ? { id: m.alma.id, fontes: m.alma.f[idioma] || [] } : null,
    })),
  };
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
/** As faixas de tudo o que o ecrã tiver: cartões de itens e, na janela dos títulos, a comparação. */
async function faixasDoEcra(img, linhasOCR) {
  const faixas = await faixasDosCartoes(img, linhasOCR);
  // O que sobe e o que desce trocando o efeito equipado pelo do título escolhido (src/titulos.js).
  const titulo = TT.compararTitulos(linhasOCR, img);
  if (titulo) faixas.push({ x: titulo.x, y: titulo.y, largura: titulo.largura, titulo });
  return faixas;
}

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

// ── mascotes no jogo: alvo, almas do chat e coleção ────────────────────────

function opcoesMascotes() {
  return { alvo: true, almas: true, zonas: null, ...(defs.todas().mascotesNoJogo || {}) };
}

function catalogoMascotes() {
  // Os nomes nos dois idiomas (o do jogo e o "outro" da lista): reconhece-se a
  // mascote mesmo que o idioma nas Definições não seja o do cliente do jogo.
  if (!catMascotes) {
    const lista = listaMascotes().mascotes;
    catMascotes = OM.catalogo([...lista, ...lista.filter((m) => m.outro && m.outro !== m.nome).map((m) => ({ ...m, nome: m.outro }))]);
  }
  return catMascotes;
}

/** O registo de uma mascote no personagem escolhido na aba ({ tem, nivel, almas }). */
function registoMascote(id) {
  const m = defs.todas().mascotes;
  const c = m && m.personagens && m.personagens[m.atual];
  return (c && c[id]) || {};
}

/** A janela transparente dos avisos das mascotes (separada da das faixas dos cartões). */
function janelaMascotePara(ecra) {
  if (!janelaMascote || janelaMascote.isDestroyed()) {
    janelaMascote = new BrowserWindow({
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
      title: 'Aion Helper · mascote',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // A janela nunca recebe cliques (click-through): sem isto o Chromium
        // deixa o AudioContext suspenso e os sons (recolha, cubos) não tocam.
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    janelaMascote.setIgnoreMouseEvents(true);
    janelaMascote.setAlwaysOnTop(true, 'screen-saver');
    janelaMascote.loadFile(path.join(__dirname, 'renderer', 'mascote.html'));
    janelaMascote.on('closed', () => (janelaMascote = null));
  } else {
    janelaMascote.setBounds(ecra.bounds);
  }
  return janelaMascote;
}

/**
 * Mostra (ou esconde, com null) uma das partes do aviso das mascotes, com x, y
 * em píxeis físicos do ecrã. O alvo fica até o jogo o largar; o aviso (alma
 * contada, coleção lida) some sozinho.
 */
const avisosMascote = { alvo: null, aviso: null, radar: null, cubo: null };
function mostrarMascote(parte, conteudo) {
  avisosMascote[parte] = conteudo;
  const algum = avisosMascote.alvo || avisosMascote.aviso || avisosMascote.radar || avisosMascote.cubo;
  if (!algum) {
    if (janelaMascote && !janelaMascote.isDestroyed()) janelaMascote.hide();
    return;
  }
  const dip = (p) => (process.platform === 'win32' ? screen.screenToDipPoint(p) : p);
  const ecra = screen.getDisplayNearestPoint(dip({ x: algum.x, y: algum.y }));
  const rel = (a) => {
    if (!a) return null;
    const d = dip({ x: a.x, y: a.y });
    // As marcas (anéis à volta dos cubos) também vêm em píxeis do ecrã.
    const marcas = a.marcas && a.marcas.map((m) => ({ ...m, ...rel({ x: m.x, y: m.y }), r: m.r / ecra.scaleFactor }));
    return { ...a, x: d.x - ecra.bounds.x, y: d.y - ecra.bounds.y, ...(marcas ? { marcas } : {}) };
  };
  const jan = janelaMascotePara(ecra);
  const enviarJa = () => {
    jan.webContents.send('mascote:mostrar', {
      alvo: rel(avisosMascote.alvo),
      aviso: rel(avisosMascote.aviso),
      radar: rel(avisosMascote.radar),
      cubo: rel(avisosMascote.cubo),
    });
    jan.showInactive();
  };
  if (jan.webContents.isLoading()) jan.webContents.once('did-finish-load', enviarJa);
  else enviarJa();
}

/** Um aviso curto por cima do chat (ou no canto de cima) da janela [x, y, w, h]. */
function avisoMascote(texto, janela, segundos = 5, onde = 'chat') {
  const [x, y, , h] = janela;
  mostrarMascote('aviso', { texto, x: x + 24, y: y + (onde === 'cima' ? 24 : Math.round(h * 0.45)) });
  clearTimeout(relogioAviso);
  // 0 = fica até ser trocado (a leitura da coleção vai-o atualizando).
  if (segundos) relogioAviso = setTimeout(() => mostrarMascote('aviso', null), segundos * 1000);
}

function vigiaMascotesLigar() {
  const o = opcoesMascotes();
  if (!vigiaMascotes) {
    vigiaMascotes = new OM.VigiaMascotes({
      ocr,
      // Onde estão os avisos da app agora (píxeis do ecrã), para o OCR não os ler como se fossem do jogo.
      ignorar: () =>
        ['alvo', 'aviso']
          .map((p) => avisosMascote[p])
          .filter(Boolean)
          .map((a) => {
            const k = screen.getDisplayNearestPoint(process.platform === 'win32' ? screen.screenToDipPoint({ x: a.x, y: a.y }) : a).scaleFactor;
            return [a.x - 12 * k, a.y - 12 * k, (a.texto ? 900 : 440) * k, (a.texto ? 70 : 170) * k];
          }),
      cat: catalogoMascotes,
      opcoes: opcoesMascotes,
      aoAlvo: (a, janela) => {
        if (!a) return mostrarMascote('alvo', null);
        const [jx, jy, , jh] = janela;
        const reg = registoMascote(a.id);
        const m = listaMascotes().mascotes.find((x) => x.id === a.id);
        mostrarMascote('alvo', {
          nome: (m && m.nome) || a.nome,
          outro: (m && m.outro) || null,
          grau: m && m.grauNome,
          tem: !!reg.tem,
          nivel: reg.nivel || null,
          almas: reg.almas || 0,
          almasPrecisa: reg.almasPrecisa || null,
          // À esquerda do ecrã, acima do aviso das almas (que fica a 45% da altura).
          x: jx + 24,
          y: jy + Math.round(jh * 0.28),
        });
      },
      aoAlmas: (novas, janela) => {
        const m = defs.todas().mascotes || { atual: 'Principal', personagens: { Principal: {} } };
        const c = m.personagens[m.atual] || (m.personagens[m.atual] = {});
        const frases = [];
        for (const n of novas) {
          const reg = { ...(c[n.id] || {}) };
          reg.almas = (reg.almas || 0) + n.n;
          c[n.id] = reg;
          frases.push(`+${n.n} alma: ${n.nome} (${reg.almas})`);
        }
        defs.mudar({ mascotes: m });
        enviar('mascotes:mudaram', m);
        avisoMascote(frases.join(' · '), janela);
      },
      aoErro: (e) => registarErro('mascotes', e),
    });
  }
  if ((o.alvo || o.almas) && !process.env.AION_CAPTURA) vigiaMascotes.ligar();
  else vigiaMascotes.desligar();
}

// ── modo recolha: os recursos do radar, com distância e direção ─────────────
//
// Liga-se quando se quer farmar (Ctrl+Alt+R ou nas Definições). Lê só o
// retângulo do radar duas vezes por segundo e mostra ao lado a lista dos
// losangos; quando aparece um novo, toca um som. Não carrega em teclas nem mexe
// no rato: andar e apanhar continua a ser o jogador (src/radar.js).

const RECOLHA_MS = 500;
let recolha = null; // { rasto, relogio, ultimoSom, somId, ultimaCal } enquanto ligada

function opcoesRecolha() {
  return { som: true, mPorPx: null, ...(defs.todas().recolha || {}) };
}

function estadoRecolha() {
  const o = opcoesRecolha();
  return { ligada: !!recolha, som: o.som, mPorPx: o.mPorPx, atalho: ATALHO_RECOLHA };
}

function recolhaLigar(on) {
  if (!!on === !!recolha) return estadoRecolha();
  if (on) {
    recolha = { rasto: new R.Rasto(), relogio: null, ultimoSom: 0, somId: 0, ultimaCal: 0, janela: null };
    voltaRecolha();
  } else {
    clearTimeout(recolha.relogio);
    const janela = recolha.janela;
    recolha = null;
    mostrarMascote('radar', null);
    if (janela) avisoMascote('Modo recolha desligado', janela, 3, 'cima');
  }
  enviar('recolha:estado', estadoRecolha());
  return estadoRecolha();
}

/**
 * Passar o rato num losango faz o jogo mostrar a dica com a distância
 * verdadeira ("Distance 55m"), à esquerda do radar. Lê-se essa dica e acerta-se
 * a escala — muda com o zoom do radar. Guarda-se em metros por píxel a 1440p.
 */
async function calibrarRecolha(zona, recursos, k) {
  const c = screen.getCursorScreenPoint();
  const rato = process.platform === 'win32' ? screen.dipToScreenPoint(c) : c;
  const [zx, zy, zw, zh] = zona;
  if (rato.x < zx || rato.y < zy || rato.x >= zx + zw || rato.y >= zy + zh) return;
  if (Date.now() - recolha.ultimaCal < 1500) return;
  const alvo = recursos.find((r) => Math.hypot(zx + r.x - rato.x, zy + r.y - rato.y) <= 9 * k);
  if (!alvo || alvo.px < 15 * k) return; // perto do centro, um píxel de erro pesa demais
  recolha.ultimaCal = Date.now();
  const linhas = await ocr.lerZona(zx - 420 * k, zy - 45 * k, 410 * k, 180 * k);
  const metros = R.distanciaDaDica(linhas);
  if (!metros || !recolha) return;
  const mPorPx = (metros * k) / alvo.px;
  const antes = opcoesRecolha().mPorPx || R.METROS_POR_PX;
  if (Math.abs(mPorPx - antes) / antes > 0.03) {
    defs.mudar({ recolha: { ...opcoesRecolha(), mPorPx: Math.round(mPorPx * 1000) / 1000 } });
    enviar('recolha:estado', estadoRecolha());
  }
}

async function voltaRecolha() {
  const r = recolha;
  if (!r) return;
  try {
    const v = await ocr.janela('AION2');
    if (recolha !== r) return;
    if (!v.jogo) {
      // O jogo atrás (ou minimizado): sem painel, e o rasto recomeça ao voltar.
      mostrarMascote('radar', null);
      r.rasto.limpar();
    } else {
      r.janela = v.janela;
      const k = v.janela[3] / R.REF_ALTURA;
      const zona = R.zonaDoRadar(v.janela, opcoesRecolha().ajuste);
      const img = await ocr.pixeis(...zona);
      if (recolha !== r) return;
      const o = opcoesRecolha();
      const mPorPx = (o.mPorPx || R.METROS_POR_PX) / k;
      const centro = R.centroDe(img.largura, img.altura);
      const recursos = R.encontrarRecursos(img, k).map((x) => R.descrever(x, centro, mPorPx));
      recursos.sort((a, b) => a.metros - b.metros);
      const novos = r.rasto.ver(recursos, k);
      if (novos.length && o.som && Date.now() - r.ultimoSom > 2500) {
        r.ultimoSom = Date.now();
        r.somId++;
      }
      calibrarRecolha(zona, recursos, k).catch((e) => registarErro('recolha (escala)', e));
      mostrarMascote('radar', {
        // Em baixo à direita, ao lado das barras de habilidades (pedido do
        // utilizador: ao lado do radar tapava a dica do losango e o ranking).
        x: Math.round(v.janela[0] + v.janela[2] - 330 * k),
        y: Math.round(v.janela[1] + v.janela[3] - 330 * k),
        recursos: recursos.slice(0, 6).map((x) => ({ metros: x.metros, seta: x.seta, claro: x.claro, novo: novos.includes(x) })),
        total: recursos.length,
        aproximado: !o.mPorPx,
        somId: r.somId,
        atalho: 'Ctrl+Alt+R',
      });
    }
  } catch (e) {
    registarErro('recolha', e);
  }
  if (recolha === r) r.relogio = setTimeout(voltaRecolha, RECOLHA_MS);
}

// ── Hidden Cubes: o cubo vermelho à vista no ecrã ──────────────────────────
//
// Os cubos não aparecem no minimapa nem no mapa. Com a vigia ligada (Ctrl+Alt+H
// ou nas Definições, e fica ligada de uma vez para a outra), a app fotografa a
// janela do jogo reduzida a metade de 1,5 em 1,5 s (~165 ms no processo do OCR)
// e procura o cubo na imagem (src/cubo.js). Visto em duas fotos seguidas →
// aviso no topo, anel à volta dele e um som. Só vê o que está à vista.
// Perto, o jogo escreve "Hidden Cube" por cima dele: de 3 em 3 s lê-se esse
// rótulo (OCR só do verde-água) — é o sinal mais seguro; a cor sozinha falhou
// em cubos ao sol e de lado (24 Out).

const CUBOS_MS = 1500;
const CUBOS_REDUCAO = 2;
let cubos = null; // { seguidor, seguidorRotulos, rotulos, volta, relogio, janela, anunciar } enquanto ligada
let somCubos = 0; // sobe a cada cubo novo; nunca recomeça, para o aviso saber quando tocar

function opcoesCubos() {
  return { ligado: false, som: true, ...(defs.todas().cubos || {}) };
}

function estadoCubos() {
  const o = opcoesCubos();
  return { ligada: !!cubos, som: o.som, atalho: ATALHO_CUBOS };
}

function cubosLigar(on, guardar = true) {
  if (guardar) defs.mudar({ cubos: { ...opcoesCubos(), ligado: !!on } });
  if (!!on !== !!cubos) {
    if (on) {
      // anunciar: diz "ligada" por cima do jogo na 1.ª volta (só quando foi o jogador a ligar).
      cubos = {
        seguidor: new CB.Seguidor(),
        // O rótulo é fiável: conta logo à primeira leitura.
        seguidorRotulos: new CB.Seguidor({ confirmar: 1, raio: 200 }),
        rotulos: [],
        volta: 0,
        relogio: null,
        janela: null,
        anunciar: guardar,
      };
      voltaCubos();
    } else {
      clearTimeout(cubos.relogio);
      const janela = cubos.janela;
      cubos = null;
      mostrarMascote('cubo', null);
      if (janela && guardar) avisoMascote('Vigia dos Hidden Cubes desligada', janela, 3, 'cima');
    }
  }
  enviar('cubos:estado', estadoCubos());
  return estadoCubos();
}

async function voltaCubos() {
  const c = cubos;
  if (!c) return;
  try {
    const v = await ocr.janela('AION2');
    if (cubos !== c) return;
    if (!v.jogo) {
      mostrarMascote('cubo', null);
      c.seguidor.limpar();
      c.seguidorRotulos.limpar();
      c.rotulos = [];
    } else {
      c.janela = v.janela;
      if (c.anunciar) {
        c.anunciar = false;
        avisoMascote('Vigia dos Hidden Cubes ligada · Ctrl+Alt+H desliga', v.janela, 3, 'cima');
      }
      const [jx, jy, jw, jh] = v.janela;
      const f = CUBOS_REDUCAO;
      const k = jh / CB.REF_ALTURA / f;
      const kUI = jh / CB.REF_ALTURA;
      c.volta++;
      const som = opcoesCubos().som;

      // 1) O rótulo "Hidden Cube" (perto): OCR só do verde-água, uma volta sim
      // outra não (~375 ms o ecrã inteiro). Fora: o topo (barra de cima), o
      // fundo (barra de habilidades) e o chat, que também escreve a verde-água.
      if (c.volta % 2 === 1) {
        const y0 = jy + Math.round(jh * 0.06);
        const linhas = await ocr.lerRotulos(jx, y0, jw, Math.round(jh * 0.84));
        if (cubos !== c) return;
        const chat = (r) => r.x < jx + jw * 0.34 && r.y > jy + jh * 0.5;
        // Em píxeis da imagem reduzida, como os cubos.
        c.rotulos = CB.rotulosDeCubo(linhas)
          .filter((r) => !chat(r))
          .map((r) => ({ x: (r.x - jx) / f, y: (r.y - jy) / f }));
        if (c.seguidorRotulos.ver(c.rotulos, k).novos.length && som) somCubos++;
      }

      const img = await ocr.pixeisReduzidos(jx, jy, jw, jh, f);
      if (cubos !== c) return;
      // Por baixo de cada rótulo, o cubo (regras soltas: o rótulo já diz que
      // está lá). Sem mancha que sirva, o anel fica onde o cubo costuma estar
      // (~47 px abaixo do rótulo a 1440p).
      const soltos = c.rotulos.length ? CB.encontrarCubos(img, k, { solto: true }) : [];
      const perto = c.rotulos.map((r) => {
        const cands = soltos.filter((m) => Math.abs(m.x - r.x) < 120 * k && m.y > r.y - 10 * k && m.y < r.y + 220 * k);
        const m = cands.sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y))[0];
        return m || { x: r.x, y: r.y + 47 * k, lado: 40 * k };
      });

      // 2) Ao longe, pela cor (regras apertadas). Os últimos 10% da janela são
      // a barra de habilidades (ícones fixos, alguns vermelhos).
      const vistos = CB.encontrarCubos(img, k).filter((x) => x.y < img.altura * 0.9);
      const { confirmados, novos } = c.seguidor.ver(vistos, k);
      const longe = confirmados.filter((m) => !perto.some((p) => Math.hypot(p.x - m.x, p.y - m.y) < 60 * k));
      if (novos.length && som && !c.rotulos.length) somCubos++;

      const todos = [...perto, ...longe];
      if (!todos.length) mostrarMascote('cubo', null);
      else {
        // Sem direção por palavras (o utilizador achou que não batia certo): o anel mostra onde.
        const n = todos.length;
        mostrarMascote('cubo', {
          x: Math.round(jx + jw / 2 - 210 * kUI),
          y: Math.round(jy + 70 * kUI),
          texto: perto.length ? (n > 1 ? `Hidden Cube perto! (${n} à vista)` : 'Hidden Cube perto!') : n > 1 ? `${n} Hidden Cubes à vista` : 'Hidden Cube à vista',
          marcas: todos.map((m) => ({ x: Math.round(jx + m.x * f), y: Math.round(jy + m.y * f), r: Math.round(Math.max(18 * kUI, m.lado * f * 0.9)) })),
          somId: somCubos,
          atalho: 'Ctrl+Alt+H',
        });
      }
    }
  } catch (e) {
    registarErro('cubos', e);
  }
  if (cubos === c) c.relogio = setTimeout(voltaCubos, CUBOS_MS);
}

// ── Medidor de DPS ────────────────────────────────────────────────────────────
// O jogo já mede o dano do jogador na janela "Análise de combate" (Ctrl+X no
// jogo), mas não guarda nada. Com o medidor ligado (Ctrl+Alt+D), com o AION2 à
// frente: procura a janela pelo título (OCR do jogo inteiro, de 3 em 3 s) e
// depois lê só esse retângulo 1×/s; src/medidor.js corta as leituras em lutas
// e src/lutas.js grava-as. Só o ecrã — o dano dos outros do grupo não aparece lá.

const MEDIDOR_MS = 1000;
const MEDIDOR_PROCURA_MS = 3000;
let medidor = null; // { luta, rect, falhas, fase, relogio, janela, anunciar } enquanto ligado
let lutas = null;

function opcoesMedidor() {
  return { ligado: false, ...(defs.todas().medidor || {}) };
}

function estadoMedidor() {
  const m = medidor;
  const vivo = m && m.luta.aoVivo;
  return {
    ligado: !!m,
    fase: !m ? 'desligado' : vivo ? 'em luta' : m.fase,
    alvo: vivo ? vivo.alvo : null,
    total: vivo ? vivo.total : null,
    dps: vivo ? vivo.dps : null,
    atalho: ATALHO_MEDIDOR,
  };
}

function personagemAtual() {
  return (defs.todas().mascotes || {}).atual || null;
}

function gravarLuta(feita) {
  if (!feita) return;
  try {
    const l = lutas.adicionar(feita, { personagem: personagemAtual() });
    if (l) enviar('lutas:nova', l);
  } catch (e) {
    // Disco cheio, antivírus a segurar o ficheiro…: perde-se esta luta, não a app.
    registarErro('lutas', e);
  }
}

// Só no modo de teste (AION_CAPTURA): umas lutas inventadas para se ver a aba Combate.
function lutasDeExemplo(g) {
  const base = Date.UTC(2026, 9, 31, 20, 0, 0);
  const exemplo = [
    ['Training Scarecrow', 30, 1800, 'Build A'],
    ['Training Scarecrow', 30, 2100, 'Build B'],
    ['Vakron', 40, 35500, null],
    ['Thamon', 52, 28000, null],
    ['Vakron', 44, 33800, null],
    ['Training Scarecrow', 60, 2050, 'Build B'],
  ];
  exemplo.forEach(([alvo, dur, dps, build], i) => {
    const curva = [[0, 0]];
    let tot = 0;
    for (let s = 1; s <= dur; s++) {
      tot += Math.round(dps * (0.55 + 0.9 * Math.abs(Math.sin(s * 0.7 + i))));
      curva.push([s, tot]);
    }
    const r = MD.resumo(curva);
    const habilidades = ['Murderous Burst', 'Forced Restraint', 'Leaping Slam', 'Upward Strike', 'Keen Strike'].map((nome, k) => ({
      nome,
      dano: Math.round((tot * (5 - k)) / 15),
      pct: Math.round(((5 - k) / 15) * 10000) / 100,
      acertos: 3 + k,
      critico: k % 2 ? 50 : 100,
    }));
    const l = g.adicionar({ alvo, inicio: new Date(base + i * 600e3).toISOString(), duracao: r.duracao, total: tot, dps: r.dps, picoDps: r.picoDps, curva, habilidades: i === 2 ? null : habilidades }, { personagem: 'LusitanoGlad' });
    if (build) g.mudar(l.id, { build });
  });
}

function medidorLigar(on, guardar = true) {
  if (guardar) defs.mudar({ medidor: { ...opcoesMedidor(), ligado: !!on } });
  if (!!on !== !!medidor) {
    if (on) {
      medidor = { luta: new MD.Luta(), rect: null, falhas: 0, fase: 'sem jogo', relogio: null, janela: null, anunciar: guardar };
      voltaMedidor();
    } else {
      clearTimeout(medidor.relogio);
      gravarLuta(medidor.luta.fechar());
      const janela = medidor.janela;
      medidor = null;
      if (janela && guardar) avisoMascote('Medidor de DPS desligado', janela, 3, 'cima');
    }
  }
  enviar('medidor:estado', estadoMedidor());
  return estadoMedidor();
}

// Linhas de OCR que caem dentro da janela da app (noutro monitor, ou por cima do jogo) não contam.
function foraDaApp(linhas) {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return linhas;
  const b = process.platform === 'win32' ? screen.dipToScreenRect(win, win.getBounds()) : win.getBounds();
  return linhas.filter((l) => {
    const cx = (l.x1 + l.x2) / 2;
    const cy = (l.y1 + l.y2) / 2;
    return cx < b.x || cx > b.x + b.width || cy < b.y || cy > b.y + b.height;
  });
}

async function voltaMedidor() {
  const m = medidor;
  if (!m) return;
  let espera = MEDIDOR_MS;
  const antes = estadoMedidor();
  try {
    const v = await ocr.janela('AION2');
    if (medidor !== m) return;
    if (!v.jogo) {
      // Jogo atrás ou fechado: a luta em curso acaba aqui.
      m.fase = 'sem jogo';
      gravarLuta(m.luta.ler(null).terminou);
    } else {
      m.janela = v.janela;
      if (m.anunciar) {
        m.anunciar = false;
        avisoMascote('Medidor de DPS ligado · Ctrl+Alt+D desliga', v.janela, 3, 'cima');
      }
      if (!m.rect) {
        m.fase = 'à procura';
        espera = MEDIDOR_PROCURA_MS;
        const [jx, jy, jw, jh] = v.janela;
        const linhas = foraDaApp(await ocr.lerZona(jx, jy, jw, jh));
        if (medidor !== m) return;
        m.rect = MD.acharJanela(linhas);
        m.falhas = 0;
      } else {
        m.fase = 'a ler';
        const [x, y, w, h] = m.rect;
        const leitura = MD.lerJanela(foraDaApp(await ocr.lerZona(x, y, w, h)));
        if (medidor !== m) return;
        // 3 leituras seguidas sem a janela: fechada ou mudada de sítio → procurar outra vez.
        if (!leitura && ++m.falhas >= 3) m.rect = null;
        if (leitura) m.falhas = 0;
        gravarLuta(m.luta.ler(leitura).terminou);
      }
    }
  } catch (e) {
    registarErro('medidor', e);
  }
  if (medidor !== m) return;
  const depois = estadoMedidor();
  if (JSON.stringify(antes) !== JSON.stringify(depois)) enviar('medidor:estado', depois);
  m.relogio = setTimeout(voltaMedidor, espera);
}

/** A luz do texto numa caixa: a média dos 20% de píxeis mais claros. */
function luzDoTexto(img, l) {
  const x0 = Math.max(0, Math.round(l.x1));
  const y0 = Math.max(0, Math.round(l.y1));
  const x1 = Math.min(img.largura - 1, Math.round(l.x2));
  const y1 = Math.min(img.altura - 1, Math.round(l.y2));
  const v = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) v.push(I.luz(img, x, y));
  if (!v.length) return null;
  v.sort((a, b) => b - a);
  const topo = v.slice(0, Math.max(1, Math.round(v.length * 0.2)));
  return topo.reduce((a, b) => a + b, 0) / topo.length;
}

// Ctrl+Alt+M liga a leitura da coleção e outro Ctrl+Alt+M desliga-a. Enquanto
// está ligada, a app fotografa o ecrã sem parar (cada volta ~2 s: foto + OCR do
// ecrã inteiro) e junta as mascotes que vão aparecendo — dá para percorrer a
// coleção toda no jogo. A aba vai mostrando o que já leu; no fim confirma-se lá.
let leituraColecao = null; // { colecao, ecra, janela, relogio } enquanto está ligada

function estadoColecao(fim = false) {
  const l = leituraColecao;
  // Nomes no idioma da app; "tem" só quando se viu o círculo do nível (só as obtidas o têm).
  const nomes = new Map(listaMascotes().mascotes.map((m) => [m.id, m.nome]));
  const lidas = [...l.cartas.values()].map((c) => ({
    id: c.id,
    nome: nomes.get(c.id) || c.nome,
    tem: c.nivel ? true : null,
    nivel: c.nivel || null,
    almas: c.almas || null, // { tem, precisa } para o nível seguinte
  }));
  return { lidas, leituras: l.leituras, contador: l.contador, aLer: !fim, quando: new Date().toISOString() };
}

/**
 * Os retratos oficiais das mascotes (256 px, do CDN da NC), guardados na cache da
 * app; o catálogo de assinaturas faz-se uma vez (~2 s).
 */
async function catalogoRetratosMascotes() {
  if (catRetratos) return catRetratos;
  const dir = path.join(app.getPath('userData'), 'cache', 'retratos');
  fs.mkdirSync(dir, { recursive: true });
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'dados', 'mascotes.json'), 'utf8'));
  const fila = j.mascotes.filter((m) => m.i);
  const retratos = [];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (fila.length) {
        const m = fila.pop();
        const f = path.join(dir, m.i);
        try {
          if (!fs.existsSync(f)) {
            const r = await fetch('https://assets.playnccdn.com/static-aion2-gamedata/resources/' + m.i);
            if (!r.ok) continue;
            fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
          }
          retratos.push({ id: m.id, nome: m.n['en-US'] || m.n['pt-BR'], img: I.lerPNG(fs.readFileSync(f)) });
        } catch {
          /* um retrato em falta só faz essa mascote não ser reconhecida */
        }
      }
    }),
  );
  catRetratos = CR.catalogoRetratos(retratos, I.redimensionar);
  return catRetratos;
}

/** Um retângulo [x, y, w, h] em píxeis físicos contém o centro da linha (em píxeis da imagem do ecrã)? */
function linhaDentro(linha, origem, r) {
  const cx = origem.x + (linha.x1 + linha.x2) / 2;
  const cy = origem.y + (linha.y1 + linha.y2) / 2;
  return cx >= r[0] && cx < r[0] + r[2] && cy >= r[1] && cy < r[1] + r[3];
}

async function voltaColecao() {
  const l = leituraColecao;
  if (!l) return;
  try {
    // Só o jogo. Antes fotografava o ecrã do rato: com a app noutro monitor (e o
    // rato nela, por ter carregado no botão) lia a lista de mascotes da própria app
    // e marcava-as todas. Agora: o AION2 tem de estar à frente, fotografa-se o ecrã
    // onde ele está e só conta o texto dentro da janela dele e fora da janela da app.
    const v = await ocr.ver('AION2');
    if (leituraColecao !== l) return;
    if (!v.jogo || !v.janela) {
      avisoMascote('Volta ao jogo e abre a coleção · Ctrl+Alt+M para parar', l.janela, 0, 'cima');
    } else {
      const [jx, jy, jw, jh] = v.janela;
      const dip = (p) => (process.platform === 'win32' ? screen.screenToDipPoint(p) : p);
      const fis = (p) => (process.platform === 'win32' ? screen.dipToScreenPoint(p) : p);
      const ecra = screen.getDisplayNearestPoint(dip({ x: jx + jw / 2, y: jy + jh / 2 }));
      l.ecra = ecra;
      l.janela = v.janela;
      const origem = fis({ x: ecra.bounds.x, y: ecra.bounds.y });
      let app = null;
      if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) {
        const b = process.platform === 'win32' ? screen.dipToScreenRect(win, win.getBounds()) : win.getBounds();
        app = [b.x, b.y, b.width, b.height];
      }
      // Pelos retratos (src/colecao-retratos.js): a grelha não tem nomes, só o
      // retrato, o círculo do nível (só nas obtidas) e o progresso das almas.
      const cat = await catalogoRetratosMascotes();
      const { img } = await fotografarEcra(ecra);
      if (leituraColecao !== l) return; // parou durante a leitura
      const k = jh / CR.REF_ALTURA;
      const janelaNaImagem = [jx - origem.x, jy - origem.y, jw, jh];
      l.leituras++;
      const paraAlmas = [];
      for (const c of CR.lerCartas(img, janelaNaImagem, cat)) {
        if (!c.certa) continue;
        // Uma carta tapada pela janela da app não conta.
        if (app && linhaDentro({ x1: c.x, x2: c.x + c.w, y1: c.y, y2: c.y + c.h }, origem, app)) continue;
        const nivel = CR.nivelDaCarta(img, c, k);
        const ant = l.cartas.get(c.id) || {};
        const e = { ...ant, id: c.id, nome: c.nome, nivel: Math.max(nivel || 0, ant.nivel || 0) || null };
        l.cartas.set(c.id, e);
        // As almas ("15/75") só nas de nível 1 e 2 (o 3 é o máximo); até 3 tentativas por mascote.
        if (nivel && nivel < 3 && !e.almas && (e.tentativasAlmas || 0) < 3) paraAlmas.push({ e, tira: CR.tiraAlmas(img, c, k) });
      }
      if (paraAlmas.length) {
        // Um só OCR para todas as cartas novas deste ecrã (src/colecao-retratos.js explica a limpeza).
        const { img: tiras, passo } = CR.montarTiras(paraAlmas.map((p) => p.tira));
        const textos = CR.textoPorTira(await ocr.ler(gravarTemp(I.escreverPNG(tiras), 'almas.png')), passo, paraAlmas.length);
        paraAlmas.forEach((p, i) => {
          p.e.tentativasAlmas = (p.e.tentativasAlmas || 0) + 1;
          const a = CR.lerAlmas(textos[i], p.e.nivel, p.tira.glifos);
          if (a) p.e.almas = a;
        });
      }
      // O contador do jogo ("Collection Status 85/200", por baixo da grelha): OCR pequeno, de vez em quando.
      if (l.leituras % 5 === 1) {
        try {
          const linhas = await ocr.lerZona(jx + 280 * k, jy + 1335 * k, 420 * k, 60 * k);
          l.contador = OM.contadorColecao(linhas) || l.contador;
        } catch {
          /* sem contador segue na mesma */
        }
      }
      enviar('mascotes:colecao', estadoColecao());
      const obtidas = [...l.cartas.values()].filter((c) => c.nivel).length;
      const c = l.contador;
      avisoMascote(
        `A ler a coleção… ${obtidas} obtida(s) vista(s)${c ? ` · o jogo diz ${c.tem}/${c.total}` : ''} · faz scroll até ao fim · Ctrl+Alt+M para parar`,
        l.janela,
        0,
        'cima',
      );
    }
  } catch (e) {
    registarErro(ATALHO_MASCOTES, e);
  }
  if (leituraColecao === l) l.relogio = setTimeout(voltaColecao, 300);
}

/** Liga ou desliga a leitura contínua da coleção. Devolve se ficou a ler. */
function lerColecaoMascotes() {
  if (leituraColecao) {
    const l = leituraColecao;
    clearTimeout(l.relogio);
    const r = estadoColecao(true);
    leituraColecao = null;
    enviar('mascotes:colecao', r);
    avisoMascote(
      r.lidas.length ? `Parei: li ${r.lidas.length} mascote(s) — confirma na aba Mascotes` : 'Parei: não vi nomes de mascotes no ecrã',
      l.janela,
      6,
      'cima',
    );
    return false;
  }
  const ecra = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const k = ecra.scaleFactor;
  const janela = [ecra.bounds.x * k, ecra.bounds.y * k, ecra.size.width * k, ecra.size.height * k];
  leituraColecao = { cartas: new Map(), leituras: 0, contador: null, ecra, janela, relogio: null };
  enviar('mascotes:colecao', estadoColecao());
  avisoMascote('A ler a coleção… percorre-a no jogo · Ctrl+Alt+M para parar', janela, 0, 'cima');
  voltaColecao();
  return true;
}

let aLer = false;
/** Lê os cartões do ecrã do rato. Devolve [{ nome, preco, motivo }] (vazio se não viu nenhum), { erro } se falhou, ou null se já estava a ler. */
async function lerCartoes() {
  if (aLer) return null;
  aLer = true;
  try {
    const ecra = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    esconderFaixas();
    await new Promise((r) => setTimeout(r, 60)); // a faixa anterior não pode sair na foto
    const t0 = Date.now();
    const { img, png } = await fotografarEcra(ecra);
    const linhas = await ocr.ler(gravarTemp(png, 'cartao.png'));
    const faixas = await faixasDoEcra(img, linhas);
    ultimoCartaoManual = { png, linhas, faixas, quando: new Date().toISOString() };
    ultimosCartoes = faixas.map((f) => f.nome);
    enviar('cartoes:lidos', { faixas: faixas.map(({ nome, preco, motivo }) => ({ nome, preco, motivo })), ms: Date.now() - t0 });
    if (faixas.length) mostrarFaixas(ecra, faixas);
    return faixas.map(({ nome, preco, motivo }) => ({ nome, preco: preco && preco.valor, motivo }));
  } catch (e) {
    registarErro('Ctrl+Alt+P', e);
    enviar('cartoes:lidos', { erro: e.message });
    return { erro: e.message };
  } finally {
    aLer = false;
  }
}

function abrirNota() {
  if (!win) return false;
  esconderFaixas();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  enviar('notas:editar', { nomes: ultimosCartoes });
  return ultimosCartoes.length > 0;
}

// ── controlo local: o Freedeck do tablet pede "lê o item" e "abre a nota" ──
//
// Com o AION2 à frente, as teclas simuladas (SendInput) não chegam: o jogo (ou o
// anti-cheat) come-as, e o Ctrl+Alt+P do tablet nunca disparava. Por isso o
// tablet fala com a app diretamente, só neste PC (127.0.0.1). O cabeçalho
// X-Aion-Helper obriga um browser a fazer "preflight", que aqui não se responde:
// um site aberto no browser não consegue carregar nos botões.
const PORTA_CONTROLO = 47321;
function arrancarControlo() {
  const servidor = require('http').createServer(async (req, res) => {
    const responder = (codigo, corpo) => {
      res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(corpo));
    };
    if (req.method !== 'POST' || req.headers['x-aion-helper'] !== '1') return responder(403, { erro: 'proibido' });
    try {
      if (req.url === '/cartao') {
        const lidos = await lerCartoes();
        if (lidos && lidos.erro) return responder(500, lidos);
        return responder(200, lidos == null ? { ocupado: true } : { lidos });
      }
      if (req.url === '/nota') return responder(200, { nota: abrirNota() });
      if (req.url === '/recolha') return responder(200, recolhaLigar(!recolha));
      if (req.url === '/cubos') return responder(200, cubosLigar(!cubos));
      if (req.url === '/medidor') return responder(200, medidorLigar(!medidor));
      if (req.url === '/estado') return responder(200, { ok: true, versao: app.getVersion() });
      responder(404, { erro: 'desconhecido' });
    } catch (e) {
      responder(500, { erro: e.message });
    }
  });
  // Porta ocupada (outra cópia da app aberta): o tablet fala com essa.
  servidor.on('error', (e) => registarErro('controlo local', e));
  servidor.listen(PORTA_CONTROLO, '127.0.0.1');
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
  if (!globalShortcut.register(ATALHO_MASCOTES, lerColecaoMascotes)) falhas.push(ATALHO_MASCOTES);
  if (!globalShortcut.register(ATALHO_RECOLHA, () => recolhaLigar(!recolha))) falhas.push(ATALHO_RECOLHA);
  if (!globalShortcut.register(ATALHO_CUBOS, () => cubosLigar(!cubos))) falhas.push(ATALHO_CUBOS);
  if (!globalShortcut.register(ATALHO_MEDIDOR, () => medidorLigar(!medidor))) falhas.push(ATALHO_MEDIDOR);
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

  // A chave do Gemini nunca sai do processo principal: o renderer só sabe se existe.
  ipcMain.handle('defs:todas', () => {
    const t = defs.todas();
    const g = t.gemini || {};
    return { ...t, gemini: { temChave: !!g.chave, modelo: g.modelo || null } };
  });
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
    if (vigiaMascotes) vigiaMascotes.desligar();
    catMascotes = null; // os nomes das mascotes mudam com o idioma
    ocr.parar();
    ocr = new OCR(idioma);
    if (vigia) vigia.ocr = ocr;
    await ocr.arrancar().catch(() => {});
    if (ligada) vigia.ligar();
    if (vigiaMascotes) {
      vigiaMascotes.ocr = ocr;
      vigiaMascotesLigar();
    }
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
  ipcMain.handle('atalhos:estado', () => ({ cartao: ATALHO_CARTAO, nota: ATALHO_NOTA, mascotes: ATALHO_MASCOTES, recolha: ATALHO_RECOLHA, cubos: ATALHO_CUBOS, medidor: ATALHO_MEDIDOR, falhas: atalhosFalhados }));
  ipcMain.handle('medidor:estado', () => estadoMedidor());
  ipcMain.handle('medidor:ligar', (_e, on) => medidorLigar(!!on));
  ipcMain.handle('lutas:todas', () => lutas.todas());
  ipcMain.handle('lutas:mudar', (_e, id, alt) => lutas.mudar(id, alt || {}));
  ipcMain.handle('lutas:apagar', (_e, id) => lutas.apagar(id));
  ipcMain.handle('cubos:estado', () => estadoCubos());
  ipcMain.handle('cubos:ligar', (_e, on) => cubosLigar(!!on));
  ipcMain.handle('cubos:mudar', (_e, alt) => {
    defs.mudar({ cubos: { ...opcoesCubos(), ...(alt || {}) } });
    return estadoCubos();
  });
  ipcMain.handle('recolha:estado', () => estadoRecolha());
  ipcMain.handle('recolha:ligar', (_e, on) => recolhaLigar(!!on));
  ipcMain.handle('recolha:mudar', (_e, alt) => {
    defs.mudar({ recolha: { ...opcoesRecolha(), ...(alt || {}) } });
    return estadoRecolha();
  });
  ipcMain.handle('mascotes:noJogo', (_e, alt) => {
    if (alt) defs.mudar({ mascotesNoJogo: { ...opcoesMascotes(), ...alt } });
    vigiaMascotesLigar();
    return opcoesMascotes();
  });
  ipcMain.handle('mascotes:lerColecao', () => lerColecaoMascotes());
  ipcMain.handle('defs:mudar', (_e, alt) => {
    // A chave do Gemini só muda por assist:chave (o renderer nunca a tem para a devolver).
    const { gemini, ...resto } = alt || {};
    const t = defs.mudar(resto);
    return { ...t, gemini: { temChave: !!(t.gemini && t.gemini.chave), modelo: (t.gemini && t.gemini.modelo) || null } };
  });

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
  // A última leitura boa de cada secção fica guardada (sem prazo): a NC às vezes não manda o equipamento.
  const memoriaFichas = { ler: (k) => cache.ler(k), gravar: (k, d) => cache.gravar(k, d) };
  ipcMain.handle('pers:ficha', (_e, r) => personagem.ficha(refDe(r), { ...opcoesNC(r.regiao), memoria: memoriaFichas }));
  ipcMain.handle('pers:item', (_e, { ref, item }) => personagem.itemEquipado(refDe(ref), item, opcoesNC(ref.regiao)));
  ipcMain.handle('pers:tabuleiro', (_e, { ref, id }) => personagem.tabuleiro(refDe(ref), Number(id), opcoesNC(ref.regiao)));
  ipcMain.handle('dv:tabuleiros', async (_e, nomeClasse) => {
    const { dados: lista } = await classesNC();
    const classe = lista.find((c) => c.nome === nomeClasse);
    if (!classe) throw new Error('classe desconhecida: ' + nomeClasse);
    return comCache(`tabuleiros-${nomeClasse}-${idiomaNC()}`, HABILIDADES_MS, () => personagem.tabuleirosDaClasse(classe, { idioma: idiomaNC() }));
  });
  ipcMain.handle('itens:indice', () => indiceItens());
  ipcMain.handle('mascotes:lista', () => listaMascotes());
  ipcMain.handle('itens:ficha', (_e, { id, encantamento }) => {
    const n = Number(id);
    const enc = Math.max(0, Math.min(30, Number(encantamento) || 0));
    return comCache(`item-${n}-${enc}-${idiomaNC()}`, 30 * 24 * 3600e3, async () => {
      const f = await personagem.item(n, { idioma: idiomaNC(), encantamento: enc });
      if (!f) throw new Error('A NC não conhece esse item');
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

  // ── Assistente (Gemini) ────────────────────────────────────────────────────
  // O Gemini não responde de memória: chama estas ferramentas, que leem os dados
  // da app (src/assistente.js explica porquê). Tudo o que devolvem é curto — a
  // quota gratuita conta por tamanho.
  let resumoMochila = null; // o que a aba Mochila mostrou da última vez (o renderer manda)
  let modeloAssistente = null;

  const quando = (ms) =>
    new Date(ms).toLocaleString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  async function servidorAtual() {
    const lista = (await comCache('servidores', SERVIDORES_MS, sources.servidores)).dados;
    const id = defs.todas().servidor || lista.omissao;
    const s = (lista.servidores || []).find((x) => x.id === id);
    return { id, nome: s ? s.nome : String(id) };
  }

  async function classePor(texto) {
    const { dados: lista } = await classesNC();
    const t = A.normal(texto);
    const c = lista.find((x) => A.normal(x.nome) === t || A.normal(x.texto) === t);
    if (!c) throw new Error(`classe desconhecida "${texto}". Classes: ${lista.map((x) => x.texto).join(', ')}`);
    return c;
  }

  function descreverLinha(l) {
    const p = P.precoDaLinha(l);
    return {
      preco_unidade: p.valor,
      base: p.base === 'vendido' ? 'média das vendas' : p.base === 'pedido' ? 'anúncio mais barato' : null,
      liquido_unidade: p.valor != null ? P.liquido(p.valor) : null,
      anuncio_mais_barato: l.price || null,
      unidades_vendidas: l.units_sold || null,
      avisos: P.avisos(l),
    };
  }

  /** As missões do canto direito do ecrã do jogo (foto como a da mochila, OCR local). */
  async function lerMissoesNoEcra() {
    const imagens = await fotografarEcras();
    if (!imagens.length) throw new Error('Não consegui fotografar o ecrã.');
    const { img } = imagens.reduce((a, b) => (b.img.largura * b.img.altura > a.img.largura * a.img.altura ? b : a));
    const x = Math.round(img.largura * 0.66);
    const y = Math.round(img.altura * 0.04);
    const recorte = I.recortar(img, x, y, img.largura - x, Math.round(img.altura * 0.91));
    return M.organizarMissoes(await ocr.ler(gravarTemp(I.escreverPNG(recorte), 'missoes.png')));
  }

  const ferramentas = {
    missoes_no_ecra: {
      descricao: 'Lê as missões que o jogador tem no seguidor de missões (canto direito do ecrã do jogo): título, nível e os passos/objetivos.',
      correr: async () => {
        const r = await lerMissoesNoEcra();
        if (r.linhas.length < 2)
          return { erro: 'Não vi missões no canto direito do ecrã. O jogo tem de estar visível (não minimizado) com o seguidor de missões aberto.' };
        return { missoes: M.textoMissoes(r) };
      },
    },
    pesquisar_web: {
      descricao: 'Pesquisa no Google sobre o Aion 2 (missões, NPCs, onde caem itens, como se faz algo). Devolve um resumo e as fontes. Usa para dicas de missões e quando os dados da app não chegam.',
      parametros: { type: 'object', properties: { pergunta: { type: 'string', description: 'O que procurar, com os nomes como estão no jogo' } }, required: ['pergunta'] },
      correr: async ({ pergunta }) => {
        const g = defs.todas().gemini || {};
        return A.pesquisarWeb({ chave: g.chave, modelo: modeloAssistente || g.modelo, pergunta: String(pergunta || '').slice(0, 500) });
      },
    },
    procurar_item: {
      descricao: 'Procura itens do Aion 2 Global pelo nome (português ou inglês). Devolve id, nome, grau, categoria e nível. Usa antes de preco_item.',
      parametros: { type: 'object', properties: { texto: { type: 'string', description: 'Parte do nome do item' } }, required: ['texto'] },
      correr: async ({ texto }) => {
        const achados = A.procurarItens(indiceItens().itens, texto);
        if (!achados.length) return { nada: `Nenhum item com "${texto}" no catálogo da app.` };
        return achados.map((x) => ({
          id: x.id,
          nome: x.nome,
          outro_idioma: x.outro,
          grau: x.grauNome,
          categoria: [x.c1, x.c2, x.cat].filter(Boolean).join(' / ') || null,
          nivel: x.nivel || null,
          classes: x.classes || null,
        }));
      },
    },
    preco_item: {
      descricao: 'Preço de mercado de um item (por id) no servidor do jogador; se lá não houver anúncios, no servidor de reserva. Inclui quanto a loja paga, se a app já viu o cartão do item.',
      parametros: { type: 'object', properties: { id: { type: 'number', description: 'id do item (de procurar_item)' } }, required: ['id'] },
      correr: async ({ id }) => {
        id = Number(id);
        const s = await servidorAtual();
        const out = { servidor: s.nome };
        const linhas = (await comCache('itens-' + s.id, PRECOS_FRESCOS_MS, () => sources.itensDoServidor(s.id))).dados;
        const aqui = linhas.find((x) => x.id === id && x.price);
        if (aqui) out.mercado = descreverLinha(aqui);
        else {
          for (const r of await referencias()) {
            const l = r.linhas.find((x) => x.id === id && x.price);
            if (l) {
              out.mercado_reserva = { servidor: r.nomeServidor, ...descreverLinha(l) };
              break;
            }
          }
        }
        if (!out.mercado && !out.mercado_reserva) out.mercado = 'sem anúncios conhecidos (o aion2.exchange só segue ~500 itens)';
        const ficha = nomes.todosConhecidos()[id] || indiceItens().itens.find((x) => x.id === id);
        const lojaUn = ficha ? loja.de(ficha.nome) : null;
        out.loja_paga_unidade = lojaUn != null ? lojaUn : 'desconhecido (a app ainda não viu o cartão no jogo)';
        return out;
      },
    },
    mochila: {
      descricao: 'A última leitura da mochila do jogador: itens, quantidades, preço de mercado, quanto a loja paga, e o total.',
      correr: async () =>
        resumoMochila || { erro: 'O jogador ainda não leu a mochila nesta sessão (aba Mochila → Ler, com o Cubo aberto no jogo).' },
    },
    horarios: {
      descricao: 'Próximos eventos (Shugo, Invasão, Fenda, Cerco, chefes, resets, manutenção) e o estado das cargas (Odyle, Conquista, Transcendência, santuários…). Horas já na hora local do jogador.',
      correr: async () => {
        const c = { regiao: 'eu', acertoEventos: 0, acertoReset: 0, cargas: {}, acertos: {}, ...(defs.todas().temporizadores || {}) };
        const r = T.regiao(c.regiao);
        const agora = Date.now();
        return {
          agora: quando(agora),
          regiao: r.nome,
          eventos: T.EVENTOS.map((e) => {
            const v = T.proximas(e, agora, r.tz, 2, e.utc ? c.acertoReset : c.acertoEventos);
            return {
              nome: e.nome,
              tipo: T.CATEGORIAS[e.cat],
              certeza: e.certeza,
              a_decorrer: !!(v[0] && v[0].inicio <= agora),
              proximas: v.map((x) => quando(x.inicio)),
              falta: v[0] ? T.falta(Math.max(0, v[0].inicio - agora)) : null,
              nota: e.nota,
            };
          }),
          cargas: T.CARGAS.map((k) => {
            const st = T.estadoCarga(k, c.cargas[k.id], agora, { ...c.acertos, reset: c.acertoReset });
            return {
              nome: k.nome,
              valor: st.valor == null ? 'o jogador não escreveu quanto tem' : `${st.valor}/${k.max}`,
              proxima_carga: `+${k.mais} ${quando(st.proxima)}`,
              cheio: st.cheio === true ? 'já está cheio' : st.cheio ? quando(st.cheio) : null,
            };
          }),
        };
      },
    },
    classes: {
      descricao: 'As classes do Aion 2 (nome interno e nome em português).',
      correr: async () => (await classesNC()).dados.map((c) => ({ nome: c.nome, portugues: c.texto })),
    },
    habilidades_classe: {
      descricao: 'As habilidades de uma classe: nome, categoria (Active, Dp = estigma, Passive) e nível necessário. Sem descrições (a NC não as dá).',
      parametros: { type: 'object', properties: { classe: { type: 'string', description: 'Nome da classe (ex.: Gladiador ou Gladiator)' } }, required: ['classe'] },
      correr: async ({ classe }) => {
        const c = await classePor(classe);
        const lista = (await comCache(`habilidades-${c.nome}-${idiomaNC()}`, HABILIDADES_MS, () => habilidades.habilidadesDaClasse(c, { idioma: idiomaNC() }))).dados;
        return {
          classe: c.texto,
          habilidades: lista.map((h) => ({ nome: h.nome, categoria: h.categoria === 'Dp' ? 'Estigma' : h.categoria, nivel: h.nivelNecessario })),
        };
      },
    },
    daevanion_classe: {
      descricao: 'Os tabuleiros Daevanion de uma classe: para cada um, o cristal que gasta, o custo para abrir tudo, as habilidades que sobe e a soma dos atributos que dá.',
      parametros: { type: 'object', properties: { classe: { type: 'string' } }, required: ['classe'] },
      correr: async ({ classe }) => {
        const c = await classePor(classe);
        const tabs = (await comCache(`tabuleiros-${c.nome}-${idiomaNC()}`, HABILIDADES_MS, () => personagem.tabuleirosDaClasse(c, { idioma: idiomaNC() }))).dados;
        return tabs.map((t) => {
          const todos = t.nos.map((n) => n.id);
          const efeitos = D.somarEfeitos(t.nos, todos);
          const g = D.gastoTabuleiro(t, []);
          return {
            tabuleiro: t.nome,
            cristal: g.cristal,
            custo_total: g.total,
            nos: t.nos.length,
            sobe_habilidades: efeitos.filter((e) => e.habilidade).map((e) => `${e.nome} +${e.valor}`),
            atributos: efeitos.filter((e) => !e.habilidade).map((e) => (e.valor == null ? e.nome : `${e.nome} +${e.valor}${e.unidade}`)),
          };
        });
      },
    },
    builds_guardadas: {
      descricao: 'As builds que o jogador guardou na app: classe, barra de habilidades, níveis, prioridades e notas.',
      correr: async () => {
        const lista = builds.todas();
        if (!lista.length) return { nada: 'O jogador não tem builds guardadas.' };
        const out = [];
        for (const b of lista.slice(0, 10)) {
          let nomeDe = (id) => String(id);
          let classeTexto = b.classe;
          try {
            const c = await classePor(b.classe);
            classeTexto = c.texto;
            const hs = (await comCache(`habilidades-${c.nome}-${idiomaNC()}`, HABILIDADES_MS, () => habilidades.habilidadesDaClasse(c, { idioma: idiomaNC() }))).dados;
            const m = new Map(hs.map((h) => [h.id, h.nome]));
            nomeDe = (id) => m.get(Number(id)) || String(id);
          } catch {
            /* sem nomes, ficam os ids */
          }
          out.push({
            nome: b.nome,
            classe: classeTexto,
            etiqueta: b.etiqueta || null,
            barra: (b.barra || []).filter(Boolean).map(nomeDe),
            niveis: Object.entries(b.niveis || {}).map(([id, n]) => `${nomeDe(id)} nível ${n.nivel}${n.espec ? ` (${n.espec} espec.)` : ''}`),
            prioridade: Object.fromEntries(Object.entries(b.prioridade || {}).map(([k, v]) => [k, (v || []).map(nomeDe)])),
            notas: b.notas || null,
          });
        }
        return out;
      },
    },
  };

  async function contextoAssistente() {
    const t = defs.todas();
    let s = '?';
    try {
      s = (await servidorAtual()).nome;
    } catch {
      /* sem rede: segue sem nome */
    }
    return [`Servidor escolhido na app: ${s}.`, `Idioma do cliente do jogo: ${t.idioma}.`, `Agora: ${quando(Date.now())} (hora do PC).`].join('\n');
  }

  ipcMain.handle('assist:mochila', (_e, r) => {
    resumoMochila = r && typeof r === 'object' ? { ...r, lida: quando(Date.now()) } : null;
  });
  ipcMain.handle('assist:chave', async (_e, chave) => {
    chave = String(chave || '').trim();
    if (!chave) {
      defs.mudar({ gemini: null });
      modeloAssistente = null;
      return { temChave: false, modelo: null };
    }
    // Testa antes de guardar: a lista de modelos falha logo com uma chave errada.
    const modelo = await A.escolherModelo(chave);
    defs.mudar({ gemini: { chave, modelo } });
    modeloAssistente = modelo;
    return { temChave: true, modelo };
  });
  async function perguntarAoGemini(historico, pergunta, imagens = []) {
    const g = defs.todas().gemini || {};
    if (!g.chave) throw new Error('Falta a chave do Gemini (Definições → Assistente).');
    if (!modeloAssistente) modeloAssistente = g.modelo || (await A.escolherModelo(g.chave).catch(() => A.MODELO_RESERVA));
    const contexto = await contextoAssistente();
    const pedir = () =>
      A.conversar({
        chave: g.chave,
        modelo: modeloAssistente,
        historico: Array.isArray(historico) ? historico : [],
        pergunta: String(pergunta || '').slice(0, 4000),
        imagens,
        ferramentas,
        contexto,
        aoUsar: (nome) => enviar('assist:usar', nome),
      });
    try {
      return await pedir();
    } catch (e) {
      // O modelo guardado deixou de existir (a Google retira modelos): escolher outro e tentar uma vez.
      if (e.status !== 404) throw e;
      modeloAssistente = await A.escolherModelo(g.chave);
      defs.mudar({ gemini: { ...g, modelo: modeloAssistente } });
      return pedir();
    }
  }
  ipcMain.handle('assist:perguntar', (_e, { historico, pergunta, imagens }) => perguntarAoGemini(historico, pergunta, imagens));

  // ── dicas automáticas das missões ──────────────────────────────────────────
  // Com o jogo à frente, lê o seguidor de missões de 20 em 20 s (só OCR local) e
  // só chama o Gemini quando aparece uma missão ou um passo novo — as contagens
  // (0/4 → 1/4) não contam. No máximo uma dica a cada 2 min, para poupar a quota.
  let autoMissoes = null; // { linhas } da última dica
  let autoUltimo = 0;
  let autoOcupado = false;
  setInterval(async () => {
    const t = defs.todas();
    if (!t.dicasMissoes || !(t.gemini && t.gemini.chave) || autoOcupado || !ocr) return;
    autoOcupado = true;
    try {
      const v = await ocr.ver('AION2');
      if (!v.jogo || !v.janela) return;
      const [x, y, w, h] = v.janela;
      const r = M.organizarMissoes(await ocr.lerZona(x + w * 0.66, y + h * 0.04, w * 0.34, h * 0.91));
      if (r.linhas.length < 2) return;
      // A 1.ª linha é o nome da zona: mudar de zona sem missão nova não pede dica.
      const novas = M.linhasNovas(r, autoMissoes).filter((t) => t !== r.linhas[0]);
      if (!novas.length || Date.now() - autoUltimo < 120e3) return;
      autoMissoes = r;
      autoUltimo = Date.now();
      const resposta = await perguntarAoGemini(
        [],
        'As linhas marcadas [NOVO] acabaram de aparecer no meu seguidor de missões. Para cada missão nova ou que mudou, dá uma dica curta ' +
          '(2 a 4 linhas): o que fazer agora e, se a pesquisa na web souber, onde. Não repitas o texto da missão.\n\n' +
          M.textoMissoes(r, novas),
      );
      enviar('assist:dica', { ...resposta, missoes: novas.slice(0, 2) });
    } catch (e) {
      registarErro('dicas das missões', e);
    } finally {
      autoOcupado = false;
    }
  }, 20e3);
}

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  cache = new Cache(path.join(dir, 'cache'));
  // No modo de teste as definições são uma cópia temporária: os testes das abas
  // Temporizadores e Mascotes escrevem nelas e não podem mexer nas verdadeiras.
  if (process.env.AION_CAPTURA) {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aion-defs-'));
    try {
      fs.copyFileSync(path.join(dir, 'definicoes.json'), path.join(tmp, 'definicoes.json'));
    } catch {
      // Sem definições ainda: o teste começa das de omissão.
    }
    defs = new Definicoes(tmp);
  } else defs = new Definicoes(dir);
  notas = new Notas(dir);
  nomes = new Nomes(cache, defs.todas().idioma || sources.IDIOMA);
  loja = new Loja(dir);
  alertas = new Alertas(dir);
  // No modo de teste as builds vão para uma pasta temporária, para não tocar nas verdadeiras.
  // No modo de teste as lutas vão para uma pasta temporária, com umas de exemplo.
  lutas = new Lutas(path.join(process.env.AION_CAPTURA ? fs.mkdtempSync(path.join(require('os').tmpdir(), 'aion-lutas-')) : dir, 'lutas.json'));
  if (process.env.AION_CAPTURA) lutasDeExemplo(lutas);
  builds = new B.Builds(process.env.AION_CAPTURA ? fs.mkdtempSync(path.join(require('os').tmpdir(), 'aion-builds-')) : dir);
  ocr = new OCR(defs.todas().idioma || sources.IDIOMA);
  // Arranca já: acordar o motor custa ~0,5 s, e o primeiro Ctrl+Alt+P não deve pagá-lo.
  ocr.arrancar().catch(() => {});
  registarIPC();
  atalhosFalhados = registarAtalhos();
  if (!process.env.AION_CAPTURA) arrancarControlo();
  criarJanela();
  // Modo automático: ligado por omissão. Não gasta nada com o jogo fechado ou atrás.
  if (defs.todas().automatico !== false && !process.env.AION_CAPTURA) vigiaLigar(true);
  if (!process.env.AION_CAPTURA) vigiaMascotesLigar();
  if (!process.env.AION_CAPTURA && opcoesCubos().ligado) cubosLigar(true, false);
  if (!process.env.AION_CAPTURA && opcoesMedidor().ligado) medidorLigar(true, false);
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
  if (vigiaMascotes) vigiaMascotes.desligar();
  if (recolha) clearTimeout(recolha.relogio);
  if (cubos) clearTimeout(cubos.relogio);
  // Luta a meio quando a app fecha: grava-se com o que havia.
  if (medidor) {
    clearTimeout(medidor.relogio);
    gravarLuta(medidor.luta.fechar());
  }
  if (ocr) ocr.parar();
});

app.on('window-all-closed', () => app.quit());
