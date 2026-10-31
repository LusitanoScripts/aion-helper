# Medidor de DPS — desenho

31 Out 2026. Estado: aprovado na conversa; o leitor da janela está à espera de capturas.

## Objetivo

Guardar e comparar o **dano do próprio jogador**, lido da janela oficial do jogo
"Análise de combate" (Ctrl+X no jogo). A janela oficial mede, mas não guarda nada.
Com isto passa a haver histórico de lutas, curva de DPS e comparação entre tentativas e builds.

## Fora do âmbito (decidido)

- **Ler a rede do jogo (pacotes)** — é assim que o bufftool/LagoFast mostra o dano do grupo.
  Há bans relatados e avisos da NC; a app promete não intercetar a rede. Não se faz.
- Dano e buffs dos outros membros do grupo (só existem nos pacotes).
- Escrever no jogo, clicar ou carregar teclas no lugar do jogador.

## Leitura

- `Ctrl+Alt+D` liga/desliga; também em Definições e `POST /medidor` no controlo local
  (com `X-Aion-Helper: 1`, como os outros). Estado em `defs.medidor {ligado}`, fica entre arranques.
- Só com **AION2.exe à frente** (`ocr.ver('AION2')`, como a coleção de mascotes).
- **Achar a janela**: OCR do ecrã do jogo à procura do título ("Combat Analysis",
  "Análise de combate", e outros idiomas do jogo). Guarda o retângulo da janela em px do ecrã.
  De 3 em 3 s enquanto não a acha.
- **Ler**: `ocr.lerZona` só desse retângulo, 1×/s. Se o título deixar de aparecer em 3 leituras
  seguidas, volta a procurar (janela fechada ou mudada de sítio).
- Linhas do próprio aviso/janelas da app são ignoradas (como `ignorar()` da VigiaMascotes).

## `src/medidor.js` (partilhado, só contas, sem Electron)

- `lerJanela(linhasOcr) → {alvo, tempo, total, dps, habilidades[] | null}`
  - números do jogo: "79,72K", "1.42M", "314,6K" → número (vírgula ou ponto decimal, K/M/B).
  - tempo "00:40" → segundos.
  - habilidades só no modo detalhado: `{nome, dano, pct, acertos, critico}`; campos que o OCR
    não leia ficam `null` (nunca inventados).
  - **A geometria e os rótulos exatos dependem das capturas** (ver "Falta").
- `class Luta` — máquina de estados alimentada a cada leitura:
  - começa quando `tempo` > 0 e muda, ou `total` sobe a partir de 0;
  - acaba quando o total não mexe durante 5 s, quando o tempo volta a 0, ou quando o alvo muda;
  - guarda `curva: [[segundo, total]]` (1 ponto por leitura), e a última tabela de habilidades;
  - leituras incoerentes (total a descer sem reset, salto > 50× a mediana) são descartadas.
- `resumo(luta)` → DPS médio, pico de DPS em janela de 5 s, duração.

## Gravação

- `userData/lutas.json`: `{versao:1, lutas:[...]}`, máx. **500** (as mais antigas saem).
- Luta: `{id, personagem, alvo, inicio (ISO), duracao, total, dps, picoDps, curva, habilidades, build}`.
  `build` = nome da build ativa nas Builds, se houver.
- Lutas com menos de 5 s ou total 0 não se gravam.

## Aba "Combate" (renderer/js/combate.js)

- Estado do medidor (ligado / à procura da janela / a ler / luta em curso com total ao vivo).
- Lista de lutas: data, alvo, duração, total, DPS; filtro por alvo; melhor DPS por alvo destacado.
- Detalhe: curva (SVG próprio, sem biblioteca), tabela de habilidades se houver.
- Comparar 2 lutas: totais/DPS lado a lado com diferença em %, curvas sobrepostas, habilidades em comum.
- Apagar luta, renomear alvo (o OCR pode falhar o nome).

## Testes

- `scripts/test-medidor.js` no `npm test`:
  - números ("79,72K", "1.42M", "35,49%"), tempos;
  - `lerJanela` sobre `scripts/amostras/medidor-*.ocr.json` (OCR real das capturas);
  - `Luta`: sequências sintéticas (começo, fim por paragem, reset, alvo novo, leitura lixo).
- Visual: `AION_ABA=combate AION_CAPTURA=out.png` com lutas de exemplo.

## Falta (bloqueia o `lerJanela`)

Capturas a 1440p da janela Ctrl+X:
1. modo simples durante uma luta;
2. modo detalhado com a lista de habilidades;
3. a janela parada no fim da luta.

O que já se vê numa imagem de vídeo (modo simples): título "Análise de co…", "Ctrl + X",
"Medição: Espantalho de Treinamento 00:00", "Danos totales 79,72K (79,72K)".
