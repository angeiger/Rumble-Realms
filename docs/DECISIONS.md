# Entscheidungen und Annahmen

Hier stehen Annahmen, die die Spezifikation (`docs/SPEC.md`) offen lässt. Neueste Einträge unten.
Jeder Eintrag: was entschieden wurde und warum. Wer etwas ändert, ergänzt einen neuen Eintrag, statt alte zu löschen.

## M0 – Projektgerüst (14.11.2026)

### D-001 pnpm 10 statt pnpm 12

`packageManager` ist auf `pnpm@10.34.9` festgelegt.
Grund: Das in Ubuntu 26.04 mitgelieferte corepack (0.24) kann pnpm 11/12 nicht starten (anderes Startformat).
pnpm 10 wird weiter gepflegt, und Vercel erkennt es ohne zusätzliche Einstellung am Lockfile (`lockfileVersion: 9.0`).
Ein späterer Wechsel auf pnpm 12 ist möglich, braucht aber ein neueres corepack in der VM.

### D-002 TypeScript 6.0 statt 7.0

TypeScript ist auf `~6.0.3` festgelegt.
Grund: `typescript-eslint` (8.72) unterstützt nur TypeScript `< 6.1`. Ohne es gäbe es kein Lint für TypeScript,
also auch keine Determinismus-Regel (SPEC 2.6). Wechsel auf 7, sobald `typescript-eslint` es unterstützt.

### D-003 Pakete ohne Build-Schritt, Importe mit `.ts`-Endung

- Paketnamen: `@rumble-realms/engine`, `@rumble-realms/shared`, `@rumble-realms/web`, `@rumble-realms/sim-cli`.
- `engine` und `shared` werden direkt als TypeScript-Quelltext benutzt (`exports` zeigt auf `src/index.ts`), es gibt kein `dist`.
- Relative Importe tragen immer die Endung `.ts`. Aktiv sind `erasableSyntaxOnly` und `verbatimModuleSyntax`
  (kein `enum`, kein `namespace`, keine Parameter-Properties).

Grund: Derselbe Quelltext muss in vier Umgebungen laufen: Vite (Client), Vitest, Node (sim-cli) und Deno
(Supabase Edge Functions, SPEC 14.2). Deno verlangt die Endung `.ts`; „löschbare“ Typ-Syntax hält den Weg offen,
den Code ganz ohne Übersetzer auszuführen.

Nachtrag: `sim-cli` startet über `tsx`. Das Node 22 aus den Ubuntu-Paketen ist ohne die eingebaute
TypeScript-Unterstützung gebaut (`process.features.typescript` ist `false`), `node src/main.ts` geht dort also nicht.

### D-004 Engine ohne Abhängigkeiten und ohne DOM-Typen

`packages/engine` hat keine Laufzeit-Abhängigkeiten. Das `tsconfig` der Engine lädt weder DOM- noch Node-Typen
(`lib: ["ES2022"]`, `types: []`). Wer in der Engine `window`, `document` oder `process` benutzt, bekommt einen Typfehler.
Grund: SPEC 3 („reine Spiellogik, kein DOM“) wird so vom Compiler geprüft statt nur per Absprache.

### D-005 Determinismus-Regel als Erlaubnisliste

Im Engine-Paket verbietet ESLint:

- jeden Zugriff auf `Math.*` außer `abs`, `min`, `max`, `sign`, `trunc`, `floor`, `ceil`, `imul`, `clz32`,
- `Date` (auch `new Date()` und `Date.now`), `performance`, `setTimeout`, `setInterval`, `globalThis`.

Grund: SPEC 2.6 und 6.1. Eine Erlaubnisliste ist sicherer als eine Verbotsliste, weil auch `Math.sqrt`, `Math.pow`,
`Math.exp` usw. auf verschiedenen Geräten in der letzten Stelle abweichen können.
Ein Test prüft, dass die Regel wirklich anschlägt.

### D-006 `ENGINE_VERSION` ist eine Ganzzahl

Start bei `1`, passend zur Spalte `matches.engine_version int` (SPEC 14.1).
Sie wird erhöht, sobald sich ein Kampfergebnis bei gleichem Input ändern kann.

### D-007 Tests: Vitest je Paket, Playwright erst ab M2

Testdateien liegen neben dem Quelltext (`*.test.ts`). Playwright kommt mit dem ersten echten Bildschirm in M2.
Grund: In M0 gibt es nichts zu klicken, und die Browser-Downloads (mehrere hundert MB) belasten VM und CI unnötig.

### D-008 i18n ohne Bibliothek

Eine kleine, typisierte Funktion `t()` liest `de.json` (maßgeblich) und `en.json`. Ein Test prüft, dass beide Dateien
dieselben Schlüssel haben. Grund: Für zwei Sprachen und einfache Platzhalter reicht das; spart Paketgröße.

### D-009 Schriften werden mit ausgeliefert

„Lilita One“ und „Nunito“ kommen über `@fontsource` ins Paket statt von Google-Servern.
Grund: Die PWA soll offline laufen, und es gehen keine Daten der Spieler an Google Fonts.

### D-010 Bibliotheken erst bei Bedarf

PixiJS, Zustand, zod und der Supabase-Client werden erst in dem Meilenstein installiert, der sie braucht (M1/M2/M4).
`packages/shared` ist in M0 ein leeres Gerüst.

### D-011 Vercel

Root Directory `apps/web`, Einstellungen in `apps/web/vercel.json` (Vite, Ausgabe `dist`, alle Pfade auf `index.html`
umgeleitet, damit später `/join/<code>` funktioniert). Node 22 über `engines`. Keine Vercel-Tokens im Repo oder in der VM;
das Projekt importiert Andreas selbst über die Vercel-Oberfläche.

### D-012 CI

GitHub Actions bei jedem Push und Pull Request: Installieren (`--frozen-lockfile`), Lint, Typecheck, Tests, Build.
Der Workflow hat nur Leserechte (`permissions: contents: read`) und benutzt keine Secrets.

### D-013 Lizenz offen

Das Repo ist öffentlich, enthält aber keine `LICENSE`-Datei. Damit gilt „alle Rechte vorbehalten“:
Andere dürfen den Code lesen, aber nicht weiterverwenden. Ob das so bleiben soll, entscheidet Andreas.

### D-014 Gebaute Dateien unter `/static`, Sprites unter `/assets`

Vite legt die gebauten Dateien (mit Prüfsumme im Namen) unter `/static/` ab statt unter `/assets/`.
Grund: SPEC 11 sieht `/assets/units/<id>/` für Sprites vor. Diese Dateien haben keine Prüfsumme im Namen und dürfen
deshalb nicht „für immer“ im Browser-Cache landen. So bekommt nur `/static/` den Header `immutable`.

### D-015 Entwicklungsserver räumt alten Service Worker weg

Entwicklungsserver (`pnpm dev`) und Vorschau des fertigen Builds (`pnpm preview`) laufen beide auf `localhost:5173`.
Ein Service Worker aus der Vorschau würde danach dem Entwicklungsserver weiter seinen gespeicherten Stand unterschieben.
Deshalb liefert der Entwicklungsserver unter `/sw.js` einen Service Worker aus, der sich selbst abmeldet,
die Caches leert und die Seite neu lädt. Beim Wechsel von Vorschau zu Entwicklung kann die Seite einmal kurz neu laden.

### D-016 Server nur auf `127.0.0.1`

Entwicklungs- und Vorschauserver lauschen nur auf `127.0.0.1:5173` (`strictPort`), nicht im Netz der VM.
Zugriff von außen ausschließlich über den SSH-Tunnel.

### D-017 `eslint-plugin-react-hooks` im Root

Das Plugin steht in den Root-Abhängigkeiten, weil die gemeinsame ESLint-Konfiguration im Root liegt.

## M1 – Engine ohne Grafik (14.11.2026)

### D-018 Die „10 Ursprungseinheiten“

M1 setzt die ersten zehn Zeilen der Tabelle in SPEC 5.2 um: Bogenschütze, Ritter, Lauf-TNT, Skelette, Heiler,
Musketier, Fledermäuse, Assassine, Berserker, Pilzlinge. Die übrigen sechs folgen in M3.

### D-019 Zustand ist veränderlich und reines JSON

Match- und Kampfzustand sind einfache Datenobjekte (keine Klassen, kein `Map`/`Set`). Die Engine-Funktionen ändern
sie direkt; `applyPick` gibt denselben Zustand zurück. Kopien macht `cloneState`.
Grund: schnelle Simulation (Bots rechnen später tausende Kämpfe), einfaches Speichern, Wiederverbinden und Hashen.

### D-020 Schnittstelle gegenüber dem Vorschlag in SPEC 6.4

- Das Feld (`MatchState.battle`) existiert schon im Draft; gewählte Karten spawnen ihre Einheiten direkt dort.
- Nach dem letzten Pick wechselt die Phase von selbst auf `battle`. `startBattle` gibt nur noch das Feld zurück.
- Neu: `endRound(state)` bucht nach dem Kampf die Leben, leert das Feld und bereitet den nächsten Draft vor.
- `stepTick(battle, events?)` sammelt Ereignisse nur, wenn eine Liste übergeben wird (Bots und Server brauchen keine).

### D-021 Zwei Positionen pro Einheit

Jede Einheit hat ein logisches Feld (`x, y`: zählt für Abstände, Reichweite, Flächenschaden) und ein belegtes Feld
(`tx, ty`). Beim Start eines Schritts belegt sie sofort das Zielfeld (Reservierung, SPEC 6.2) und gibt das alte frei;
logisch steht sie bis zur Ankunft noch auf dem alten Feld. Während des Schritts kann sie nicht angreifen.
Grund: Niemand bekommt Gratis-Treffer auf eine Einheit, die erst unterwegs ist, und Kolonnen stauen sich nicht.

### D-022 Reichweite und Abstände

Abstände werden zwischen Feldmitten als quadrierte Ganzzahlen verglichen. Reichweite 1 heißt „alle 8 Nachbarfelder“
(dx² + dy² ≤ 2), Reichweite r ≥ 2 heißt dx² + dy² ≤ r². Flächenschaden trifft Einheiten, deren Feldmitte im Radius liegt
(r 1 = Kreuz aus 5 Feldern, r 1,5 = 3 × 3 Felder). Flächenschaden trifft nur die Ebenen, die die Einheit auch angreifen kann.

### D-023 Wer Luft angreifen kann, steht in den Kartendaten

Maßgeblich ist die Spalte „Ziele“ der Tabelle 5.2. Fledermäuse sind Nahkämpfer und dürfen trotzdem Luft angreifen.

### D-024 Angriffe ohne Vorlaufzeit, Geschosse mit Flugzeit

Der erste Angriff ist sofort möglich, sobald das Ziel in Reichweite ist. Nahkampf trifft im selben Tick.
Geschosse fliegen mit fester Geschwindigkeit (Annahme: Bogenschütze 12 Felder/s, Musketier 20 Felder/s);
die Flugzeit ergibt sich aus dem Abstand beim Abschuss. Einheiten, die in einem Tick tödlich getroffen werden,
handeln in diesem Tick noch (gleichzeitige Tode, SPEC 6.1), bewegen sich aber nicht mehr.

### D-025 Schaden über Zeit ohne Rundungsverlust

Wirkt ein Effekt mit X Schaden pro Sekunde, wird der Schaden so auf die Ticks verteilt, dass nach jeder vollen
Sekunde genau X Schaden gefallen sind (Schaden im Tick k = ⌊X·k/20⌋ − ⌊X·(k−1)/20⌋).

### D-026 Platzierung

- Gerechnet wird aus Sicht des Spielers (Spalte 0–11, Reihe 0 = Grundlinie). Für Spieler B wird um 180° gedreht
  (Spalte 11 − c, Reihe 23 − r). So sind alle Gleichstandsregeln für beide Seiten spiegelgleich.
- Das Zentrum einer Karte ist die zufällige Spalte in der **vordersten Reihe ihrer Zone** (zur Feldmitte hin).
- Ist die Zone voll, geht es Zone für Zone Richtung Grundlinie weiter, danach Richtung Feldmitte.
  Erst wenn die ganze Hälfte auf dieser Ebene voll ist, verfallen Einheiten.

### D-027 Heiler

- Ohne verletzte Verbündete in Reichweite läuft er zur **nächstgelegenen** verletzten Verbündeten.
- Er heilt sich nicht selbst. Andere Heiler kann er heilen.
- „Keine Verbündeten mehr übrig“ heißt: keine Verbündeten außer Heilern. Dann greifen Heiler im Nahkampf an
  (nur Bodenziele). So stehen sich nie zwei Heilergruppen tatenlos gegenüber.

### D-028 Assassine und Lauf-TNT

- Assassine: Während der 2 s Aufladung tut er nichts. Ziel des Sprungs ist der zu diesem Zeitpunkt am weitesten
  entfernte Bodengegner; er landet auf dem freien Bodenfeld, das diesem Gegner am nächsten ist.
- Lauf-TNT: explodiert, sobald ein Bodengegner auf einem Nachbarfeld steht, auch mitten im Schritt.
  Explosionen können Kettenreaktionen im selben Tick auslösen.

### D-029 Seed

Der Match-Seed ist eine nicht negative ganze Zahl bis 2^53 − 1. Daraus werden getrennte Zufallsströme für
Münzwürfe, Angebote, Platzierung und Kampf abgeleitet (xoshiro128**, SPEC 6.1).
