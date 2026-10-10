'use strict';

// Os <script> clássicos do renderer partilham UM âmbito global. Dois ficheiros
// com o mesmo `const` no topo dão SyntaxError e matam o segundo inteiro, em
// silêncio — e nenhum teste em Node o vê, porque o require() dá âmbito próprio a
// cada ficheiro. (Custou caro no SC Helper.) Regra: cada script carregado pelo
// index.html tem todo o código dentro de uma função imediata.

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', 'renderer');
// Todas as páginas: a janela principal e a das faixas por cima do jogo.
const scripts = [...new Set(['index.html', 'faixa.html'].flatMap((p) => {
  const html = fs.readFileSync(path.join(raiz, p), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => path.resolve(raiz, m[1]));
}))];

let falhas = 0;
for (const f of scripts) {
  if (!fs.existsSync(f)) {
    console.error(`✗ o index.html carrega ${path.relative(raiz, f)}, que não existe`);
    falhas++;
    continue;
  }
  const codigo = fs
    .readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*'use strict';?\s*$/gm, '')
    .trim();
  if (!/^\(function\b/.test(codigo) || !/\}\)\([^)]*\);?$/.test(codigo)) {
    console.error(`✗ ${path.relative(raiz, f)}: tem código fora de uma função imediata`);
    falhas++;
  }
}

if (falhas) process.exit(1);
console.log(`check-globals: ${scripts.length} scripts, todos fechados na sua função`);
