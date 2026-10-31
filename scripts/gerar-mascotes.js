'use strict';

// Gera src/dados/mascotes.json: todas as mascotes do Aion 2 Global e a alma de
// cada uma, para a aba Mascotes funcionar sem rede.
//
// As mascotes são itens (534760001…, categoria "Mascote") e as almas também
// (534660001…, "Alma: X (Vinculado)"). Não há lista no Global, por isso vai-se
// id a id à ficha oficial da NC; um id que não existe responde 200 com tudo a
// zero. A alma e a mascote NÃO têm números que batam (Zaif 534760119 ↔ alma
// 534660121): ligam-se pelo ícone, que é o mesmo retrato.
//
// O que a NC não diz e por isso não está aqui: a família (Feral…), quantas almas
// pede cada nível e que monstro deixa cair cada alma.
//
// Correr: node scripts/gerar-mascotes.js   (~6 min)

const fs = require('fs');
const path = require('path');
const { getJSON } = require('../src/http');

const NC = 'https://aion2.plaync.com';
const IDIOMAS = ['pt-BR', 'en-US'];
const SAIDA = path.join(__dirname, '..', 'src', 'dados', 'mascotes.json');
const PRIMEIRA_MASCOTE = 534760001;
const PRIMEIRA_ALMA = 534660001;
// Depois do último que existe, quantos vazios seguidos até desistir.
const VAZIOS = 60;

async function ficha(id, idioma) {
  const url = `${NC}/${idioma.toLowerCase()}/api/gameconst/item?${new URLSearchParams({ lang: idioma, id, enchantLevel: 0 })}`;
  for (let tentativa = 0; ; tentativa++) {
    try {
      const j = await getJSON(url, { intervaloMs: 150 });
      return j && j.id ? j : null;
    } catch (e) {
      if (tentativa >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
    }
  }
}

/** Todos os itens a partir de `inicio` até `VAZIOS` ids seguidos sem nada. */
async function varrer(inicio, rotulo) {
  const out = [];
  let vazios = 0;
  for (let id = inicio; vazios < VAZIOS; id++) {
    const pt = await ficha(id, 'pt-BR');
    if (!pt) {
      vazios++;
      continue;
    }
    vazios = 0;
    const en = await ficha(id, 'en-US');
    out.push({ pt, en });
    if (out.length % 25 === 0) console.log(`${rotulo}: ${out.length} (id ${id})`);
  }
  console.log(`${rotulo}: ${out.length}`);
  return out;
}

const icone = (url) => String(url || '').split('/').pop();
const semPrefixo = (s) => String(s || '').replace(/^(Mascote|Pet|Alma|Soul)\s*:\s*/i, '').replace(/\s*\((Vinculado|Bound)\)\s*$/i, '').trim();

async function main() {
  const mascotes = await varrer(PRIMEIRA_MASCOTE, 'mascotes');
  const almas = await varrer(PRIMEIRA_ALMA, 'almas');

  const almaPorIcone = new Map();
  for (const a of almas) {
    if (a.pt.categoryName !== mascotes[0].pt.categoryName) continue;
    almaPorIcone.set(icone(a.pt.icon), a);
  }

  let semAlma = 0;
  const lista = mascotes.map(({ pt, en }) => {
    const a = almaPorIcone.get(icone(pt.icon));
    if (!a) semAlma++;
    return {
      id: pt.id,
      n: { 'pt-BR': semPrefixo(pt.name), 'en-US': semPrefixo(en && en.name) },
      g: pt.grade,
      gn: pt.gradeName,
      i: icone(pt.icon),
      d: pt.desc || '',
      f: { 'pt-BR': pt.sources || [], 'en-US': (en && en.sources) || [] },
      alma: a ? { id: a.pt.id, f: { 'pt-BR': a.pt.sources || [], 'en-US': (a.en && a.en.sources) || [] } } : null,
    };
  });

  fs.writeFileSync(
    SAIDA,
    JSON.stringify({ gerado: new Date().toISOString(), origem: 'aion2.plaync.com/api/gameconst/item', mascotes: lista }),
  );
  console.log(`${lista.length} mascotes, ${lista.length - semAlma} com alma → ${path.relative(process.cwd(), SAIDA)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
