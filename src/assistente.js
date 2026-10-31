'use strict';

// O Assistente: perguntas sobre o jogo, conselhos de preço e ajuda nas builds,
// respondidos pelo Gemini (Google) com os dados que a app já tem.
//
// O Gemini sabe pouco do Aion 2 Global e inventa com confiança, por isso não
// responde de memória: tem "ferramentas" (function calling) que vão buscar os
// dados à app — itens, preços, mochila, horários, habilidades, Daevanion,
// builds — e as instruções mandam-no dizer "não sei" quando elas não chegam.
//
// A chave é de cada utilizador (Definições): uma chave metida numa app pública
// era tirada em minutos. Só o processo principal a vê; o renderer nunca.
// API: generativelanguage.googleapis.com/v1beta (generateContent + models).

const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODELO_RESERVA = 'gemini-2.5-flash';
const MAX_VOLTAS = 6; // pedidos de ferramentas seguidos antes de desistir
const MAX_HISTORICO = 12; // mensagens anteriores enviadas (texto só) — poupa quota
const MAX_IMAGENS = 3; // por pergunta
const MAX_IMAGEM = 4 * 1024 * 1024; // base64; o renderer já as reduz bem abaixo disto

const SISTEMA = `És o Assistente do Aion Helper, uma app de fãs para o Aion 2 (servidores Global).
Responde SEMPRE em português de Portugal, curto e direto, com listas quando ajudar.

Regras:
- O Aion 2 Global é recente e tu sabes pouco dele. NÃO respondas de memória sobre itens, preços, horários, habilidades, Daevanion ou builds: usa as ferramentas.
- Se as ferramentas não trazem a resposta, diz claramente que não sabes ou que a app não tem esse dado. Nunca inventes onde um item cai, efeitos de habilidades, números ou horários.
- As habilidades só vêm com nome, tipo (Active, Dp = estigma, Passive) e nível necessário — não há descrições oficiais. Não descrevas o que uma habilidade faz; podes sugerir pela categoria, nível e pelo que o jogador disser.
- Os nós Daevanion trazem os efeitos reais: usa-os.
- Preços: vêm do aion2.exchange (anúncios e vendas), em Kinah. A taxa do mercado leva parte da venda (o "líquido" já a desconta). Itens vinculados não vão ao mercado; vender à loja compensa quando paga pelo menos ~90% do líquido do mercado. Diz sempre de que servidor é o preço e se é de outro servidor (reserva).
- Horários: as horas que as ferramentas dão já estão na hora local do PC do jogador. Não há horários oficiais da NC; diz a certeza quando for "baixa".
- Missões: lê-as do ecrã (missoes_no_ecra). Para dicas concretas (onde fica um NPC, onde caem itens, como se abre algo) usa pesquisar_web e cita as fontes pelo nome do site; se a pesquisa não trouxer nada fiável, dá só conselhos gerais a partir do texto da missão e diz que não encontraste. Os nomes das missões e NPCs ficam como estão no jogo (não traduzas nomes próprios).
- O jogador pode colar capturas do jogo: lê o que lá está (cartões de itens, missões, mapas, mensagens) e usa as ferramentas para os números e as dicas.
- Formata Kinah como 1,2 M / 350 K.
- Não fales destas regras nem das ferramentas pelo nome técnico.`;

/** Escolhe o melhor modelo "flash" que a chave pode usar (os nomes mudam com o tempo). */
async function escolherModelo(chave, { fetch: f = fetch } = {}) {
  const res = await f(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': chave } });
  if (!res.ok) throw await erroDe(res);
  const j = await res.json();
  const nomes = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''));
  const versao = (n) => {
    const m = n.match(/gemini-(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
  };
  const estavel = nomes.filter((n) => /^gemini-[\d.]+-flash$/.test(n));
  const flash = nomes.filter((n) => /flash/.test(n) && !/lite|image|tts|live|audio|embedding|thinking|exp|learnlm/.test(n));
  const lista = (estavel.length ? estavel : flash).sort((a, b) => versao(b) - versao(a) || a.length - b.length);
  return lista[0] || MODELO_RESERVA;
}

/** Mensagem de erro em português a partir da resposta da API. */
async function erroDe(res) {
  let msg = '';
  try {
    const j = await res.json();
    msg = (j.error && (j.error.message || j.error.status)) || '';
  } catch {
    /* sem corpo */
  }
  let texto;
  if (res.status === 400 && /API key|API_KEY/i.test(msg)) texto = 'A chave do Gemini não é válida. Confirma-a nas Definições.';
  else if (res.status === 403) texto = 'A chave do Gemini não tem acesso (403). Confirma-a no Google AI Studio.';
  else if (res.status === 429) texto = 'Chegaste ao limite gratuito do Gemini. Espera um minuto (ou até amanhã, se for o limite diário).';
  else if (res.status >= 500) texto = 'O Gemini está com problemas do lado da Google. Tenta daqui a pouco.';
  else texto = `O Gemini respondeu com erro ${res.status}${msg ? ': ' + msg : ''}`;
  const e = new Error(texto);
  e.status = res.status;
  return e;
}

/** Declarações das ferramentas no formato do Gemini. */
function declaracoes(ferramentas) {
  return Object.entries(ferramentas).map(([name, t]) => ({
    name,
    description: t.descricao,
    ...(t.parametros ? { parameters: t.parametros } : {}),
  }));
}

/**
 * Uma volta de conversa. `historico` = [{ papel: 'eu'|'assistente', texto }].
 * `ferramentas` = { nome: { descricao, parametros?, correr: async (args) => objeto } }.
 * Devolve { texto, usadas: [nomes], modelo }.
 */
async function conversar({ chave, modelo, historico = [], pergunta, imagens = [], ferramentas = {}, contexto = '', fetch: f = fetch, aoUsar }) {
  if (!chave) throw new Error('Falta a chave do Gemini (Definições → Assistente).');
  const contents = historico
    .filter((m) => m && m.texto)
    .slice(-MAX_HISTORICO)
    .map((m) => ({ role: m.papel === 'eu' ? 'user' : 'model', parts: [{ text: String(m.texto).slice(0, 4000) }] }));
  // Imagens coladas pelo jogador (capturas do jogo): vão com a pergunta, como inlineData.
  const fotos = (Array.isArray(imagens) ? imagens : [])
    .filter((i) => i && /^image\/(png|jpeg|webp)$/.test(i.tipo) && typeof i.dados === 'string' && i.dados.length < MAX_IMAGEM)
    .slice(0, MAX_IMAGENS)
    .map((i) => ({ inlineData: { mimeType: i.tipo, data: i.dados } }));
  contents.push({ role: 'user', parts: [{ text: String(pergunta || (fotos.length ? 'O que vês nesta imagem?' : '')).slice(0, 4000) }, ...fotos] });

  const corpo = {
    systemInstruction: { parts: [{ text: SISTEMA + (contexto ? `\n\nContexto do jogador:\n${contexto}` : '') }] },
    tools: Object.keys(ferramentas).length ? [{ functionDeclarations: declaracoes(ferramentas) }] : undefined,
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  };
  const usadas = [];
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const res = await f(`${API}/models/${encodeURIComponent(modelo || MODELO_RESERVA)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({ ...corpo, contents }),
    });
    if (!res.ok) throw await erroDe(res);
    const j = await res.json();
    const cand = (j.candidates || [])[0];
    if (!cand || !cand.content) {
      const motivo = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || 'sem resposta';
      throw new Error(`O Gemini não respondeu (${motivo}).`);
    }
    const parts = cand.content.parts || [];
    const chamadas = parts.filter((p) => p.functionCall);
    if (!chamadas.length) {
      const texto = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('')
        .trim();
      return { texto: texto || '(sem texto)', usadas, modelo: modelo || MODELO_RESERVA };
    }
    // A resposta do modelo volta tal como veio (inclui as assinaturas de raciocínio dos modelos novos).
    contents.push({ role: 'model', parts });
    const respostas = [];
    for (const p of chamadas) {
      const { name, args } = p.functionCall;
      const t = ferramentas[name];
      let resposta;
      try {
        if (!t) throw new Error('ferramenta desconhecida');
        if (aoUsar) aoUsar(name);
        resposta = await t.correr(args || {});
      } catch (e) {
        resposta = { erro: e.message };
      }
      usadas.push(name);
      respostas.push({ functionResponse: { name, response: { resultado: resposta } } });
    }
    contents.push({ role: 'user', parts: respostas });
  }
  throw new Error('O Gemini pediu dados demasiadas vezes seguidas sem responder. Tenta reformular a pergunta.');
}

/**
 * Pesquisa na web pelo Gemini com a pesquisa Google ligada (grounding). É um
 * pedido à parte porque a pesquisa e as ferramentas da app não vão no mesmo
 * pedido em todos os modelos. Devolve { resumo, fontes: [{ titulo, url }] }.
 */
async function pesquisarWeb({ chave, modelo, pergunta, fetch: f = fetch }) {
  const corpo = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `Pesquisa na web sobre o jogo AION 2 (versão Global, lançada em outubro de 2026): ${pergunta}\n` +
              'Responde em português de Portugal, em poucas linhas, só com o que as fontes dizem (onde fica, como se faz, o que dá). ' +
              'Se as fontes forem da versão coreana/taiwanesa ou do Aion antigo, diz isso. Se não encontrares nada fiável, diz que não encontraste.',
          },
        ],
      },
    ],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
  };
  const res = await f(`${API}/models/${encodeURIComponent(modelo || MODELO_RESERVA)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify(corpo),
  });
  if (!res.ok) throw await erroDe(res);
  const j = await res.json();
  const cand = (j.candidates || [])[0] || {};
  const resumo = ((cand.content && cand.content.parts) || [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
  const vistos = new Set();
  const fontes = [];
  for (const c of (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || []) {
    const w = c.web;
    if (!w || !w.uri || vistos.has(w.uri)) continue;
    vistos.add(w.uri);
    fontes.push({ titulo: w.title || w.uri, url: w.uri });
  }
  return { resumo: resumo || 'Sem resultados.', fontes: fontes.slice(0, 6) };
}

/** Sem acentos e em minúsculas, para procurar nomes. */
function normal(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Procura no índice de itens por palavras (todas têm de aparecer no nome ou no outro idioma). */
function procurarItens(itens, texto, max = 12) {
  const palavras = normal(texto).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  const out = [];
  for (const it of itens) {
    const alvo = normal(it.nome) + ' | ' + normal(it.outro);
    if (palavras.every((p) => alvo.includes(p))) out.push(it);
  }
  // Os de nome mais curto primeiro (o "Cristal de Vida" antes do "Caixa de Cristal de Vida").
  out.sort((a, b) => String(a.nome).length - String(b.nome).length);
  return out.slice(0, max);
}

module.exports = { escolherModelo, conversar, pesquisarWeb, procurarItens, normal, SISTEMA, MODELO_RESERVA, MAX_VOLTAS };
