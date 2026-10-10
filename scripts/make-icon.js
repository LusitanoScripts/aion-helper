#!/usr/bin/env node
/**
 * Gera o ícone da app a partir de código, sem dependências.
 *
 * Copiado do SC Helper (o mesmo desenho por distâncias, sem dependências), com a
 * paleta dourada do Aion Helper (renderer/css/style.css) e um "A" com asas. Escreve build/icon.ico (para o
 * electron-builder e para a janela) e build/icon.png (256px, para o README).
 *
 *   node scripts/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Paleta, copiada de renderer/css/style.css.
const BG_TOP = [0x16, 0x1c, 0x28];
const BG_BOT = [0x0b, 0x0e, 0x14];
const LINE = [0x26, 0x30, 0x44];
const GOLD = [0xe3, 0xb7, 0x65];
const GOLD_LIGHT = [0xf3, 0xd0, 0x8a];

/* ── desenho ─────────────────────────────────────────────────────────────── */
// Tudo em coordenadas 0..1 e resolvido por distância com sinal, por isso o
// mesmo código serve os 16 px e os 256 px com o mesmo aspeto.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Cobertura suavizada de um pixel: 1 dentro, 0 fora, rampa de `aa` na borda. */
function cover(dist, aa) {
  return clamp(0.5 - dist / aa, 0, 1);
}

function sdRoundRect(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distância a um segmento de reta, para traços de espessura constante. */
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/** Anel com quatro cortes nas diagonais — a mira do HUD. */
function sdReticle(px, py, r, halfThick, gap) {
  const ring = Math.abs(Math.hypot(px, py) - r) - halfThick;
  // Um corte por diagonal: caixa girada 45° centrada na origem.
  const rx = (px + py) * Math.SQRT1_2;
  const ry = (px - py) * Math.SQRT1_2;
  const cut = Math.min(
    Math.max(Math.abs(rx) - gap, Math.abs(ry) - 1),
    Math.max(Math.abs(ry) - gap, Math.abs(rx) - 1),
  );
  // Subtrair o corte ao anel.
  return Math.max(ring, -cut);
}

/** Silhueta de nave delta: triângulo convexo com a base escavada. */
function sdShip(px, py, k) {
  const tip = [0, -0.20 * k];
  const bl = [-0.175 * k, 0.155 * k];
  const br = [0.175 * k, 0.155 * k];
  const pts = [tip, br, bl];
  let d = -Infinity;
  for (let i = 0; i < 3; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % 3];
    const ex = p1[0] - p0[0];
    const ey = p1[1] - p0[1];
    const len = Math.hypot(ex, ey);
    // Normal exterior: os vértices estão em sentido horário no ecrã (y para baixo).
    const nx = ey / len;
    const ny = -ex / len;
    d = Math.max(d, (px - p0[0]) * nx + (py - p0[1]) * ny);
  }
  // Escavar a popa com um círculo, para dar as duas asas.
  const notch = Math.hypot(px, py - 0.40 * k) - 0.30 * k;
  return Math.max(d, -notch);
}

function mix(dst, src, a) {
  dst[0] += (src[0] - dst[0]) * a;
  dst[1] += (src[1] - dst[1]) * a;
  dst[2] += (src[2] - dst[2]) * a;
}

/** Devolve RGBA (Uint8Array, size*size*4) do ícone no tamanho pedido. */
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = 1.6 / size; // rampa de ~1,6 px, em unidades 0..1

  // Abaixo dos 32 px não há pixels que cheguem para o traço fino: engrossa-se a
  // mira, alargam-se os cortes das diagonais (senão fecham) e cresce a nave. O
  // contorno interior desaparece, que a essa escala só suja.
  const small = size <= 32;
  const ringR = small ? 0.315 : 0.315;
  const ringT = small ? 0.052 : 0.042;
  const ringGap = small ? 0.062 : 0.055;
  const shipK = small ? 0.9 : 1;
  const border = small ? 0 : 0.9;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Centro do pixel em -0.5..0.5.
      const px = (x + 0.5) / size - 0.5;
      const py = (y + 0.5) / size - 0.5;

      let alpha = 0;
      const rgb = [0, 0, 0];

      // Fundo: quadrado arredondado com gradiente vertical, como o titlebar.
      const dBg = sdRoundRect(px, py, 0.5, 0.5, 0.18);
      const aBg = cover(dBg, aa);
      if (aBg > 0) {
        const t = clamp(py + 0.5, 0, 1);
        const base = [
          BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t,
          BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t,
          BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t,
        ];
        rgb[0] = base[0];
        rgb[1] = base[1];
        rgb[2] = base[2];
        alpha = aBg;

        // Contorno interior, o mesmo --line das caixas da UI.
        mix(rgb, LINE, cover(Math.abs(dBg + 0.028) - 0.008, aa) * border);
      }

      // Um "A" dourado (duas pernas e a barra) com duas asas abertas por trás.
      const t = small ? 0.052 : 0.04; // meia espessura do traço
      const dA = Math.min(
        sdSegment(px, py, 0, -0.27, -0.17, 0.25),
        sdSegment(px, py, 0, -0.27, 0.17, 0.25),
        sdSegment(px, py, -0.095, 0.05, 0.095, 0.05),
      ) - t;
      const dAsas = Math.min(
        sdSegment(px, py, -0.13, -0.02, -0.38, -0.2),
        sdSegment(px, py, -0.15, 0.06, -0.36, -0.06),
        sdSegment(px, py, 0.13, -0.02, 0.38, -0.2),
        sdSegment(px, py, 0.15, 0.06, 0.36, -0.06),
      ) - t * 0.7;
      const dentro = alpha > 0 ? 1 : 0;
      mix(rgb, GOLD, cover(dAsas, aa) * dentro * 0.85);
      mix(rgb, GOLD_LIGHT, cover(dA, aa) * dentro);

      const i = (y * size + x) * 4;
      buf[i] = Math.round(clamp(rgb[0], 0, 255));
      buf[i + 1] = Math.round(clamp(rgb[1], 0, 255));
      buf[i + 2] = Math.round(clamp(rgb[2], 0, 255));
      buf[i + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  return buf;
}

/* ── PNG ─────────────────────────────────────────────────────────────────── */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10..12 ficam a zero: deflate, filtro base, sem entrelaçamento.

  // Filtro 0 (None) por scanline. As imagens são pequenas e o zlib chega bem.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── ICO ─────────────────────────────────────────────────────────────────── */
// Um .ico é um diretório seguido dos bitmaps. Desde o Vista que cada entrada
// pode ser um PNG inteiro, que é o que fazemos — evita o formato BMP com a
// máscara AND invertida.

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // 1 = ícone
  header.writeUInt16LE(pngs.length, 4);

  const dir = Buffer.alloc(16 * pngs.length);
  let offset = header.length + dir.length;
  for (let i = 0; i < pngs.length; i++) {
    const { size, png } = pngs[i];
    const e = i * 16;
    dir[e] = size >= 256 ? 0 : size; // 0 significa 256
    dir[e + 1] = size >= 256 ? 0 : size;
    dir[e + 2] = 0; // cores da paleta
    dir[e + 3] = 0; // reservado
    dir.writeUInt16LE(1, e + 4); // planos
    dir.writeUInt16LE(32, e + 6); // bits por pixel
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  }

  return Buffer.concat([header, dir, ...pngs.map((p) => p.png)]);
}

/* ── main ────────────────────────────────────────────────────────────────── */

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const pngs = SIZES.map((size) => ({ size, png: encodePng(render(size), size) }));
  const ico = encodeIco(pngs);

  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
  fs.writeFileSync(path.join(OUT, 'icon.png'), pngs[pngs.length - 1].png);

  console.log(`build/icon.ico  ${SIZES.join(', ')} px  ${(ico.length / 1024).toFixed(1)} KB`);
  console.log(`build/icon.png  256 px  ${(pngs[pngs.length - 1].png.length / 1024).toFixed(1)} KB`);
}

if (require.main === module) main();

module.exports = { render, encodePng, encodeIco, SIZES };
