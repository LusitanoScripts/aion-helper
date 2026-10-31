// Horários do Aion 2 Global e as contas do "quanto falta", sem rede nem disco.
//
// Não há fonte oficial: a NC não publica horários (só avisos de manutenção no
// Steam). Isto junta o que três sites de fãs tiram dos ficheiros do cliente
// global e o que os jogadores viram (out. 2026) — por isso cada linha diz quão
// certa é. Onde as fontes discordam, fica a mais provável e a nota diz qual é a
// outra.
//
// Dois relógios:
//  - os EVENTOS correm na hora local de cada região ("cada região tem o seu
//    relógio": Europa = hora de Paris/Berlim, NA Este = Nova Iorque, …);
//  - os RESETS são à mesma hora no mundo todo, 07:00 UTC (09:00 em Paris no
//    verão), logo a seguir à manutenção de quarta. Visto por jogadores e
//    coerente com o "16:00 hora do servidor" dos ficheiros do cliente.
// Os dois podem ser acertados nas definições se o jogo disser outra coisa.
//
// Serve o Node (require) e o renderer (<script> clássico → window.Temporizadores).

(function (raiz) {
  'use strict';

  const REGIOES = [
    { id: 'eu', nome: 'Europa', tz: 'Europe/Paris' },
    { id: 'na-e', nome: 'América do Norte (Este)', tz: 'America/New_York' },
    { id: 'na-w', nome: 'América do Norte (Oeste)', tz: 'America/Los_Angeles' },
    { id: 'sa', nome: 'América do Sul', tz: 'America/Sao_Paulo' },
    { id: 'jp', nome: 'Japão', tz: 'Asia/Tokyo' },
  ];

  const CATEGORIAS = {
    reset: 'Resets',
    evento: 'Eventos',
    chefe: 'Chefes de campo',
    abismo: 'Abismo e PvP',
  };

  // dias: 0 = domingo … 6 = sábado (como o Date). Sem `dias` = todos os dias.
  // `cada` em minutos a partir de `inicio`, dentro de cada dia.
  // `utc: true` = a hora é UTC, igual em todas as regiões.
  // `duracao` em minutos, só onde se sabe; sem ela o evento só tem início.
  // certeza: 'alta' (3+ fontes), 'media' (ficheiros do cliente ou 2 fontes), 'baixa'.
  const EVENTOS = [
    { id: 'reset-dia', cat: 'reset', nome: 'Reset diário', horas: ['07:00'], utc: true, certeza: 'media',
      nota: 'Missões diárias, Pesadelo, chave da Invasão Dimensional, Missões de Serviço.' },
    { id: 'reset-semana', cat: 'reset', nome: 'Reset semanal', horas: ['07:00'], dias: [3], utc: true, certeza: 'media',
      nota: 'Santuários, Provação da Ascensão, Fissura Desconhecida, tempo do Abismo, Subjugação.' },
    { id: 'manutencao', cat: 'reset', nome: 'Manutenção semanal', horas: ['06:30'], dias: [3], utc: true, duracao: 210, certeza: 'baixa',
      nota: 'Visto em out. 2026 (~3 h 30). A NC anuncia cada uma no Steam; a hora pode mudar.' },

    { id: 'shugo', cat: 'evento', nome: 'Festival Shugo', horas: ['00:00'], cada: 60, duracao: 8, certeza: 'alta',
      nota: 'Verteron e Altgard. 3 min de sala de espera e uma ronda de 3 a 5 min.' },
    { id: 'invasao', cat: 'evento', nome: 'Invasão Dimensional', horas: ['00:30'], cada: 60, duracao: 13, certeza: 'alta',
      nota: '3 min de sala de espera e uma ronda de 10 min.' },
    { id: 'fenda', cat: 'evento', nome: 'Fenda Espaço-Tempo', horas: ['02:00'], cada: 180, duracao: 60, certeza: 'media',
      nota: 'Verteron, Eltnen, Altgard e Morheim. O portal fica aberto ~10 min. Um site diz que no Global é às 00, 03, 06…' },
    { id: 'arena-taticas', cat: 'abismo', nome: 'Arena das Táticas', horas: ['11:00', '19:00'], certeza: 'baixa',
      nota: 'Só uma fonte.' },

    { id: 'cerco', cat: 'abismo', nome: 'Cerco dos Artefactos', horas: ['21:00'], dias: [1, 4, 6], certeza: 'media',
      nota: 'Reshanta Inferior (caótica), nível 45+.' },
    { id: 'kaira-vigia', cat: 'chefe', nome: 'Vigia Kaira', horas: ['01:00'], cada: 180, certeza: 'media',
      nota: 'Reshanta Inferior.' },
    { id: 'executores', cat: 'chefe', nome: 'Executores (Tamasa, Kaira, Argo)', horas: ['21:30'], dias: [1, 4, 6], certeza: 'media',
      nota: 'Reshanta Inferior.' },
    { id: 'executores-medio', cat: 'chefe', nome: 'Ducal, Marakha e Dramos', horas: ['21:30'], dias: [1, 4, 6], certeza: 'media',
      nota: 'Reshanta Média: Ducal o Traidor, Marakha o Devastador, Dramos o Executor.' },
    { id: 'nahma', cat: 'chefe', nome: 'Senhor Guardião Nahma', horas: ['21:00'], dias: [0, 5], certeza: 'media',
      nota: 'Reshanta Inferior; o Nahma Enfurecido aparece à mesma hora na Média.' },
  ];

  // Cargas que o jogo vai enchendo. `cada` em minutos; `ancora` = uma hora (UTC,
  // "HH:MM") em que se sabe que cai uma carga. Diário/semanal ancoram no reset.
  // Onde a âncora é estimada, o utilizador acerta com o "próxima carga em" do jogo.
  const CARGAS = [
    { id: 'odyle', nome: 'Energia Odyle', mais: 15, cada: 180, max: 560, ancora: '01:00', estimada: true, certeza: 'alta',
      nota: '+15 a cada 3 h, até 560 (840 com Membership). Enche com o jogo fechado.' },
    { id: 'conquista', nome: 'Conquista (expedição)', mais: 1, cada: 480, max: 21, ancora: '07:00', estimada: true, certeza: 'alta',
      nota: 'Recompensas: +1 a cada 8 h, até 21.' },
    { id: 'transcendencia', nome: 'Transcendência', mais: 1, cada: 720, max: 14, ancora: '02:00', estimada: true, certeza: 'alta',
      nota: 'Recompensas: +1 a cada 12 h, até 14. Abre com nível de item 1600.' },
    { id: 'pesadelo', nome: 'Pesadelo', mais: 2, cada: 'dia', max: 14, certeza: 'alta',
      nota: '+2 por dia, até 14. Gasta-se ao acabar, não ao entrar.' },
    { id: 'chave-invasao', nome: 'Chave da Invasão Dimensional', mais: 1, cada: 'dia', max: 7, certeza: 'alta',
      nota: '+1 por dia, até 7. Por servidor.' },
    { id: 'chave-shugo', nome: 'Chave do Festival Shugo', mais: 3, cada: 'dia', max: 12, certeza: 'baixa',
      nota: 'As fontes não batem: 3/dia até 12 (21 com Membership) é o mais citado; há quem diga 4 até 28.' },
    { id: 'santuario', nome: 'Santuários (raids)', mais: 4, cada: 'semana', max: 4, repor: true, certeza: 'alta',
      nota: '4 por semana em cada: Forja Abissal, Cálice de Muspel, Instalação de Descontaminação.' },
    { id: 'ascensao', nome: 'Provação da Ascensão', mais: 3, cada: 'semana', max: 3, repor: true, certeza: 'alta',
      nota: '3 entradas por semana, por personagem.' },
    { id: 'fissura', nome: 'Fissura Desconhecida', mais: 14, cada: 'semana', max: 14, repor: true, certeza: 'alta',
      nota: 'Masmorra diária: 14 por semana, por servidor. Só repõe à quarta.' },
    { id: 'subjugacao', nome: 'Bilhetes de Subjugação', mais: 3, cada: 'semana', max: 3, repor: true, certeza: 'media',
      nota: '3 por semana.' },
  ];

  const MIN = 60e3;
  const DIA = 1440 * MIN;

  // ── fusos horários ─────────────────────────────────────────────────────────

  const formatadores = new Map();
  function partes(ms, tz) {
    let f = formatadores.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      formatadores.set(tz, f);
    }
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
    return {
      y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second,
      dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    };
  }

  /** Quantos minutos o fuso está à frente do UTC nesse instante. */
  function desvio(ms, tz) {
    const p = partes(ms, tz);
    return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000) / MIN);
  }

  /** A hora "y-m-d hh:mm" no fuso tz, em ms UTC. Duas passagens por causa da mudança de hora. */
  function deZona(y, m, d, hh, mm, tz) {
    const ingenuo = Date.UTC(y, m - 1, d, hh, mm);
    let ms = ingenuo - desvio(ingenuo, tz) * MIN;
    ms = ingenuo - desvio(ms, tz) * MIN;
    return ms;
  }

  function hm(s) {
    const [h, m] = String(s).split(':').map(Number);
    return h * 60 + (m || 0);
  }

  /** As horas do dia (em minutos) em que o evento começa. */
  function horasDoDia(ev) {
    const out = [];
    for (const h of ev.horas) {
      const ini = hm(h);
      if (!ev.cada) out.push(ini);
      else for (let t = ini % ev.cada; t < 1440; t += ev.cada) out.push(t);
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }

  /**
   * As próximas `n` vezes do evento, como { inicio, fim } em ms UTC. Inclui a que
   * está a decorrer agora (inicio <= agora < fim). `tz` é o relógio da região;
   * `acerto` (minutos) soma-se a tudo — é o "o jogo diz outra hora" do utilizador.
   */
  function proximas(ev, agora, tz, n = 1, acerto = 0) {
    const zona = ev.utc ? 'UTC' : tz;
    const dur = (ev.duracao || 0) * MIN;
    const minutos = horasDoDia(ev);
    const hoje = partes(agora, zona);
    const out = [];
    // Começa ontem (um evento de ontem às 23:30 pode ainda estar a decorrer).
    for (let k = -1; k < 9 && out.length < n; k++) {
      const dia = new Date(Date.UTC(hoje.y, hoje.m - 1, hoje.d + k));
      if (ev.dias && !ev.dias.includes(dia.getUTCDay())) continue;
      for (const t of minutos) {
        const inicio = deZona(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), Math.floor(t / 60), t % 60, zona) + acerto * MIN;
        const fim = inicio + dur;
        if (dur ? fim > agora : inicio > agora) out.push({ inicio, fim });
        if (out.length >= n) break;
      }
    }
    return out;
  }

  // ── cargas ────────────────────────────────────────────────────────────────

  function passo(c) {
    if (c.cada === 'dia') return DIA;
    if (c.cada === 'semana') return 7 * DIA;
    return c.cada * MIN;
  }

  /** Um instante em que cai uma carga (ms UTC). `acertos.reset` mexe nos diários/semanais. */
  function ancoraDe(c, acertos = {}) {
    const reset = (acertos.reset || 0) * MIN;
    if (c.cada === 'dia') return Date.UTC(2026, 0, 1, 7, 0) + reset;
    if (c.cada === 'semana') return Date.UTC(2026, 0, 7, 7, 0) + reset; // 7 jan. 2026 foi uma quarta
    if (acertos[c.id] != null) return acertos[c.id];
    return Date.UTC(2026, 0, 1) + hm(c.ancora) * MIN;
  }

  /** A primeira carga que cai depois de `t`. */
  function proximaCarga(c, t, acertos) {
    const p = passo(c);
    const a = ancoraDe(c, acertos);
    return a + (Math.floor((t - a) / p) + 1) * p;
  }

  /**
   * Quanto há agora, a partir do que o utilizador escreveu (`valor` no instante
   * `em`). Sem registo, ninguém sabe: devolve valor null. Os semanais com
   * `repor` voltam ao máximo no reset (não se acumulam).
   */
  function estadoCarga(c, registo, agora, acertos) {
    const prox = proximaCarga(c, agora, acertos);
    if (!registo || registo.valor == null) return { valor: null, proxima: prox, cheio: null };
    let v = Math.max(0, Math.min(c.max, registo.valor));
    let t = proximaCarga(c, registo.em, acertos);
    const p = passo(c);
    // Avança de carga em carga (no máximo umas centenas: 560/15 da Odyle).
    while (t <= agora && v < c.max) {
      v = c.repor ? c.max : Math.min(c.max, v + c.mais);
      t += p;
    }
    if (v >= c.max) return { valor: c.max, proxima: prox, cheio: true };
    const faltam = Math.ceil((c.max - v) / c.mais);
    return { valor: v, proxima: prox, cheio: c.repor ? prox : prox + (faltam - 1) * p };
  }

  // ── texto ─────────────────────────────────────────────────────────────────

  /** "2 d 3 h", "1 h 05 min", "4 min 09 s". */
  function falta(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (x) => String(x).padStart(2, '0');
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${pad(m)} min`;
    return `${m} min ${pad(s % 60)} s`;
  }

  function regiao(id) {
    return REGIOES.find((r) => r.id === id) || REGIOES[0];
  }

  const api = {
    REGIOES, CATEGORIAS, EVENTOS, CARGAS,
    partes, desvio, deZona, horasDoDia, proximas, proximaCarga, estadoCarga, falta, regiao,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Temporizadores = api;
})(typeof self !== 'undefined' ? self : this);
