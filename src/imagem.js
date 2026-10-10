'use strict';

// Imagens em bruto, sem módulos nativos: um descodificador de PNG mínimo (o que
// a Ferramenta de Recorte, o PrtSc e o Electron produzem) e operações simples
// sobre píxeis RGBA. Fica testável em Node puro, fora do Electron.
//
// Formato interno: { largura, altura, px: Uint8Array RGBA, linha a linha }.

const zlib = require('zlib');

function lerPNG(buf) {
  const ASSINATURA = '89504e470d0a1a0a';
  if (buf.toString('hex', 0, 8) !== ASSINATURA) throw new Error('não é um PNG');
  let pos = 8;
  let largura, altura, profundidade, tipoCor, entrelacado;
  let paleta = null;
  let transp = null;
  const dados = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tipo = buf.toString('ascii', pos + 4, pos + 8);
    const corpo = buf.subarray(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') {
      largura = corpo.readUInt32BE(0);
      altura = corpo.readUInt32BE(4);
      profundidade = corpo[8];
      tipoCor = corpo[9];
      entrelacado = corpo[12];
    } else if (tipo === 'PLTE') paleta = corpo;
    else if (tipo === 'tRNS') transp = corpo;
    else if (tipo === 'IDAT') dados.push(corpo);
    else if (tipo === 'IEND') break;
    pos += 12 + len;
  }
  if (profundidade !== 8) throw new Error(`PNG com ${profundidade} bits por canal não suportado`);
  if (entrelacado) throw new Error('PNG entrelaçado não suportado');
  const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[tipoCor];
  if (!canais) throw new Error(`tipo de cor ${tipoCor} não suportado`);

  const bruto = zlib.inflateSync(Buffer.concat(dados));
  const bpl = largura * canais;
  const linhas = Buffer.alloc(altura * bpl);
  let anterior = Buffer.alloc(bpl);
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (bpl + 1)];
    const lin = bruto.subarray(y * (bpl + 1) + 1, (y + 1) * (bpl + 1));
    const out = linhas.subarray(y * bpl, (y + 1) * bpl);
    for (let i = 0; i < bpl; i++) {
      const a = i >= canais ? out[i - canais] : 0;
      const b = anterior[i];
      const c = i >= canais ? anterior[i - canais] : 0;
      let v = lin[i];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 255;
    }
    anterior = out;
  }

  const px = new Uint8Array(largura * altura * 4);
  for (let i = 0, j = 0; i < largura * altura; i++, j += canais) {
    let r, g, b, a = 255;
    if (tipoCor === 6) [r, g, b, a] = [linhas[j], linhas[j + 1], linhas[j + 2], linhas[j + 3]];
    else if (tipoCor === 2) [r, g, b] = [linhas[j], linhas[j + 1], linhas[j + 2]];
    else if (tipoCor === 0) r = g = b = linhas[j];
    else if (tipoCor === 4) {
      r = g = b = linhas[j];
      a = linhas[j + 1];
    }
    else {
      const k = linhas[j];
      [r, g, b] = [paleta[k * 3], paleta[k * 3 + 1], paleta[k * 3 + 2]];
      if (transp && k < transp.length) a = transp[k];
    }
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = a;
  }
  return { largura, altura, px };
}

/** PNG RGBA sem compressão esperta — só para guardar recortes de diagnóstico. */
function escreverPNG(img) {
  const { largura, altura, px } = img;
  const bruto = Buffer.alloc(altura * (largura * 4 + 1));
  for (let y = 0; y < altura; y++) {
    bruto[y * (largura * 4 + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * largura * 4, largura * 4).copy(bruto, y * (largura * 4 + 1) + 1);
  }
  const crcTab = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTab[n] = c >>> 0;
  }
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTab[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloco = (tipo, corpo) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(corpo.length);
    const tc = Buffer.concat([Buffer.from(tipo, 'ascii'), corpo]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(tc));
    return Buffer.concat([len, tc, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(bruto)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/** Imagem a partir de BGRA (o que o nativeImage.toBitmap() do Electron dá no Windows). */
function deBGRA(buf, largura, altura) {
  const px = new Uint8Array(largura * altura * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = buf[i + 2];
    px[i + 1] = buf[i + 1];
    px[i + 2] = buf[i];
    px[i + 3] = buf[i + 3];
  }
  return { largura, altura, px };
}

function recortar(img, x, y, l, a) {
  const out = new Uint8Array(l * a * 4);
  for (let j = 0; j < a; j++) {
    const yy = Math.min(img.altura - 1, Math.max(0, y + j));
    for (let i = 0; i < l; i++) {
      const xx = Math.min(img.largura - 1, Math.max(0, x + i));
      const s = (yy * img.largura + xx) * 4;
      out.set(img.px.subarray(s, s + 4), (j * l + i) * 4);
    }
  }
  return { largura: l, altura: a, px: out };
}

/** Redimensiona por média de área (bom a reduzir, que é o que se faz aos ícones). */
function redimensionar(img, l, a) {
  const out = new Uint8Array(l * a * 4);
  const sx = img.largura / l;
  const sy = img.altura / a;
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < l; i++) {
      const x0 = i * sx, x1 = (i + 1) * sx, y0 = j * sy, y1 = (j + 1) * sy;
      const acc = [0, 0, 0, 0];
      let peso = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          const w = wx * wy;
          const s = (Math.min(y, img.altura - 1) * img.largura + Math.min(x, img.largura - 1)) * 4;
          for (let k = 0; k < 4; k++) acc[k] += img.px[s + k] * w;
          peso += w;
        }
      }
      for (let k = 0; k < 4; k++) out[(j * l + i) * 4 + k] = Math.round(acc[k] / peso);
    }
  }
  return { largura: l, altura: a, px: out };
}

/**
 * Muda a escala por um fator: média de área a reduzir, bilinear a ampliar.
 * Serve para levar uma captura de outra resolução ao tamanho de 1440p, que é
 * onde os moldes dos algarismos e a geometria da mochila foram medidos.
 */
function escalar(img, f) {
  const l = Math.max(1, Math.round(img.largura * f));
  const a = Math.max(1, Math.round(img.altura * f));
  if (f <= 1) return redimensionar(img, l, a);
  const out = new Uint8Array(l * a * 4);
  for (let j = 0; j < a; j++) {
    const sy = Math.min(img.altura - 1, Math.max(0, (j + 0.5) / f - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(img.altura - 1, y0 + 1);
    const wy = sy - y0;
    for (let i = 0; i < l; i++) {
      const sx = Math.min(img.largura - 1, Math.max(0, (i + 0.5) / f - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(img.largura - 1, x0 + 1);
      const wx = sx - x0;
      for (let k = 0; k < 4; k++) {
        const p00 = img.px[(y0 * img.largura + x0) * 4 + k];
        const p01 = img.px[(y0 * img.largura + x1) * 4 + k];
        const p10 = img.px[(y1 * img.largura + x0) * 4 + k];
        const p11 = img.px[(y1 * img.largura + x1) * 4 + k];
        out[(j * l + i) * 4 + k] = Math.round((p00 * (1 - wx) + p01 * wx) * (1 - wy) + (p10 * (1 - wx) + p11 * wx) * wy);
      }
    }
  }
  return { largura: l, altura: a, px: out };
}

function luz(img, x, y) {
  const s = (y * img.largura + x) * 4;
  return (img.px[s] * 299 + img.px[s + 1] * 587 + img.px[s + 2] * 114) / 1000;
}

module.exports = { lerPNG, escreverPNG, deBGRA, recortar, redimensionar, escalar, luz };
