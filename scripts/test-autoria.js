'use strict';

// A autoria fica à vista e não desaparece numa alteração distraída: a barra de
// título diz "by LusitanoScripts", o "Sobre" também, e o pacote e a licença
// dizem o mesmo. O instalador é selado (fuses do Electron): uma cópia com o
// app.asar mexido recusa arrancar — este teste confirma que a selagem está ligada.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const licenca = fs.readFileSync(path.join(raiz, 'LICENSE'), 'utf8');

// Na barra de título, à vista de quem abre a app — não escondida num menu.
const barra = /<header id="titlebar">[\s\S]*?<\/header>/.exec(html);
assert.ok(barra, 'falta a barra de título');
assert.ok(/<span class="tb-autor">by LusitanoScripts<\/span>/.test(barra[0]), 'a autoria saiu da barra de título');

// No "Sobre", com os créditos às fontes de dados.
const sobre = /<div class="sobre">[\s\S]*?<\/div>/.exec(html);
assert.ok(sobre, 'falta a secção Sobre');
assert.ok(sobre[0].includes('LusitanoScripts'), 'o Sobre já não diz quem fez a app');
assert.ok(sobre[0].includes('aion2.exchange'), 'o Sobre já não dá o crédito ao aion2.exchange');
assert.ok(sobre[0].includes('NCSoft'), 'o Sobre já não diz que é uma app de fãs sem ligação à NCSoft');

// Pacote e licença.
assert.strictEqual(pkg.author, 'LusitanoScripts');
assert.ok(pkg.build.copyright.includes('LusitanoScripts'));
assert.strictEqual(pkg.license, 'SEE LICENSE IN LICENSE', 'a licença do package.json não aponta para o LICENSE');
assert.ok(/All rights reserved/.test(licenca) && /Todos os direitos reservados/.test(licenca) && licenca.includes('by LusitanoScripts'), 'a licença mudou');

// A selagem do instalador: sem isto, mudar o HTML dentro do app.asar e voltar a
// empacotar dava uma cópia sem créditos que arrancava na mesma.
const f = pkg.build.electronFuses || {};
assert.strictEqual(f.enableEmbeddedAsarIntegrityValidation, true, 'o instalador já não verifica o app.asar');
assert.strictEqual(f.onlyLoadAppFromAsar, true, 'o instalador aceita código fora do app.asar');
assert.strictEqual(f.runAsNode, false, 'o executável aceita ELECTRON_RUN_AS_NODE');

console.log('test-autoria: autoria à vista, créditos, licença e selagem do instalador');
