'use strict';

// Pedidos JSON com prazo, recuo e um limite de ritmo por anfitrião.
//
// As duas origens são de terceiros e nenhuma publica limites: o aion2.exchange
// é o servidor de uma pessoa só, e a API web da NC não é documentada. Por isso
// o ritmo é conservador por omissão — ser bloqueado custa muito mais do que
// esperar 150 ms.

const UA = 'AionHelper/0.1 (+companion app; contacto no GitHub do autor)';

const ultimoPorHost = new Map();

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function aVez(host, intervaloMs) {
  const agora = Date.now();
  const proximo = Math.max(agora, (ultimoPorHost.get(host) || 0) + intervaloMs);
  ultimoPorHost.set(host, proximo);
  if (proximo > agora) await esperar(proximo - agora);
}

class HttpError extends Error {
  constructor(status, url, corpo) {
    super(`HTTP ${status} em ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.corpo = corpo;
  }
}

/**
 * GET que devolve JSON já lido.
 * Recua em 429 e 5xx (2 s, 6 s); um 4xx que não seja 429 é definitivo e não se repete.
 */
async function getJSON(url, { timeoutMs = 20000, intervaloMs = 150, tentativas = 3 } = {}) {
  const host = new URL(url).host;
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    await aVez(host, intervaloMs);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
      const texto = await res.text();
      if (!res.ok) {
        ultimoErro = new HttpError(res.status, url, texto.slice(0, 300));
        if (res.status !== 429 && res.status < 500) throw ultimoErro;
      } else {
        return JSON.parse(texto);
      }
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      ultimoErro = e.name === 'AbortError' ? new Error(`Sem resposta em ${timeoutMs / 1000} s: ${url}`) : e;
    } finally {
      clearTimeout(t);
    }
    if (i < tentativas - 1) await esperar([2000, 6000][i] || 6000);
  }
  throw ultimoErro;
}

module.exports = { getJSON, HttpError };
