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
