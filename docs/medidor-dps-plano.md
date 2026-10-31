# Medidor de DPS — plano de implementação

**Goal:** guardar e comparar o dano do próprio jogador, lido pelo ecrã da janela oficial "Análise de combate" (Ctrl+X no jogo).

**Architecture:** `src/medidor.js` (só contas: números, leitura da janela a partir de linhas de OCR, máquina de estados da luta) + `src/lutas.js` (gravação em `userData/lutas.json`) + vigia em `main.js` igual à dos cubos (`ocr.janela`/`ocr.lerZona`, `setTimeout` em volta) + aba "Combate" no renderer.

**Tech Stack:** Electron, JS vanilla, OCR do Windows via `src/ocr.ps1`, testes `node scripts/test-*.js` sem framework (assert do Node).

**Spec:** [docs/medidor-dps.md](medidor-dps.md)

## Global Constraints

- Nada de ler a rede, a memória ou os ficheiros do jogo; nada de input no jogo. Só píxeis/OCR do ecrã.
- Só lê com **AION2** à frente.
- Atalho `Control+Alt+D`; controlo local `POST /medidor` (exige `X-Aion-Helper: 1`, como os outros).
- `defs.medidor = { ligado }`, fica entre arranques; no modo `AION_CAPTURA` não liga sozinho.
- Fim da luta: total parado **5 s**, tempo volta a 0, ou alvo muda. Lutas com duração < 5 s ou total 0 não se gravam.
- Máximo **500** lutas em `userData/lutas.json` (`{versao:1, lutas:[]}`), as mais antigas saem.
- Valores que o OCR não leia ficam `null`, nunca inventados.
- Interface só em português.
- Desvio do spec: não há "build ativa" nas Builds → o campo `build` é uma **etiqueta escrita à mão** no detalhe da luta (`null` por omissão). Personagem = `defs.mascotes?.atual || null`.

## Review Focus

1. **Números com separadores do idioma** ("1.234,5K", "79,72K", "1.42M", "1,42M") — o número certo, não ×1000 a mais. → Task 1, `numero`.
2. **Janela fechada a meio da luta** — a luta é fechada e gravada com o que havia, não perdida. → Task 4, `Luta.ler(null)` termina.
3. **OCR lê lixo uma vez** (total salta ou desce sem reset) — ignora a leitura, a luta continua. → Task 1.
4. **`lutas.json` corrompido ou de outra versão** — começa vazio, sem rebentar a app, e não apaga o ficheiro mau (renomeia para `.mau`). → Task 2.
5. **App fechada com luta em curso** — a luta é gravada no `before-quit`. → Task 4.

---

### Task 1: números, tempo e a máquina da luta (`src/medidor.js`)

**Files:** Create `src/medidor.js`, `scripts/test-medidor.js`; Modify `package.json` (acrescentar `node scripts/test-medidor.js` antes de `check-globals`).

**Interfaces (Produces):**
- `numero(txt: string) → number|null` — "79,72K"→79720, "1.42M"→1420000, "1.234,5K"→1234500, "35,49%"→35.49, "300"→300, lixo→null. Último separador seguido de 1–2 algarismos = decimal; os outros são milhares. Sufixos K/M/B (maiúsc./minúsc.).
- `tempo(txt) → segundos|null` — "00:40"→40, "1:02:03"→3723, "0040" (OCR sem dois pontos) →40.
- `class Luta { constructor(agora=Date.now) ; ler(leitura|null, t) → {estado:'parada'|'a decorrer', terminou: LutaFeita|null} ; fechar(t) → LutaFeita|null }`
  - `leitura = {alvo, tempo, total, dps, habilidades}` (de `lerJanela`, Task 3).
  - `LutaFeita = {alvo, inicio (ISO), duracao (s), total, dps, picoDps, curva:[[s,total]], habilidades}`.
  - descarta leitura com total a descer sem tempo a 0, ou subida > 50× a mediana dos saltos (com ≥3 saltos).
- `resumo(curva) → {duracao, dps, picoDps}` — pico = maior (Δtotal/Δs) numa janela de 5 s.
- Exporta também para o renderer como `pricing.js`/`daevanion.js` fazem (`window.Medidor`).

- [ ] Testes: `numero` com os 7 casos acima; `tempo` com os 3; `Luta`: (a) tempo 0→1→…→20 com total a subir, depois 6 s parado → `terminou` com duracao 20 e total final; (b) tempo volta a 0 → termina; (c) alvo muda → termina a anterior e começa outra; (d) uma leitura com total ×100 no meio → ignorada, curva sem ela; (e) luta de 3 s → `terminou` null; (f) `ler(null)` com luta a decorrer → termina; `resumo` de uma curva conhecida.
- [ ] `node scripts/test-medidor.js` → falha (módulo não existe).
- [ ] Implementar.
- [ ] `npm test` → tudo OK.

### Task 2: gravação (`src/lutas.js`)

**Files:** Create `src/lutas.js`; Modify `scripts/test-medidor.js`.

**Interfaces (Produces):** `class Lutas { constructor(ficheiro) ; todas(personagem?) → Luta[] (mais recente primeiro) ; adicionar(lutaFeita, {personagem}) → Luta|null ; mudar(id, {alvo?, build?}) → Luta|null ; apagar(id) → bool }` — `Luta = LutaFeita + {id, personagem, build:null}`. Escrita atómica (tmp + rename). Duração < 5 ou total 0 → `null`, não grava.

- [ ] Testes (pasta temporária): adicionar/ler de volta depois de nova instância; 501 lutas → 500, sai a mais antiga; curta não grava; `mudar` e `apagar`; ficheiro com lixo → vazio e existe `lutas.json.mau`.
- [ ] Falha → implementar → `npm test` OK.

### Task 3: ler a janela (`lerJanela`, `acharJanela`) — **BLOQUEADA até às capturas**

**Files:** Modify `src/medidor.js`, `scripts/test-medidor.js`; Create `scripts/amostras/medidor-simples.png|.ocr.json`, `medidor-detalhado.*`, `medidor-fim.*` (nomes de outros jogadores tapados a preto antes de gravar).

**Interfaces (Produces):**
- `acharJanela(linhas) → [x,y,w,h]|null` — título "Combat Analysis"/"Análise de combate"/"Análisis de combate"/"Kampfanalyse"/"Analyse de combat", tolerante a OCR e ao corte ("Análise de co…"); retângulo a partir do título e da altura de linha.
- `lerJanela(linhas) → {alvo, tempo, total, dps, habilidades: [{nome,dano,pct,acertos,critico}]|null}|null`.
- Geometria e rótulos: **decididos com as capturas**. Hoje só se sabe (vídeo, modo simples): "Medição: <alvo> 00:00", "Danos totales 79,72K (79,72K)".

- [ ] Gerar `.ocr.json` com `ocr.ler` sobre cada captura; testes que exigem alvo/tempo/total exatos e, no detalhado, ≥ 80% das habilidades com nome e dano certos.
- [ ] Falha → implementar → `npm test` OK.

### Task 4: vigia no `main.js`

**Files:** Modify `main.js`, `preload.js`, `src/settings.js` (`medidor: null, // { ligado }`).

**Interfaces:** consome Tasks 1–3. Produz IPC `medidor:estado` (handle + evento), `medidor:ligar(on)`, `lutas:todas`, `lutas:mudar(id, alt)`, `lutas:apagar(id)`, evento `lutas:nova`; preload `medidor()`, `ligarMedidor(on)`, `aoMudarMedidor(cb)`, `lutas()`, `mudarLuta(id,alt)`, `apagarLuta(id)`, `aoNovaLuta(cb)`.
- `estadoMedidor() → {ligado, fase:'desligado'|'sem jogo'|'à procura'|'a ler'|'em luta', alvo, total, dps, atalho}`.
- Volta: `ocr.janela('AION2')`; sem jogo → `luta.ler(null)`. Sem retângulo → de 3 em 3 s `ocr.lerZona` do jogo inteiro + `acharJanela` (filtrando linhas dentro das janelas da app, como as mascotes). Com retângulo → 1×/s `lerZona` dele + `lerJanela`; 3 falhas seguidas → esquece o retângulo. Cada `terminou` → `lutas.adicionar` + `enviar('lutas:nova')`. Aviso `avisoMascote('Medidor de DPS ligado · Ctrl+Alt+D desliga', …)` ao ligar.
- `before-quit` → `luta.fechar()` e grava.

- [ ] Arrancar com `env -u ELECTRON_RUN_AS_NODE npx electron .` sem jogo: Ctrl+Alt+D liga/desliga, `estado` diz "sem jogo", `POST /medidor` com e sem cabeçalho (200/403).
- [ ] `npm test` OK.

### Task 5: aba "Combate" + Definições

**Files:** Create `renderer/js/combate.js`; Modify `renderer/index.html` (botão `data-aba="combate"` depois de Temporizadores, `<main id="combate" class="aba" hidden>`, interruptor nas Definições), `renderer/css/style.css`, `renderer/js/definicoes.js`, `main.js` (amostras de lutas no modo `AION_CAPTURA`).

- Cabeçalho: estado do medidor ao vivo + interruptor + atalho.
- Lista: data, alvo, duração, total, DPS; filtro por alvo; ★ no melhor DPS por alvo.
- Detalhe: curva em SVG (DPS por segundo, média móvel de 3 s), tabela de habilidades se houver, editar alvo/etiqueta, apagar (confirmação dentro da página, sem `confirm()`).
- Comparar: marcar 2 → totais/DPS lado a lado com Δ%, as 2 curvas sobrepostas, habilidades em comum.

- [ ] `AION_ABA=combate AION_CAPTURA=out.png` com 6 lutas de exemplo → ver a imagem (lista, detalhe e comparar via `AION_JS`).
- [ ] `npm test` OK (inclui `check-globals`).
- [ ] Versão nova: subir `version`, `npm run dist`, atualizar instalada + portable no Desktop (como nas versões anteriores).

## Ordem

Tasks 1, 2, 4 (sem a leitura) e 5 não precisam das capturas. A Task 3 entra quando chegarem; até lá `acharJanela`/`lerJanela` devolvem `null`, a vigia fica em "à procura" e a aba mostra "à espera de suporte para esta janela".
