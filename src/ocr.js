'use strict';

// O processo de OCR (src/ocr.ps1) visto do Node: arranca uma vez, recebe
// pedidos em fila e mata-se com a árvore toda ao sair (no Windows o kill() do
// Node só mata o pai — lição do SC Helper com o Ollama).

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

class OCR {
  /** @param idioma etiqueta do idioma do jogo (en-US…); o OCR usa-o se o Windows o tiver. */
  constructor(idioma = '', script = path.join(__dirname, 'ocr.ps1')) {
    this.idioma = idioma;
    this.idiomaOCR = null; // o que o Windows deu de facto
    // Dentro do asar o PowerShell não consegue ler o script: usa-se a cópia desempacotada.
    this.script = script.replace('app.asar', 'app.asar.unpacked');
    this.proc = null;
    this.pronto = null;
    this.fila = [];
    this.buffer = '';
  }

  arrancar() {
    if (this.pronto) return this.pronto;
    this.pronto = new Promise((resolve, reject) => {
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.script];
      if (this.idioma) args.push('-Idioma', this.idioma);
      const p = spawn('powershell.exe', args, {
        windowsHide: true,
      });
      this.proc = p;
      p.stdout.setEncoding('utf8');
      let arrancou = false;
      p.stdout.on('data', (d) => {
        this.buffer += d;
        let i;
        while ((i = this.buffer.indexOf('\n')) >= 0) {
          const linha = this.buffer.slice(0, i).replace(/\r$/, '');
          this.buffer = this.buffer.slice(i + 1);
          if (!arrancou) {
            arrancou = true;
            if (linha.startsWith('OK')) {
              this.idiomaOCR = linha.split(' ')[2] || null;
              resolve();
            }
            else reject(new Error(linha.replace(/^ERR /, '')));
            continue;
          }
          const pedido = this.fila.shift();
          if (!pedido) continue;
          if (linha.startsWith('OK ')) {
            try {
              pedido.resolve(JSON.parse(linha.slice(3)));
            } catch (e) {
              pedido.reject(new Error('resposta do OCR ilegível: ' + linha.slice(0, 120)));
            }
          } else pedido.reject(new Error(linha.replace(/^ERR /, '')));
        }
      });
      p.on('exit', (code) => {
        const erro = new Error(`o OCR fechou (código ${code})`);
        if (!arrancou) reject(erro);
        for (const q of this.fila.splice(0)) q.reject(erro);
        this.proc = null;
        this.pronto = null;
      });
      p.on('error', (e) => {
        if (!arrancou) reject(e);
      });
    });
    return this.pronto;
  }

  async pedir(ordem) {
    await this.arrancar();
    return new Promise((resolve, reject) => {
      this.fila.push({ resolve, reject });
      this.proc.stdin.write(ordem + '\n');
    });
  }

  /** Linhas de texto de um PNG: [{ x1, y1, x2, y2, t }], em píxeis da imagem. */
  ler(caminhoPNG) {
    return this.pedir('OCR ' + caminhoPNG);
  }

  /**
   * Se o jogo está à frente, onde está a janela e que rodapés de cartão se veem:
   * { jogo: false } | { jogo: true, janela: [x,y,w,h], rodapes: [{ esquerda, direita, topo, fundo }] }.
   * Tudo em coordenadas do ecrã.
   */
  ver(processo = 'AION2') {
    return this.pedir('VER ' + processo);
  }

  /** OCR de uma zona do ecrã; as caixas vêm em coordenadas do ecrã. */
  lerZona(x, y, w, h) {
    return this.pedir(`LER ${Math.round(x)} ${Math.round(y)} ${Math.round(w)} ${Math.round(h)}`);
  }

  /** Só a janela do jogo, se estiver à frente: { jogo, janela } (mais leve que ver()). */
  janela(processo = 'AION2') {
    return this.pedir('JANELA ' + processo);
  }

  /** Píxeis de uma zona do ecrã, no formato de src/imagem.js. */
  async pixeis(x, y, w, h) {
    [x, y, w, h] = [x, y, w, h].map(Math.round);
    const b64 = await this.pedir(`PIX ${x} ${y} ${w} ${h}`);
    return require('./imagem').deBGRA(Buffer.from(b64, 'base64'), w, h);
  }

  /** OCR só do texto verde-água de uma zona (o rótulo "Hidden Cube"); caixas em coordenadas do ecrã. */
  lerRotulos(x, y, w, h) {
    return this.pedir(`ROTULOS ${Math.round(x)} ${Math.round(y)} ${Math.round(w)} ${Math.round(h)}`);
  }

  /** Píxeis de uma zona reduzida f vezes (píxel sim, píxel não): imagem de w/f × h/f. */
  async pixeisReduzidos(x, y, w, h, f) {
    [x, y, w, h] = [x, y, w, h].map(Math.round);
    const b64 = await this.pedir(`PIXR ${x} ${y} ${w} ${h} ${f}`);
    return require('./imagem').deBGRA(Buffer.from(b64, 'base64'), Math.floor(w / f), Math.floor(h / f));
  }

  parar() {
    if (!this.proc) return;
    const pid = this.proc.pid;
    try {
      this.proc.stdin.write('SAIR\n');
    } catch {
      /* já fechado */
    }
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
    this.proc = null;
    this.pronto = null;
  }
}

let contador = 0;
let anterior = null;

/**
 * Grava a imagem num PNG temporário para o OCR ler — um nome novo de cada vez,
 * e apaga o anterior. Reescrever sempre o mesmo ficheiro falhava quando o OCR
 * ainda o tinha aberto (visto: o 2.º Ctrl+Alt+P dava "UNKNOWN: unknown error").
 */
function gravarTemp(png, nome = 'aion-ocr.png') {
  if (anterior) fs.rm(anterior, { force: true }, () => {});
  const f = path.join(require('os').tmpdir(), `aion-${process.pid}-${++contador}-${nome}`);
  fs.writeFileSync(f, png);
  anterior = f;
  return f;
}

module.exports = { OCR, gravarTemp };
