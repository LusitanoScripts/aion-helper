# Aion Helper

*[English](README.md) · Português*

Companheiro para o **Aion 2** (Global): preços do mercado por servidor, com os nomes e os ícones em português, o valor da tua mochila lido do ecrã, base de dados de itens, fichas de personagem, builds de habilidades e planeador Daevanion.

**Usar:** descarrega `Aion-Helper-<versão>-portable.exe` da [página de Releases](https://github.com/LusitanoScripts/aion-helper/releases/latest). É a **versão portable**: um só ficheiro, abre-se com duplo clique e **não instala nada no PC**. As definições, notas e builds ficam em `%APPDATA%\aion-helper`.
**Desenvolver:** duplo clique em `Aion Helper.bat`. O `.exe` gera-se com `npm run dist`.

App de fãs, sem ligação à NCSoft. Não toca no jogo: só vê o ecrã e mostra uma janela por cima.

## De onde vêm os dados

| O quê | Origem | Notas |
|---|---|---|
| Preços, histórico, profundidade | [aion2.exchange](https://aion2.exchange/) (`/api`, aberto) | Recolhe de 15 em 15 min. Projeto de uma pessoa só; quando falha, a app mostra os preços guardados e avisa. |
| Nome em português, ícone, raridade | Site oficial da NC (`aion2.plaync.com/pt-br/api/gameconst/item`) | Um pedido por item (~0,2 s). Guardado 30 dias. |
| Habilidades das classes, personagens | Site oficial da NC (`/api/character/equipment`, `api-search.plaync.com`) | Catálogo de cada classe guardado 7 dias. |
| Tabuleiros Daevanion, fichas de personagem | Site oficial da NC (`/api/character/info`, `/daevanion/detail`, `/equipment/item`) | Tabuleiros de cada classe guardados 7 dias. |
| Lista de todos os itens | Dicionário oficial de Taiwan (`tw.ncsoft.com/aion2_tw/v2.0/dict/search/item`) + ficha global | Gerada uma vez por `node scripts/gerar-itens.js` para `src/dados/itens.json`, que vai dentro da app. |

As duas fontes ligam-se pelo **id do item**, nunca pelo nome.

## O que o "Valor" quer dizer

- **VENDIDO**: o preço médio das vendas reais. Só existe num servidor (Kaisinel EU, Elyos).
- **PEDIDO**: o anúncio mais barato nesse momento. É o que há nos outros 97 servidores, e pode ser lixo (anúncios a 10 M de um item que vale 1 K). Os casos suspeitos levam ⚠.
- **Referência (72 h)**, no detalhe: a mediana do anúncio mais barato hora a hora. Um anúncio isolado não a consegue puxar. É o número em que se pode confiar.
- **Recebes**: o valor menos a taxa de 8% do mercado.

## Mochila

Abre o **Cubo** no jogo, e na aba Mochila carrega em **Ler a mochila**. A app esconde-se, tira uma foto de cada ecrã e volta.

- **Onde está a mochila**: a app encontra-a sozinha pelos números das pilhas (algarismos com forma fixa, sempre no mesmo canto da casa). Não precisa de calibração, mas precisa de pelo menos 2 pilhas com número à vista.
- **Quantidades**: comparadas com moldes dos algarismos do jogo (`src/moldes-1440.json`), não com OCR. O OCR do Windows lia "381,3K" como "381r3K".
- **Que item é**: pelo ícone, comparado com os ícones oficiais dos itens do mercado. Só aceita um item com diferença ≤ 15 e margem ≥ 5 sobre o segundo candidato. O resto fica "fora do mercado", que é onde caem os itens vinculados.
- **Só 2560×1440 por agora.** As medidas (casas de 65 px a cada 71,25 × 74, algarismos de 10 px) são dessa resolução. Noutra resolução, a app diz que não encontrou a mochila.
- A última foto lida fica em `%APPDATA%\aion-helper\ultima-mochila.png`, para se perceber uma leitura que saia mal.

## Preço e nota por baixo do cartão do item

**Automático** (ligado por omissão; interruptor "automático" na barra das abas): sempre que o jogo abre o cartão de um item, aparece por baixo dele uma faixa com o preço (média vendida, referência de 72 h ou o anúncio mais barato, e diz qual dos três é), o que recebes depois da taxa, e a tua nota, se houver. Quando o cartão fecha, a faixa vai-se. A faixa não apanha cliques.

- A vigia corre 4 vezes por segundo, mas só trabalha com o **AION2.exe à frente**: copia a janela do jogo e procura o rodapé dos cartões em C# (~60–90 ms). Com o jogo atrás custa ~10 ms e não copia nada. O OCR só corre quando aparece um cartão novo, e só na coluna desse cartão.
- "Sem preço conhecido" quer dizer que o aion2.exchange não segue o item (segue ~500), e não que o item não se vende.
- **Ctrl+Alt+P** continua a existir, para ler à mão quando o automático está desligado. Nesse caso a faixa desaparece ao fim de 12 s.

- **Ctrl+Alt+N** abre a app na aba Notas, com o nome do último cartão lido. As notas guardam-se pelo nome, por isso também funcionam em itens vinculados (que não estão no mercado e não têm preço).
- **Não toca no jogo.** Escrever dentro do cartão obrigava a mexer nos ficheiros ou na memória do jogo, o que o anti-cheat apanha. Isto é uma janela da app por cima do jogo, como qualquer overlay.
- O jogo tem de estar em **janela sem bordas**: em ecrã inteiro exclusivo, nenhuma janela fica por cima.
- O nome lê-se com o OCR do Windows (`src/ocr.ps1`, sempre aberto). O cartão reconhece-se pela linha da raridade ("Raro Botas", "Comum Pergaminho") logo abaixo do nome. O fundo do cartão, que é onde a faixa se cola, acha-se pela cor do rodapé (24, 27, 34) e não pelo texto, porque por baixo do cartão há nomes de jogadores.

## Builds de habilidades

Aba **Builds**: planear as habilidades de uma classe, como no QuestLog.

- **As habilidades vêm da NC.** Não há catálogo oficial, mas a ficha de qualquer personagem traz a lista inteira da classe (também as que ainda não aprendeu: 12 ativas, 13 estigmas e 10 passivas em todas as classes, a 10 Out 2026). A app procura um personagem da classe, lê-lhe a ficha e guarda o catálogo 7 dias. Nomes no idioma do jogo, ícones oficiais.
- **Barra de 4×12**: arrasta da paleta ou faz duplo clique para pôr; botão direito, duplo clique ou arrastar para fora para tirar; de casa para casa trocam. As passivas não vão para a barra.
- **Nível e especializações (◆)** no painel da direita. Os limites (nível 30, 5 ◆) não estão confirmados no jogo: são folgados de propósito.
- **Prioridade** (ativas, estigmas, passivas) e **macros** em texto, mais notas livres.
- **Do meu personagem**: procura o nome na região escolhida e lê da ficha oficial o nível de cada habilidade e os estigmas equipados. A ficha não diz as especializações nem a barra.
- **Partilhar** copia um código `AH1:…` (cerca de 300 caracteres); **Colar código** abre-o noutra app. O código só leva ids, por isso abre com os nomes no idioma de quem o cola.
- Guardadas em `%APPDATA%\aion-helper\builds.json`.

## Itens

Aba **Itens**: todos os itens que existem no Global, procurados pelo nome (português ou inglês) ou pelo número, com filtros de categoria, raridade, classe e "só transacionáveis". O detalhe (atributos, pedras, onde se obtém, aparência) vem da ficha oficial, no encantamento escolhido. Se o item estiver no mercado do servidor escolhido em Preços, mostra também o preço.

- O Global não tem lista de itens. Taiwan tem um dicionário com ~11 000; os números são os mesmos, mas Taiwan vai à frente: a 10 Out 2026 existiam no Global 8 139 de 11 051 (74%). `scripts/gerar-itens.js` percorre o dicionário de Taiwan categoria a categoria (50 por página, máximo 10 000 por pesquisa), pede a ficha global de cada um em pt-BR e en-US (~1 h, retoma onde parou) e guarda só os que o Global conhece.
- Há nomes repetidos de propósito: o jogo tem a versão vinculada e a transacionável do mesmo item, com números diferentes.
- Correr outra vez depois de cada atualização grande do jogo.

## Personagem

Aba **Personagem**: procurar alguém pelo nome (numa das 5 regiões do Global) e ver a ficha oficial: poder de combate, nível de item, atributos, equipamento (clica numa peça para ver atributos, encantamento e pedras), asas, mascote, títulos, habilidades e os tabuleiros Daevanion com a soma do que dão. **Criar build com isto** faz uma build com a classe, os níveis das habilidades, os estigmas equipados e o Daevanion.

## Daevanion

Dentro de cada build, sub-aba **Daevanion**: os 5 tabuleiros da classe (tirados da ficha de um personagem dessa classe, guardados 7 dias). Abre-se um nó clicando nele quando está junto de um aberto, como no jogo; fechar um nó fecha também os que ficavam desligados do início. Ao lado, a soma dos atributos e dos níveis de habilidade de todos os tabuleiros. "Do meu personagem" também lê o Daevanion.

## Outras coisas que a app faz

- **Loja ou mercado.** A faixa lê o preço que a loja paga (o número no canto do rodapé do cartão, "92" ou "10(680)" numa pilha) e compara-o com o que recebes no mercado depois da taxa. Só aconselha o mercado se ganhares 10% ou mais. Os preços da loja ficam guardados por nome, e a Mochila usa-os na coluna Loja.
- **Kinah.** A moeda prateada da mochila conta-se à parte. É a mesma moeda que aparece ao lado do preço da loja.
- **Alertas de preço.** No detalhe de um item: "avisa-me quando estiver a X ou menos neste servidor". A app verifica de 15 em 15 minutos e mostra uma notificação do Windows, uma vez por descida.
- **Idioma do jogo** (Definições): português, inglês, alemão, espanhol, francês ou japonês. Muda os nomes e o idioma do OCR. Se o Windows não tiver o OCR desse idioma, a app avisa (o japonês precisa do pacote de idioma).
- **Servidores de reserva** (Definições): quando o teu servidor não tem anúncios de um item, a app usa o preço de outro servidor e diz qual. Sem nada marcado, usa o maior da tua região e fação.
- **Guardar diagnóstico** (Definições): junta numa pasta as últimas capturas, o que a app leu e os erros, para mandares a quem te está a ajudar.

## Resoluções

Tudo foi medido a **2560×1440**. Noutras resoluções a app leva a imagem à escala de 1440p antes de ler a mochila, e mede os cartões pela largura do rodapé. Só foi testado com versões sintéticas das capturas: a 4K acerta 35 de 35 quantidades, a 1600p 32, a 1200p 33 e a 1080p 27. Nenhum item foi mal identificado. A Mochila marca a leitura como "resolução experimental". Para afinar, falta uma captura verdadeira a 1080p.

## Testes

```
npm test           # contas, fontes, quantidades e mochila nas capturas reais (e em resoluções sintéticas), cartões, vigia, alertas, o olho em C#, âmbito dos scripts
npm run selftest   # contra os dados reais (precisa de rede)
```

Captura para verificar a interface sem ninguém a olhar:
`AION_CAPTURA=c:\caminho\cap.png` antes de arrancar o Electron. A app abre, clica no item com mais anúncios, guarda a imagem e fecha. Com `AION_MOCHILA=c:\caminho\captura.png` também definido, abre a aba Mochila e lê essa imagem.

## Licença

Código à vista, não código aberto (ver `LICENSE`). Podes usar a app, partilhar o executável oficial sem alterações, ler o código e mandar contribuições. Não podes distribuir versões modificadas, tirar a autoria ou os créditos, nem vender a app.

O executável é selado com as *fuses* do Electron. Uma cópia com o `app.asar` mexido (por exemplo, com outro nome no lugar de "by LusitanoScripts") recusa arrancar: "Integrity check failed for asar archive". O `scripts/test-autoria.js` falha se a autoria, os créditos ou a selagem desaparecerem.

As capturas em `scripts/amostras/` são do jogo, com tudo o que não são cartões nem a mochila tapado a preto (havia nomes de outros jogadores).

---
App de fãs. Sem ligação à NCSoft.
