'use strict';

// Gera src/dados/itens.json: o índice de todos os itens do Aion 2 Global, para
// a aba Itens procurar sem ir à rede.
//
// O Global não tem catálogo de itens (só a ficha item a item, pelo id). Taiwan
// tem: o dicionário de tw.ncsoft.com dá ~11 200 itens, 50 por página e no
// máximo 10 000 por pesquisa (por isso vai-se categoria a categoria). Os ids
// são os mesmos nas duas regiões, mas Taiwan vai à frente: um item que o Global
// ainda não tem responde 200 com tudo a zero, e fica de fora.
//
// Correr: node scripts/gerar-itens.js   (~1 h; retoma onde parou)
// Os passos intermédios ficam em scripts/.itens-progresso.json.

const fs = require('fs');
const path = require('path');
const { getJSON } = require('../src/http');

const TW = 'https://tw.ncsoft.com/aion2_tw/v2.0';
const NC = 'https://aion2.plaync.com';
const IDIOMAS = ['pt-BR', 'en-US'];
const PROGRESSO = path.join(__dirname, '.itens-progresso.json');
const SAIDA = path.join(__dirname, '..', 'src', 'dados', 'itens.json');

function qs(o) {
  return '?' + new URLSearchParams(o).toString();
}

function lerProgresso() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESSO, 'utf8'));
  } catch {
    return { lista: null, fichas: {} };
  }
}

function gravarProgresso(p) {
  fs.writeFileSync(PROGRESSO + '.part', JSON.stringify(p));
  fs.renameSync(PROGRESSO + '.part', PROGRESSO);
}

async function listaTW() {
  const cats = await getJSON(`${TW}/game/item/category${qs({ locale: 'en-US' })}`);
  const porId = new Map();
  for (const c1 of cats) {
    // Primeiro a categoria inteira: muitos itens (títulos, caixas…) não têm subcategoria.
    for (let page = 1; ; page++) {
      const j = await getJSON(`${TW}/dict/search/item${qs({ page, size: 50, locale: 'en-US', category1: c1.id })}`);
      for (const it of j.contents || []) porId.set(it.id, { id: it.id, nomeTW: it.name, cat1: c1.id, cat2: null, catNome: it.categoryName || c1.name });
      if (page >= j.pagination.lastPage || !(j.contents || []).length) break;
    }
    for (const c2 of c1.child) {
      for (let page = 1; ; page++) {
        const j = await getJSON(`${TW}/dict/search/item${qs({ page, size: 50, locale: 'en-US', category1: c1.id, category2: c2.id })}`);
        for (const it of j.contents || []) porId.set(it.id, { id: it.id, nomeTW: it.name, cat1: c1.id, cat2: c2.id, catNome: c2.name });
        if (page >= j.pagination.lastPage || !(j.contents || []).length) break;
      }
      process.stdout.write(`\rlista: ${porId.size} itens (${c1.id}/${c2.id})        `);
    }
  }
  console.log();
  return [...porId.values()];
}

async function main() {
  const p = lerProgresso();
  if (!p.lista) {
    p.lista = await listaTW();
    gravarProgresso(p);
  }
  console.log(`${p.lista.length} itens em Taiwan`);

  let feitos = 0;
  const inicio = Date.now();
  for (const it of p.lista) {
    for (const idioma of IDIOMAS) {
      const k = `${it.id}:${idioma}`;
      if (k in p.fichas) continue;
      // Se o Global não conhece o item em pt-BR, não vale a pena perguntar em inglês.
      if (idioma !== IDIOMAS[0] && p.fichas[`${it.id}:${IDIOMAS[0]}`] === null) {
        p.fichas[k] = null;
        continue;
      }
      try {
        const j = await getJSON(`${NC}/${idioma.toLowerCase()}/api/gameconst/item${qs({ lang: idioma, id: it.id, enchantLevel: 0 })}`, { intervaloMs: 150 });
        p.fichas[k] = j && j.id ? j : null;
      } catch (e) {
        console.log(`\n${k}: ${e.message}`);
        continue; // fica por fazer; a próxima corrida tenta outra vez
      }
      feitos++;
      if (feitos % 100 === 0) {
        gravarProgresso(p);
        const total = p.lista.length * IDIOMAS.length;
        const feitosTotal = Object.keys(p.fichas).length;
        const ritmo = feitos / ((Date.now() - inicio) / 1000);
        process.stdout.write(`\rfichas: ${feitosTotal}/${total} · faltam ~${Math.round((total - feitosTotal) / ritmo / 60)} min   `);
      }
    }
  }
  gravarProgresso(p);
  console.log();

  // O índice: só o que a aba precisa para listar e procurar. O resto (atributos,
  // pedras, origem) pede-se à NC quando se abre o item.
  const itens = [];
  for (const it of p.lista) {
    const pt = p.fichas[`${it.id}:pt-BR`];
    if (!pt) continue;
    const en = p.fichas[`${it.id}:en-US`];
    itens.push({
      id: it.id,
      n: { 'pt-BR': pt.name, 'en-US': en ? en.name : it.nomeTW },
      g: pt.grade || null,
      gn: pt.gradeName || null, // o nome do grau como o jogo o diz (pt-BR: Legend = "Épico")
      c1: it.cat1,
      c2: it.cat2,
      cat: pt.categoryName || it.catNome,
      i: pt.icon ? pt.icon.replace('https://assets.playnccdn.com/static-aion2-gamedata/resources/', '') : null,
      l: pt.level || pt.equipLevel || 0,
      t: pt.tradable ? 1 : 0,
      cl: Array.isArray(pt.classNames) ? pt.classNames : [],
    });
  }
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify({ gerado: new Date().toISOString().slice(0, 10), origem: 'tw.ncsoft.com (lista) + aion2.plaync.com (fichas)', itens }));
  console.log(`${itens.length} itens no Global (de ${p.lista.length} em Taiwan) → ${path.relative(process.cwd(), SAIDA)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
