'use strict';

// O Assistente sem rede: um fetch falso faz de Gemini (lista de modelos,
// pedidos de ferramentas, resposta final, erros).

const assert = require('assert');
const A = require('../src/assistente');

let falhas = 0;
async function teste(nome, fn) {
  try {
    await fn();
    console.log('ok  ', nome);
  } catch (e) {
    falhas++;
    console.log('FALHA', nome, '\n     ', e.message);
  }
}

const resp = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

(async () => {
  await teste('escolhe o flash estável mais recente', async () => {
    const f = async () =>
      resp(200, {
        models: [
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.0-flash-image', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        ],
      });
    assert.strictEqual(await A.escolherModelo('k', { fetch: f }), 'gemini-2.5-flash');
  });

  await teste('sem flash estável, aceita um flash de pré-visualização', async () => {
    const f = async () => resp(200, { models: [{ name: 'models/gemini-3-flash-preview', supportedGenerationMethods: ['generateContent'] }] });
    assert.strictEqual(await A.escolherModelo('k', { fetch: f }), 'gemini-3-flash-preview');
  });

  await teste('chave errada dá mensagem em português', async () => {
    const f = async () => resp(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
    await assert.rejects(A.escolherModelo('x', { fetch: f }), /chave do Gemini não é válida/);
  });

  await teste('limite gratuito (429)', async () => {
    const f = async () => resp(429, { error: { status: 'RESOURCE_EXHAUSTED' } });
    await assert.rejects(A.conversar({ chave: 'k', modelo: 'm', pergunta: 'olá', fetch: f }), /limite gratuito/);
  });

  await teste('chama a ferramenta, devolve o resultado e responde', async () => {
    const pedidos = [];
    const f = async (url, op) => {
      const corpo = JSON.parse(op.body);
      pedidos.push(corpo);
      assert.strictEqual(op.headers['x-goog-api-key'], 'k');
      assert.ok(!url.includes('key='), 'a chave vai no cabeçalho, não no URL');
      if (pedidos.length === 1) {
        return resp(200, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'preco_item', args: { id: 7 } }, thoughtSignature: 'abc' }] } }] });
      }
      // A 2.ª volta leva a resposta do modelo tal como veio e o resultado da ferramenta.
      const ult = corpo.contents[corpo.contents.length - 1];
      const ant = corpo.contents[corpo.contents.length - 2];
      assert.strictEqual(ant.parts[0].thoughtSignature, 'abc');
      assert.deepStrictEqual(ult.parts[0].functionResponse.response.resultado, { preco: 1500 });
      return resp(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'Vale **1,5 K**.' }] } }] });
    };
    const usadas = [];
    const r = await A.conversar({
      chave: 'k',
      modelo: 'gemini-x',
      historico: [{ papel: 'eu', texto: 'olá' }, { papel: 'assistente', texto: 'Olá!' }],
      pergunta: 'quanto vale o 7?',
      ferramentas: { preco_item: { descricao: 'preço', parametros: { type: 'object', properties: { id: { type: 'number' } } }, correr: async ({ id }) => (id === 7 ? { preco: 1500 } : null) } },
      contexto: 'Servidor: Odar',
      fetch: f,
      aoUsar: (n) => usadas.push(n),
    });
    assert.strictEqual(r.texto, 'Vale **1,5 K**.');
    assert.deepStrictEqual(r.usadas, ['preco_item']);
    assert.deepStrictEqual(usadas, ['preco_item']);
    assert.strictEqual(pedidos[0].contents.length, 3, 'histórico + pergunta');
    assert.strictEqual(pedidos[0].contents[1].role, 'model');
    assert.ok(pedidos[0].systemInstruction.parts[0].text.includes('Servidor: Odar'));
    assert.strictEqual(pedidos[0].tools[0].functionDeclarations[0].name, 'preco_item');
  });

  await teste('ferramenta que falha não deita a conversa abaixo', async () => {
    let n = 0;
    const f = async (_u, op) => {
      n++;
      if (n === 1) return resp(200, { candidates: [{ content: { parts: [{ functionCall: { name: 'mochila', args: {} } }] } }] });
      const ult = JSON.parse(op.body).contents.pop();
      assert.strictEqual(ult.parts[0].functionResponse.response.resultado.erro, 'sem mochila');
      return resp(200, { candidates: [{ content: { parts: [{ text: 'Ainda não leste a mochila.' }] } }] });
    };
    const r = await A.conversar({
      chave: 'k',
      modelo: 'm',
      pergunta: 'mochila?',
      ferramentas: { mochila: { descricao: 'x', correr: async () => { throw new Error('sem mochila'); } } },
      fetch: f,
    });
    assert.strictEqual(r.texto, 'Ainda não leste a mochila.');
  });

  await teste('desiste ao fim de várias voltas só com pedidos', async () => {
    const f = async () => resp(200, { candidates: [{ content: { parts: [{ functionCall: { name: 'horarios', args: {} } }] } }] });
    await assert.rejects(
      A.conversar({ chave: 'k', modelo: 'm', pergunta: 'x', ferramentas: { horarios: { descricao: 'x', correr: async () => ({}) } }, fetch: f }),
      /demasiadas vezes/,
    );
  });

  await teste('imagens coladas vão como inlineData (só imagens, no máximo 3)', async () => {
    let partes;
    const f = async (_u, op) => {
      partes = JSON.parse(op.body).contents.pop().parts;
      return resp(200, { candidates: [{ content: { parts: [{ text: 'Vejo um cartão.' }] } }] });
    };
    const img = { tipo: 'image/jpeg', dados: 'QUJD' };
    await A.conversar({
      chave: 'k',
      modelo: 'm',
      pergunta: '',
      imagens: [img, { tipo: 'text/html', dados: 'x' }, img, img, img],
      fetch: f,
    });
    assert.strictEqual(partes[0].text, 'O que vês nesta imagem?', 'sem texto, pergunta por omissão');
    assert.strictEqual(partes.length, 4, 'texto + 3 imagens');
    assert.deepStrictEqual(partes[1], { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
  });

  await teste('ignora o texto de raciocínio (thought) na resposta', async () => {
    const f = async () => resp(200, { candidates: [{ content: { parts: [{ text: 'a pensar...', thought: true }, { text: 'Resposta.' }] } }] });
    assert.strictEqual((await A.conversar({ chave: 'k', modelo: 'm', pergunta: 'x', fetch: f })).texto, 'Resposta.');
  });

  await teste('sem chave não faz pedidos', async () => {
    let chamou = false;
    await assert.rejects(A.conversar({ chave: '', pergunta: 'x', fetch: async () => ((chamou = true), resp(200, {})) }), /Falta a chave/);
    assert.ok(!chamou);
  });

  await teste('procura itens por palavras, sem acentos, curtos primeiro', async () => {
    const itens = [
      { id: 1, nome: 'Caixa de Cristal de Vida', outro: 'Life Crystal Box' },
      { id: 2, nome: 'Cristal de Vida', outro: 'Life Crystal' },
      { id: 3, nome: 'Pedra de Superação (Única)', outro: 'Amplify Stone (Unique)' },
    ];
    assert.deepStrictEqual(A.procurarItens(itens, 'cristal vida').map((x) => x.id), [2, 1]);
    assert.deepStrictEqual(A.procurarItens(itens, 'superacao').map((x) => x.id), [3]);
    assert.deepStrictEqual(A.procurarItens(itens, 'amplify').map((x) => x.id), [3]);
    assert.deepStrictEqual(A.procurarItens(itens, '   '), []);
  });

  await teste('pesquisa web: liga a pesquisa Google e devolve as fontes sem repetidos', async () => {
    const f = async (_u, op) => {
      const corpo = JSON.parse(op.body);
      assert.deepStrictEqual(corpo.tools, [{ google_search: {} }]);
      assert.ok(corpo.contents[0].parts[0].text.includes('Uru'));
      return resp(200, {
        candidates: [{
          content: { parts: [{ text: 'O Uru está em Eltnen.' }] },
          groundingMetadata: { groundingChunks: [
            { web: { uri: 'https://a', title: 'questlog.gg' } },
            { web: { uri: 'https://a', title: 'questlog.gg' } },
            { web: { uri: 'https://b', title: 'reddit.com' } },
          ] },
        }],
      });
    };
    const r = await A.pesquisarWeb({ chave: 'k', modelo: 'm', pergunta: 'onde está o Uru', fetch: f });
    assert.strictEqual(r.resumo, 'O Uru está em Eltnen.');
    assert.deepStrictEqual(r.fontes.map((x) => x.titulo), ['questlog.gg', 'reddit.com']);
  });

  if (falhas) {
    console.log(`\n${falhas} falha(s)`);
    process.exit(1);
  }
  console.log('\nassistente: tudo bem');
})();
