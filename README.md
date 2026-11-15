# Rumble Realms

Rumble Realms ist ein rundenbasiertes Auto-Battler-Kartenspiel für das Handy im comicartigen Fantasy-Stil. Spieler sammeln Einheitenkarten, stellen daraus ein Deck zusammen und lassen die Einheiten im Kampf selbstständig gegeneinander antreten.

Es läuft als Progressive Web App (PWA) im Browser und soll auf Android und iOS installierbar sein.

Stand: Meilenstein M3 (volle Kampfmechanik) – lokales Spiel gegen die Bots „Leicht“, „Mittel“ und „Schwer“ mit allen 16 Einheiten, 48 Upgrades und Sonderkarten; das Deck wählt man im Deck-Tab.

## Voraussetzungen

- Node 22
- pnpm 10 über corepack: `corepack enable` (die genaue Version steht in `package.json` unter `packageManager`)

## Befehle

| Befehl             | Wirkung                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `pnpm install`     | Installiert alle Abhängigkeiten                                     |
| `pnpm dev`         | Startet den Entwicklungsserver auf http://localhost:5173            |
| `pnpm lint`        | Prüft Code (ESLint) und Formatierung (Prettier)                     |
| `pnpm typecheck`   | Prüft die Typen in allen Paketen                                    |
| `pnpm test`        | Führt die Tests (Vitest) aller Pakete aus                           |
| `pnpm build`       | Baut die Web-App für die Auslieferung                               |
| `pnpm preview`     | Zeigt die gebaute App (nach `pnpm build`) auf http://localhost:5173 |
| `pnpm sim`         | Kommandozeilen-Simulation, z. B. `pnpm sim match --seed 42`         |
| `pnpm sim balance` | Balance-Bericht, schreibt `docs/BALANCE.md` (`pnpm sim --help`)     |
| `pnpm sim tune`    | Schlägt Kartenwerte für eine ausgeglichene Siegquote vor            |
| `pnpm test:robust` | Spielt viele Zufallsmatches und prüft sie (`--matches N`)           |
| `pnpm test:e2e`    | Ende-zu-Ende-Tests im Test-Browser (baut die App, Port 4173)        |
| `pnpm format`      | Formatiert alle Dateien mit Prettier                                |

## Aufbau

- `apps/web`: Client (Vite + React, PWA)
- `packages/engine`: deterministische Spiellogik, ohne DOM
- `packages/shared`: gemeinsame Typen (ab M4)
- `tools/sim-cli`: Kommandozeilen-Simulation für Balancing und Bot-Tests
- `supabase/`: Datenbank und Edge Functions (ab M4)
- `docs/`: Spezifikation, Annahmen und Balance-Ergebnisse

## Dokumente

- [docs/SPEC.md](docs/SPEC.md): verbindliche Spezifikation
- [docs/DECISIONS.md](docs/DECISIONS.md): getroffene Annahmen
- [docs/BALANCE.md](docs/BALANCE.md): Ergebnisse der Balance-Simulation
- [CLAUDE.md](CLAUDE.md): Arbeitsweise der Agenten

## Meilensteine

| #   | Meilenstein            | Stand      |
| --- | ---------------------- | ---------- |
| M0  | Projektgerüst          | fertig     |
| M1  | Engine ohne Grafik     | fertig     |
| M2  | Spielbarer Prototyp    | fertig     |
| M3  | Volle Kampfmechanik    | in Abnahme |
| M4  | Konten und Fortschritt | offen      |
| M5  | Online gegen Freunde   | offen      |
| M6  | Feinschliff            | offen      |

## Hinweise

- Das Repo ist öffentlich. Keine Secrets committen; echte Schlüssel gehören nur in `.env.local`.
- Namen, Grafiken und Logos anderer Spiele werden nicht verwendet.
