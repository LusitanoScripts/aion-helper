# Aion Helper

*English · [Português](README.pt.md)*

Companion app for **Aion 2** (Global): market prices per server, the value of your inventory read from the screen, the price and your note right under each item tooltip in game, an item database, character sheets, skill builds and a Daevanion planner.

## Download

**[Get `Aion-Helper-<version>-portable.exe` from the Releases page](https://github.com/LusitanoScripts/aion-helper/releases/latest).**

It's a **portable version: a single file, nothing to install on your PC.** Double-click it and it runs. To update, just replace the `.exe`; your settings, notes and builds are kept in `%APPDATA%\aion-helper`.

The first time, Windows may show "Windows protected your PC" (the file isn't signed by a publisher). Click **More info → Run anyway**.

> **Language:** the app's interface is in **Portuguese** for now. Item names, skills and OCR follow your game language (English, German, Spanish, French, Japanese or Portuguese, set in Definições / Settings).

Fan-made app, not affiliated with NCSoft. **It doesn't touch the game**: it doesn't read memory, intercept network traffic, change files or press keys for you. It only looks at the screen, like a screenshot tool, and shows a window on top.

## Features

- **Prices** (*Preços*): market prices per server, with history, depth and price-drop alerts.
- **Inventory** (*Mochila*): open the Cube in game, click *Ler a mochila*, and the app reads quantities and items from the screen and tells you what it's worth.
- **Under the item tooltip**: whenever the game opens an item tooltip, a strip appears under it with the price, what you get after the 8% market fee, whether the vendor pays more, and your note.
- **Items** (*Itens*): 8,139 items in the Global version, searchable by name (English or Portuguese) or id, with category, grade, class and tradable filters. Details (stats, manastones, where to get it, appearance) at any enchant level.
- **Character** (*Personagem*): any player's official sheet: combat power, item level, stats, gear (click a piece for its stats and stones), wings, pet, titles, skills and Daevanion boards. *Criar build com isto* turns it into a build.
- **Builds**: 4×12 skill bar (drag and drop), skill levels and specializations (◆), priority lists, macros and notes. **Daevanion** planner with the 5 boards of each class and the sum of everything you open. Import from your character, and share a build with an `AH1:…` code.
- **Notes**: a note per item, shown under its tooltip in game (also for bound items).

The game must run in **borderless window** mode: in exclusive fullscreen no window can stay on top.

## Where the data comes from

| What | Source | Notes |
|---|---|---|
| Prices, history, depth | [aion2.exchange](https://aion2.exchange/) (`/api`, open) | Updated every 15 min. A one-person project; when it's down, the app shows the saved prices and says so. |
| Item names, icons, grades | NCSoft's official site (`aion2.plaync.com/<lang>/api/gameconst/item`) | One request per item (~0.2 s). Cached 30 days. |
| Class skills, characters | NCSoft's official site (`/api/character/equipment`, `api-search.plaync.com`) | Each class's skill list cached 7 days. |
| Daevanion boards, character sheets | NCSoft's official site (`/api/character/info`, `/daevanion/detail`, `/equipment/item`) | Each class's boards cached 7 days. |
| List of all items | NCSoft's official Taiwan dictionary (`tw.ncsoft.com/aion2_tw/v2.0/dict/search/item`) + the Global item sheet | Built once by `node scripts/gerar-itens.js` into `src/dados/itens.json`, which ships with the app. |

Sources are joined by **item id**, never by name.

## What "Value" means

- **VENDIDO** (sold): the average price of real sales. Only one server has it (Kaisinel EU, Elyos).
- **PEDIDO** (asked): the cheapest listing right now. That's all the other 97 servers have, and it can be junk (a 10 M listing for an item worth 1 K). Suspicious cases get a ⚠.
- **Reference (72 h)**, in the detail panel: the median of the cheapest listing hour by hour. A single listing can't drag it. It's the number to trust.
- **Recebes** (you get): the value minus the 8% market fee.

## Inventory reading

- **Finding the inventory**: the app finds it by the stack numbers (fixed-shape digits, always in the same corner of the slot). No calibration needed, but at least 2 stacks with a number must be visible.
- **Quantities**: matched against templates of the game's digits (`src/moldes-1440.json`), not OCR. Windows OCR read "381,3K" as "381r3K".
- **Which item**: by icon, compared with the official icons of market items. An item is accepted only with difference ≤ 15 and a margin ≥ 5 over the runner-up. The rest is "off market", which is where bound items land.
- **Measured at 2560×1440.** Other resolutions are scaled to 1440p first and marked as experimental. Synthetic tests: 4K 35/35 quantities, 1600p 32, 1200p 33, 1080p 27; no item misidentified. A real 1080p capture is still needed to tune it.
- The last image read is kept in `%APPDATA%\aion-helper\ultima-mochila.png`, to understand a bad read.

## Price and note under the item tooltip

**Automatic** (on by default; *automático* switch on the tab bar): whenever the game opens an item tooltip, a strip appears under it with the price (average sold, 72 h reference or cheapest listing, and it says which), what you get after the fee, and your note. When the tooltip closes, the strip goes away. The strip doesn't take clicks.

- The watcher runs 4 times a second, but only works with **AION2.exe in front**: it copies the game window and looks for the tooltip footer in C# (~60–90 ms). With the game in the background it costs ~10 ms and copies nothing. OCR only runs when a new tooltip appears, and only on that tooltip's column.
- "No known price" means aion2.exchange doesn't track the item (it tracks ~500), not that the item doesn't sell.
- **Ctrl+Alt+P** reads by hand when automatic is off; the strip then disappears after 12 s.
- **Ctrl+Alt+N** opens the app on the Notes tab with the last tooltip read. Notes are stored by name, so they also work for bound items.
- **Vendor or market**: the strip reads the vendor price on the tooltip footer and compares it with what you'd get on the market after the fee. It only suggests the market if you'd get 10% more or better.

## Builds and Daevanion

- **Skills come from NCSoft.** There's no official skill catalog, but any character's sheet lists the whole class (including skills not learned yet: 12 active, 13 stigma and 10 passive for every class, as of 10 Oct 2026). The app reads one character of each class and caches the list for 7 days.
- **Skill bar**: drag from the palette or double-click to add; right-click, double-click or drag off to remove; drag between slots to swap. Passives don't go on the bar.
- **Level and specializations (◆)** in the right panel. The limits (level 30, 5 ◆) aren't confirmed in game; they're generous on purpose.
- **From my character** (*Do meu personagem*): reads skill levels, equipped stigmas and the Daevanion from the official sheet. The sheet doesn't include specializations or the bar layout.
- **Share** copies an `AH1:…` code (~300 characters); **Paste code** (*Colar código*) opens it in another copy of the app. The code only carries ids, so names show in the reader's game language.
- **Daevanion**: the 5 boards of the class. A node opens when it's next to an open one, like in game; closing a node also closes the ones left disconnected from the start. The side panel sums stats and skill levels across all boards. Node point costs aren't in the official data, so the app doesn't show them.

## Items index

The Global site has no item list. Taiwan's official dictionary has ~11,000 items with the same ids, but Taiwan is ahead: on 10 Oct 2026, 8,139 of 11,051 existed in Global (74%). `scripts/gerar-itens.js` walks the Taiwan dictionary category by category (50 per page, max 10,000 per search), fetches each item's Global sheet in pt-BR and en-US (~1 h, resumes where it stopped) and keeps only the ones Global knows. Some names repeat on purpose: the game has a bound and a tradable version of the same item, with different ids. Re-run it after big game updates.

## Other settings

- **Game language** (*Idioma do jogo*): Portuguese, English, German, Spanish, French or Japanese. Changes item names and the OCR language. If Windows lacks that OCR language, the app warns you (Japanese needs the language pack).
- **Fallback servers** (*Servidores de reserva*): when your server has no listing for an item, the app uses another server's price and says which. With nothing ticked, it uses the largest server in your region and faction.
- **Save diagnostics** (*Guardar diagnóstico*): puts the latest captures, what the app read and the errors in a folder, to send to whoever is helping you.

## Development

Double-click `Aion Helper.bat` to run from source. `npm run dist` builds the portable `.exe` into `dist/`.

```
npm test           # pricing, sources, quantities and inventory on real captures (and synthetic resolutions), tooltips, watcher, alerts, the C# eye, builds and Daevanion rules, script scope
npm run selftest   # against the live data (needs network)
```

UI check without anyone watching: set `AION_CAPTURA=c:\path\cap.png` before starting Electron. The app opens, clicks the item with most listings, saves a screenshot and quits. With `AION_ABA=<tab>` it opens that tab instead; `AION_JS=script.js` runs a script in the page first; `AION_MOCHILA=c:\path\capture.png` reads that image on the Inventory tab.

## License

Source-available, not open source (see `LICENSE`). You may use the app, share the official executable unmodified, read the code and send contributions. You may not distribute modified versions, remove the author credit or the data-source credits, or sell the app.

The executable is sealed with Electron *fuses*. A copy with a tampered `app.asar` (for example, another name in place of "by LusitanoScripts") refuses to start: "Integrity check failed for asar archive". `scripts/test-autoria.js` fails if the credits or the seal go missing.

The captures in `scripts/amostras/` are from the game, with everything that isn't a tooltip or the inventory blacked out (they had other players' names).

---
Fan-made app. Not affiliated with NCSoft. Aion and AION 2 are trademarks of NCSoft.
