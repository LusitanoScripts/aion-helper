'use strict';

// Contas dos temporizadores: fusos, mudança de hora, eventos a decorrer, cargas.

const T = require('../src/temporizadores');

let falhas = 0;
function igual(real, esperado, msg) {
  if (real !== esperado) {
    console.error(`✗ ${msg}: deu ${real}, esperava ${esperado}`);
    falhas++;
  }
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const ev = (id) => T.EVENTOS.find((e) => e.id === id);
const carga = (id) => T.CARGAS.find((c) => c.id === id);

// Domingo 11 out. 2026, 18:44 UTC (20:44 em Paris, verão: UTC+2).
const agora = Date.UTC(2026, 9, 11, 18, 44);

igual(T.desvio(agora, 'Europe/Paris'), 120, 'Paris no verão');
igual(T.desvio(Date.UTC(2026, 11, 1), 'Europe/Paris'), 60, 'Paris no inverno');
igual(iso(T.deZona(2026, 10, 11, 21, 0, 'Europe/Paris')), '2026-10-11T19:00', '21:00 em Paris');
// Mudança de hora na Europa: 25 out. 2026, 03:00 → 02:00.
igual(iso(T.deZona(2026, 10, 25, 21, 0, 'Europe/Paris')), '2026-10-25T20:00', 'depois da mudança de hora');

// O Nahma é ao domingo e à sexta, 21:00: hoje (domingo) às 19:00 UTC.
igual(iso(T.proximas(ev('nahma'), agora, 'Europe/Paris')[0].inicio), '2026-10-11T19:00', 'Nahma hoje');
// O cerco é seg/qui/sáb: o próximo é segunda.
igual(iso(T.proximas(ev('cerco'), agora, 'Europe/Paris')[0].inicio), '2026-10-12T19:00', 'cerco segunda');
// Em Nova Iorque (UTC-4) o cerco de segunda é 01:00 UTC de terça.
igual(iso(T.proximas(ev('cerco'), agora, 'America/New_York')[0].inicio), '2026-10-13T01:00', 'cerco NA');
// Reset diário 07:00 UTC, igual em todas as regiões.
igual(iso(T.proximas(ev('reset-dia'), agora, 'America/Los_Angeles')[0].inicio), '2026-10-12T07:00', 'reset diário');
igual(iso(T.proximas(ev('reset-semana'), agora, 'Europe/Paris')[0].inicio), '2026-10-14T07:00', 'reset semanal (quarta)');

// Festival Shugo de hora a hora, 8 min: às 20:44 em Paris o próximo é às 21:00.
const sh = T.proximas(ev('shugo'), agora, 'Europe/Paris', 3);
igual(sh.map((x) => iso(x.inicio)).join(' '), '2026-10-11T19:00 2026-10-11T20:00 2026-10-11T21:00', 'Shugo a seguir');
// Às 21:03 em Paris o das 21:00 ainda está a decorrer (fim 21:08).
igual(iso(T.proximas(ev('shugo'), Date.UTC(2026, 9, 11, 19, 3), 'Europe/Paris')[0].inicio), '2026-10-11T19:00', 'Shugo a decorrer');
// Fenda: 02, 05, … 20, 23 hora local; às 20:44 está aberta a das 20:00 (60 min).
igual(iso(T.proximas(ev('fenda'), agora, 'Europe/Paris')[0].inicio), '2026-10-11T18:00', 'fenda aberta');
igual(T.horasDoDia(ev('fenda')).length, 8, '8 fendas por dia');
// A de ontem às 23:30 que passa da meia-noite: Invasão às 23:30, 13 min.
igual(iso(T.proximas(ev('invasao'), Date.UTC(2026, 9, 11, 21, 35), 'Europe/Paris')[0].inicio), '2026-10-11T21:30', 'invasão a decorrer');
// Acerto de +60 min.
igual(iso(T.proximas(ev('nahma'), agora, 'Europe/Paris', 1, 60)[0].inicio), '2026-10-11T20:00', 'acerto de uma hora');

// Cargas. Pesadelo: +2 por dia às 07:00 UTC, até 14.
const pes = carga('pesadelo');
const reg = { valor: 4, em: Date.UTC(2026, 9, 10, 12, 0) }; // sábado 12:00 UTC
const e1 = T.estadoCarga(pes, reg, agora);
igual(e1.valor, 6, 'pesadelo depois de um reset');
igual(iso(e1.proxima), '2026-10-12T07:00', 'pesadelo próxima');
igual(iso(e1.cheio), '2026-10-15T07:00', 'pesadelo cheio (faltam 8 = 4 resets)');
igual(T.estadoCarga(pes, null, agora).valor, null, 'sem registo não se sabe');
igual(T.estadoCarga(pes, { valor: 20, em: agora }, agora).valor, 14, 'nunca passa do máximo');

// Odyle: +15 a cada 3 h a partir da 01:00 UTC.
const od = carga('odyle');
const e2 = T.estadoCarga(od, { valor: 500, em: Date.UTC(2026, 9, 11, 12, 0) }, agora);
igual(e2.valor, 530, 'odyle: 13:00 e 16:00 → +30');
igual(iso(e2.proxima), '2026-10-11T19:00', 'odyle próxima');
igual(iso(e2.cheio), '2026-10-11T22:00', 'odyle cheia (faltam 30 = 2 cargas)');
// Acerto: o jogo disse que a próxima é às 19:30.
igual(iso(T.estadoCarga(od, null, agora, { odyle: Date.UTC(2026, 9, 11, 19, 30) }).proxima), '2026-10-11T19:30', 'odyle acertada');

// Semanais repõem ao máximo à quarta.
const san = carga('santuario');
igual(T.estadoCarga(san, { valor: 1, em: agora }, Date.UTC(2026, 9, 14, 6, 0)).valor, 1, 'santuário antes do reset');
igual(T.estadoCarga(san, { valor: 1, em: agora }, Date.UTC(2026, 9, 14, 7, 1)).valor, 4, 'santuário depois do reset');

igual(T.falta(3 * 3600e3 + 5 * 60e3), '3 h 05 min', 'texto horas');
igual(T.falta(2 * 86400e3 + 3600e3), '2 d 1 h', 'texto dias');

if (falhas) process.exit(1);
console.log('test-temporizadores: tudo certo');
