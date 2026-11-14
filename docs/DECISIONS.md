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

### D-030 Angebote, Münzwurf und Spielende

- Ein Angebot entsteht, indem das Deck gemischt wird und die ersten drei Karten genommen werden. Jedes Angebot
  verbraucht gleich viele Zufallszahlen, die Platzierung genau eine pro Karte. So hängen Angebote nie davon ab,
  was auf dem Feld steht.
- Der erste Münzwurf bestimmt den Startspieler von Runde 1, jeder weitere gilt nach einer unentschiedenen Runde.
- Nach dem letzten Kampf bleibt das Feld stehen (für die Anzeige). Danach nimmt die Engine keine Picks mehr an.
- Die Regel „Gleichstand → kleinere Reihe“ bei der Platzierung (SPEC 4.4) greift praktisch nie, weil das Zentrum
  in der vordersten Reihe der Zone liegt (D-026). Sie ist trotzdem eingebaut.

### D-031 Tödlich getroffen heißt tot

Fällt eine Einheit in einem Tick auf 0 LP oder darunter, stirbt sie am Ende dieses Ticks. Heilung oder Lebensraub
im selben Tick retten sie nicht mehr; sie führt ihre eigene Aktion in diesem Tick aber noch aus (SPEC 6.1).

### D-032 Wegsuche

Die Wegsuche (A*) startet, sobald eine Einheit 20 Ticks lang keinen Schritt machen konnte (im 21. Tick).
Unter gleich langen Wegen gilt dieselbe Richtungsreihenfolge wie beim normalen Schritt („vorwärts zuerst“),
für Spieler B um 180° gedreht. Jede Änderung an der Wegsuche ändert Kampfergebnisse und braucht eine neue `ENGINE_VERSION`.

### D-033 Robustheitstest in zwei Größen

300 Zufallsmatches laufen bei jedem `pnpm test` mit. Die 10 000 Matches aus SPEC 12 laufen als eigener Befehl
`pnpm test:robust` (etwa 25 s) und zusätzlich in der CI.

## M2 – Spielbarer Prototyp (14.11.2026)

### D-034 Aufbau des Clients

Drei Teile mit festem Vertrag (`apps/web/src/game/types.ts`):

- `game/`: Die Spielsitzung führt ein lokales Match gegen einen Bot auf Basis der Engine.
- `render/`: Die Kampfansicht zeichnet das Feld mit PixiJS. Sie liest den Kampfzustand, ändert ihn aber nie (SPEC 6.4).
- `ui/`: React-Bildschirme. Sie bekommen nur einen unveränderlichen Schnappschuss und rufen Aktionen auf.

Grund: Der Engine-Zustand ist veränderlich (D-019), React braucht aber unveränderliche Daten, um Änderungen zu erkennen.

### D-035 Eine einzige Uhr

Bot-Bedenkzeit, Countdown, Kampf-Ticks und die Pause am Rundenende laufen über eine einzige Funktion
(`advance(dt)`), die die Kampfansicht einmal pro Bild aufruft. Ist die App im Hintergrund, pausiert das Spiel.
Grund: kein Durcheinander mehrerer Zeitgeber, und der Ablauf lässt sich ohne Browser testen.

### D-036 Lokales Match in M2

- Der Mensch ist immer Spieler A und sieht seine Hälfte unten. Die Ansicht kann auch für Spieler B drehen (für M5).
- Spieler-Deck: das Startdeck aus SPEC 7.1 (Bogenschütze, Ritter, Skelette, Heiler), alle Karten Level 1.
- Gegner: Bot „Leicht“ (wählt zufällig, Level 1) mit einem von mehreren festen Decks aus dem Kartenpool von Arena 1.
- Der Match-Seed wird im Browser zufällig erzeugt. Es wird noch nichts gespeichert (Konten kommen mit M4).

### D-037 Platzhalter-Figuren

Jede Einheit ist eine mit PixiJS gezeichnete Vektorfigur (SPEC 11). Die Figur selbst ist statisch; Stehen, Laufen,
Angriff und Tod entstehen durch Bewegungen der ganzen Figur (Wippen, Strecken, Ausfallschritt, Umkippen).
Die Teamfarbe steckt in der Kleidung und im Ring unter der Figur, der zusätzlich ein Symbol je Team trägt.

### D-038 Playwright

Ende-zu-Ende-Tests laufen mit Chromium im mobilen Hochformat gegen den gebauten Stand auf Port 4173,
damit sie den Entwicklungsserver auf 5173 nicht stören. WebGL läuft im Test-Browser per Software-Renderer.

### D-039 PixiJS-Renderer nie mit `destroy(true)` abbauen

Es gibt zeitweise zwei PixiJS-Renderer: den Kampf-Renderer und einen kurzlebigen, der die Figurenbilder für die
Karten erzeugt. `app.destroy(true, …)` leert zusätzlich PixiJS-interne Puffer, die sich alle Renderer teilen;
ein noch laufender Renderer stürzt dann im nächsten Bild ab (das Spiel fror ein, wenn man direkt nach dem Laden
auf „Spielen“ drückte). Deshalb wird überall `DESTROY_RENDERER` aus `render/destroy.ts` benutzt.
Ein Ende-zu-Ende-Test („Sofortstart“) sichert das ab.

### D-040 Ende-zu-Ende-Tests laufen in Echtzeit

Der Test spielt ein ganzes Match bei doppelter Geschwindigkeit durch (etwa 2,5 Minuten). Eine künstlich
beschleunigte Uhr wird nicht benutzt, weil der Test-Browser damit keine Bilder mehr liefert.
Der Test-Browser rendert per Software und ist viel langsamer als ein Handy; über die Bildrate auf echten
Geräten sagt er nichts aus.

### D-041 Paketgröße

PixiJS macht den Hauptteil des Programms aus (rund 183 kB komprimiert). Der Service Worker speichert alles
beim ersten Besuch, danach startet die App ohne Netz. Ein Aufteilen in nachladbare Teile ist für später notiert.

## Änderungswünsche von Andreas nach dem M2-Test (14.11.2026)

Diese Punkte hat Andreas nach dem Test des Prototyps festgelegt. Sie gehen der Spezifikation vor, wo sie ihr
widersprechen. Umgesetzt werden sie als erstes Arbeitspaket von M3, weil Sonderkarten, Bots und Balancing darauf aufbauen.
Die Grundmechanik hat er ausdrücklich für gut befunden.

### D-042 Aufstellung so weit hinten wie möglich (ändert SPEC 4.4, ersetzt D-026 teilweise)

Alle Einheiten stehen so nah an der eigenen Grundlinie wie möglich. Die Reihenfolge nach Rolle bleibt
(hinten Fernkampf, davor Mitte, davor vorne). Kommt eine Einheit dazu, die weiter hinten stehen soll,
rücken die anderen nach vorne. Die genaue Regel (Spalten, Gleichstände) wird bei der Umsetzung festgelegt.

### D-043 Karten liegen über dem Spielfeld (ändert SPEC 10)

Das Spielfeld füllt immer den ganzen Bildschirm. Die Angebotskarten werden darüber eingeblendet statt darunter.

### D-044 Ein Tippen spielt die Karte (ändert SPEC 4.3)

Keine zusätzliche Bestätigung und kein Button „Ausspielen“ mehr. Die Detailansicht bleibt über langes Drücken
bzw. den „i“-Knopf erreichbar.

### D-045 Kein Countdown vor dem Kampf (ändert SPEC 4.2)

Statt „3 – 2 – 1 – Kampf!“ ein kurzer Übergang, z. B. eine Rauchanimation.

### D-046 Die Armee wächst von Runde zu Runde (ändert SPEC 4.1 und 4.2)

Alle Karten, die ein Spieler in früheren Runden gewählt hat, erscheinen in jeder neuen Runde wieder.
Neu gewählte Karten kommen dazu. Annahmen bis zur Umsetzung: Die Einheiten erscheinen mit vollen LP und werden
nach D-042 neu aufgestellt; der Verlierer-Bonus bleibt. Ob das Feld dafür größer werden muss, wird per
Simulation geprüft (Armeegröße in späten Runden, Kampfdauer, Rechenzeit) und dann mit Andreas entschieden.
Die Änderung braucht eine neue `ENGINE_VERSION`.

### D-047 Grafik später überarbeiten

Die Platzhalter-Figuren bleiben vorerst. Eine Überarbeitung der Grafik ist für M6 (Feinschliff) vorgesehen.

### D-048 Deck-Tab schon in M3, Fortschritt wie geplant in M4

Andreas möchte einen eigenen Tab, in dem man sein Deck aus vier Karten zusammenstellt und Karten levelt.

- **M3:** Deck-Tab mit freier Wahl von vier der verfügbaren Karten; das Deck wird im Browser gespeichert.
  Das Kartenlevel lässt sich dort vorläufig frei einstellen (Testmodus, ohne Kosten), damit alle Einheiten und
  Level ausprobiert werden können.
- **M4:** Sammlung, Kopien, Gold, Level-Up und Upgrades mit Kosten, serverseitig abgesichert (SPEC 7 und 14).
  Der freie Testmodus entfällt dann.

### D-049 Assassine: langsamere Aufladung, Sprung zum Startfeld des Ziels (ändert SPEC 5.3, ersetzt D-028 teilweise)

- Die Aufladung dauert 2,5 s statt 2 s (20 % langsamer).
- Das Sprungziel steht schon bei Kampfbeginn fest: der Bodengegner, der dann am weitesten vom Assassinen entfernt
  steht. Der Assassine springt zu dem Feld, auf dem dieser Gegner **bei Kampfbeginn stand**, nicht dorthin, wo er
  sich gerade befindet. Ist das Feld belegt, landet er auf dem nächstgelegenen freien Bodenfeld.
- Nach dem Sprung gilt die normale Zielwahl (nächster Gegner).

### D-050 Lauf-TNT: Zündung mit Lunte (ändert SPEC 5.3, ersetzt D-028 teilweise)

- Kommt ein Bodengegner bis auf 2 Felder heran, beginnt die Lunte zu brennen (1,25 s, halb so lang wie die
  Aufladung des Assassinen). Das TNT läuft dabei weiter auf sein Ziel zu.
- Ist beim Ende der Lunte noch ein Gegner im Umkreis, explodiert es. Verlässt der letzte Gegner den Umkreis vorher,
  erlischt die Lunte und beginnt beim nächsten Mal von vorn.
- Stirbt das TNT durch Schaden, explodiert es wie bisher sofort.
- Das Tempo bleibt vorerst bei 1,5 Feldern/s (zweitschnellste Einheit); Feinabstimmung in der Balance-Runde.

### D-051 M3 in zwei Schritten

- **M3a:** die Änderungswünsche D-042 bis D-046, D-049, D-050 und der Deck-Tab (D-048). Eigenes Gate, damit
  Andreas die geänderten Regeln früh testen kann.
- **M3b:** Sonderkarten, alle Upgrades, die übrigen sechs Einheiten, Bots „Mittel“ und „Schwer“, Balance-Tool
  und erste Balance-Runde.

### D-052 Aufstellung im Detail (zu D-042)

- Pro Spieler werden die Karten in drei Gruppen aufgestellt, von der Grundlinie aus: zuerst alle „hinten“-Einheiten,
  davor alle „Mitte“-Einheiten, davor alle „vorne“-Einheiten. Jede Gruppe beginnt in der ersten Reihe, die die
  Gruppe dahinter nicht benutzt.
- Innerhalb der Gruppe sucht jede Einheit das nächste freie Feld ihrer Ebene zur Zufallsspalte ihrer Karte in der
  ersten Reihe der Gruppe. Reihenabstand zählt dabei doppelt, die Formation wird also eher breit als tief.
- Die Aufstellung wird nach jedem Pick für die ganze Armee neu berechnet; Einheiten früherer Picks können dabei
  nach vorne rücken. Was nicht mehr in die eigene Hälfte passt, verfällt.

### D-053 Wachsende Armee im Detail (zu D-046)

- Die Engine merkt sich jede gespielte Karte des Matches samt ihrer Zufallsspalte. Zu Beginn jeder Runde stehen
  alle früheren Karten beider Spieler wieder mit vollen LP auf dem Feld, schon während des Drafts sichtbar.
- Jede Einheit behält ihre Nummer über alle Runden. Die Verarbeitungsreihenfolge im Kampf folgt damit der
  Reihenfolge, in der die Karten gespielt wurden.
