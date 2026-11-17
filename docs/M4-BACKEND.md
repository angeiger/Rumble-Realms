# M4 Backend: Datenbank und Serverfunktion

Stand 16.11.2026. Grundlage: SPEC 7, 9 und 14, Entscheidungen D-082 bis D-090.

## Achtung: Der Merge ändert die echte Datenbank und liefert die Serverfunktion aus

Im Supabase-Projekt ist die GitHub-Integration mit **Deploy to production** eingeschaltet. Sobald dieser Branch nach
`main` gemergt wird, passiert zweierlei von selbst:

1. Supabase spielt die Datei in `supabase/migrations/` in die echte Datenbank ein. Das geht nur in eine Richtung:
   Eine einmal angewendete Migration wird nicht zurückgenommen, Änderungen kommen später als neue Migrationsdatei
   dazu.
2. Supabase liefert die Edge Function `api` aus (sie ist in `supabase/config.toml` eingetragen).

Die Migration legt nur Neues an (Tabellen, eine View, den Trigger für neue Konten, die acht Buchungsfunktionen, die
Erweiterung `citext`) und löscht nichts. Danach siehst du das Ergebnis im Dashboard unter **Table Editor**,
**Database → Migrations** und **Edge Functions**. Unter **Advisors → Security Advisor** erscheint eine erwartete
Warnung „Security Definer View“ für `public_profiles`.

Von `supabase/config.toml` gelten für das echte Projekt nur der Eintrag der Function und die Migrationen. Alles zur
Anmeldung in dieser Datei betrifft nur den lokalen Test-Stack; Anbieter und Adressen des echten Projekts pflegst du
weiter im Dashboard.

Die Function braucht keine von Hand gesetzten Secrets: Adresse und geheimen Schlüssel bekommt sie von Supabase selbst.

## Was die Migration anlegt

| Tabelle           | Inhalt                                                              | Wer darf lesen            |
| ----------------- | ------------------------------------------------------------------- | ------------------------- |
| `profiles`        | Konto: Benutzername, Elo, höchste Arena, Gold, Joker, Anzahl Spiele | nur der Spieler selbst    |
| `public_profiles` | (View) nur Benutzername, Elo, höchste Arena aller Spieler           | alle angemeldeten Spieler |
| `player_cards`    | Sammlung: Karte, Level 1–5, Kopien, freigeschaltete Upgrades (0–7)  | nur der Spieler selbst    |
| `decks`           | aktives Deck: genau 4 verschiedene Karten                           | nur der Spieler selbst    |
| `matches`         | Matches: Spieler, Bot-Stufe und Bot-Profil, Seed, Engine-Version,   | beide Beteiligten         |
|                   | Startaufstellung, Picks, Ergebnis, Ende-Zeitpunkt                   |                           |
| `packs`           | Belohnungspacks: Art (Sieg oder Willkommen), geöffnet ja/nein,      | nur der Besitzer          |
|                   | Inhalt                                                              |                           |
| `friendships`     | Freundschaftsanfragen und Freunde (eine Zeile pro Paar)             | beide Seiten              |

Bei jeder neuen Anmeldung (auch als Gast) legt ein Trigger automatisch an: Profil (Elo 1000, Gold 0, Arena 1, noch
kein Benutzername), die sechs Startkarten (Bogenschütze, Ritter, Skelette, Fledermäuse, Lauf-TNT, Heiler; Level 1,
je 1 Kopie) und das Startdeck (Bogenschütze, Ritter, Skelette, Heiler). Wird ein Konto gelöscht, verschwinden
seine Daten mit.

**Sicherheit:** Die App darf nur lesen, nie schreiben, nicht einmal die eigene Zeile. Gold, Karten, Elo und Packs
ändert ausschließlich die Edge Function `api` auf dem Server (D-082). Wer nicht angemeldet ist, sieht gar nichts. Die
Datenbank lehnt außerdem ungültige Werte selbst ab (z. B. Benutzername mit Leerzeichen, doppelter Name in anderer
Schreibweise, Level 6, negatives Gold, Deck mit 3 Karten).

**Neue Spalten in `matches`:** `bot_profile` (welcher Bot, z. B. `goblin-gustav`; nur bei Bot-Matches), `setup` (ein
Schnappschuss deines Decks beim Start: die vier Karten mit Level und Upgrades; spätere Level-Ups ändern ein laufendes
Match nicht) und `finished_at` (wann das Ergebnis gebucht wurde; leer, solange das Match läuft). Jeder Spieler kann
höchstens **ein** offenes Match gleichzeitig haben.

**Neue Spalte in `packs`:** `kind` ist `match` (Belohnung für einen Sieg) oder `welcome` (das erste Pack nach der
Namenswahl). Das Willkommens-Pack gibt es pro Spieler nur einmal.

**Buchungsfunktionen:** Für jede Aktion gibt es eine Funktion in der Datenbank. Die Edge Function rechnet (Kosten, Elo,
Pack-Inhalt, Nachsimulation des Matches) und ruft dann genau eine dieser Funktionen auf. Die Funktion bucht alles auf
einmal oder gar nichts, und sie prüft selbst, was die Datenbank wissen kann: Gehört die Karte dir, reicht das Gold,
ist das Pack noch zu, läuft das Match noch? Ein Doppelklick bucht deshalb nie doppelt; der zweite Aufruf bekommt eine
Fehlermeldung. Spielwerte (Preise, Belohnungen) stehen nicht in der Datenbank, sie kommen aus dem Code.

| Funktion            | Was sie bucht                                                                         |
| ------------------- | ------------------------------------------------------------------------------------- |
| `rr_set_username`   | Erste Namenswahl samt Willkommens-Pack, danach Umbenennung (solange noch frei)        |
| `rr_set_deck`       | neues Deck aus vier eigenen, verschiedenen Karten                                     |
| `rr_level_up_card`  | Karte eine Stufe höher, zieht Kopien und Gold ab                                      |
| `rr_unlock_upgrade` | schaltet ein Upgrade einer Karte frei, zieht Gold ab                                  |
| `rr_spend_jokers`   | tauscht Joker gegen Kopien, schaltet eine neue Karte dabei frei                       |
| `rr_create_match`   | legt ein neues Bot-Match an (nur mit Benutzername, nur wenn kein anderes offen ist)   |
| `rr_finish_match`   | bucht das Ergebnis: Elo (nie unter 0), Spielezahl, höchste Arena, Gold, Pack bei Sieg |
| `rr_open_pack`      | öffnet ein eigenes Pack und schreibt den Inhalt gut                                   |

Nur der Server (die Rolle `service_role`) darf diese Funktionen aufrufen; die App und nicht angemeldete Besucher
bekommen „keine Berechtigung“.

## Lokal testen

Alle Befehle laufen im Hauptordner des Projekts (`~/Rumble-Realms`). Kein Supabase-Konto, kein Passwort und kein
echter Schlüssel nötig: Alles läuft auf der VM.

### 1. Datenbank-Tests (ohne Docker)

```bash
bash supabase/tests/run_local.sh
```

Legt eine Wegwerf-Datenbank `rr_test` im normalen PostgreSQL der VM an, baut das Nötigste von Supabase nach, spielt die
Migration und die SQL-Tests ein und löscht die Datenbank wieder. Am Ende steht `OK: … assertions passed.`, bei einem
Fehler bricht es ab. Mit `--keep` bleibt die Datenbank zum Nachschauen stehen.

### 2. Lokaler Supabase-Stack mit der Serverfunktion

```bash
bash supabase/tests/stack.sh up         # starten (dauert beim ersten Mal einige Minuten)
bash supabase/tests/stack.sh reset      # Datenbank leeren und Migration neu einspielen
bash supabase/tests/stack.sh functions  # nach einer Code-Änderung die Edge Function neu laden
bash supabase/tests/stack.sh down       # stoppen
```

`up` startet nur die Teile, die das Spiel braucht (Datenbank, Anmeldung, Datenzugriff, Edge Functions), damit der
Arbeitsspeicher reicht. Die Edge Function `api` wird dabei automatisch mitgestartet; ein extra
`supabase functions serve` ist nicht nötig. Der Stack ist dann unter `http://127.0.0.1:54321` erreichbar, die Function
unter `http://127.0.0.1:54321/functions/v1/api`. Änderungen am Code der Function liest sie nicht von selbst neu ein:
danach `stack.sh functions` aufrufen.

Falls Docker meldet, dass die Berechtigung fehlt (direkt nach der Installation), erledigt das Skript das selbst über
`sg docker`.

### 3. Tests gegen den Stack

```bash
eval "$(bash supabase/tests/stack.sh env)"   # Adresse und lokale Schlüssel des Stacks laden
pnpm test:backend
```

Die Tests legen für jeden Fall eigene Gastkonten an, spielen Matches wie die App und prüfen Elo, Gold, Packs, alle
wichtigen Fehlermeldungen, die Sicherheit (keine fremden Daten, kein direktes Schreiben) und doppelte Klicks.
Ohne geladene Adresse und Schlüssel werden sie mit einem Hinweis übersprungen. Die lokalen Schlüssel sind die
öffentlich bekannten Standardschlüssel des lokalen Stacks; sie werden nirgends gespeichert.

### Ende-zu-Ende-Tests gegen den Stack

```bash
eval "$(bash supabase/tests/stack.sh env)"
pnpm test:e2e:server
```

Ein echter Browser (Playwright, Handy-Format) bedient die App, und die App spricht mit dem lokalen Stack: echte
Gast-Anmeldung, echte Datenbank, echte Edge Function. Dafür baut der Test die App eigens mit der Adresse und dem
öffentlichen Schlüssel des Stacks (Ordner `apps/web/dist-server`, Port 4174; der normale Test `pnpm test:e2e` läuft
weiter ohne Server auf Port 4173 und bleibt davon unberührt). Geprüft wird: Anmeldung als Gast, Benutzername (ein
zweites Konto bekommt denselben Namen als „vergeben“), Willkommens-Pack, Neuladen, ein ganzes Bot-Match auf „Leicht“
mit Meldung an den Server (bei Sieg mit Pack), Fortsetzen nach Neuladen, Aufgeben, Aufwerten, Upgrade, Joker und
Abmelden. Nach den Aktionen schauen die Tests direkt in der Datenbank nach, ob Profil, Karten, Packs, Elo und Gold
dort wirklich stimmen. Gold, Kopien und Joker für die Aufwerten-Tests schreibt der Test dem frischen Testkonto
direkt in der Datenbank gut; die Aktionen selbst laufen über die Oberfläche. Ob ein Match gewonnen wird, lässt sich
nicht steuern; der Test spielt deshalb bis zu drei Matches, bis eines gewonnen ist. Der Lauf dauert deshalb einige
Minuten. Jeder Test legt eigene Konten an, die Datenbank muss dazwischen nicht geleert werden. Ohne geladene
Adresse und Schlüssel werden die Tests mit einem Hinweis übersprungen.

### Die App selbst gegen den lokalen Server ausprobieren

```bash
pnpm dev:stack
```

Startet den Stack (falls nötig) und danach die App wie `pnpm dev` auf http://localhost:5173, aber mit echter
Anmeldung, Datenbank und Function statt des lokalen Modus. Der Browser spricht den Stack direkt unter
`http://127.0.0.1:54321` an: Läuft der Browser auf einem anderen Rechner als die VM, muss neben Port 5173 auch
Port 54321 weitergeleitet werden. Ein frisches Konto bekommst du über **Profil → Abmelden**.

### 4. Die Serverfunktion selbst prüfen

```bash
pnpm check:deno
```

Prüft die Typen der Edge Function mit Deno und führt ihre Unit-Tests aus. Deno liegt in der VM unter `~/.deno/bin`;
das Skript findet es dort auch ohne Eintrag im `PATH` (wer `deno` direkt aufrufen will:
`export PATH="$HOME/.deno/bin:$PATH"`).

### 5. Kopie des gemeinsamen Codes

Die Edge Function bekommt die Spiel-Engine und den gemeinsamen Code als Kopie unter `supabase/functions/_shared/`
(siehe D-083). Nach jeder Änderung in `packages/engine` oder `packages/shared`:

```bash
pnpm sync:functions
```

`pnpm lint` (und damit die CI) schlägt an, wenn die Kopie veraltet ist. Die Dateien in `_shared` nie von Hand ändern.

### In der CI

Der Job `backend` in `.github/workflows/ci.yml` macht dasselbe auf GitHub: SQL-Tests, `pnpm check:deno`, Stack
starten, `pnpm test:backend`, danach `pnpm test:e2e:server` (Browser gegen denselben Stack; bei einem Fehler
liegen Bericht und Screenshots als Artefakt `playwright-results-server` bereit). Er braucht keine Secrets.

## Was die App und der Server in M4 können

- **Edge Function `api`** mit acht Aktionen: `set_username`, `set_deck`, `level_up_card`, `unlock_upgrade`,
  `spend_jokers`, `create_match`, `report_match`, `open_pack`. Sie benutzt dieselbe Engine wie die App und spielt
  jedes Bot-Match nach, bevor sie Elo, Gold und Pack bucht (D-084).
- **Anmeldung** in der App: als Gast sofort; Google und E-Mail (Magic Link) sind eingebaut, aber abgeschaltet, bis du
  sie einrichtest (D-088).
- **Sammlung, Deck, Gold, Joker, Elo und Packs** kommen aus der Datenbank. Ist in der App kein Supabase eingetragen,
  läuft sie im lokalen Modus ohne Server (D-085).

## Einstellungen im Supabase-Dashboard

- **Authentication → Sign In / Providers → Anonymous sign-ins**: muss an sein (für „Als Gast spielen“); war bei der
  Vorarbeit schon eingeschaltet.
- **Authentication → Sign In / Providers → Email**: nur nötig, wenn du die E-Mail-Anmeldung einschaltest
  (`VITE_AUTH_EMAIL=1`). Für echte Spieler braucht es dann einen eigenen Mailversand (SMTP), siehe D-088.
- **Authentication → Sign In / Providers → Google**: nur nötig, wenn du die Google-Anmeldung einschaltest
  (`VITE_AUTH_GOOGLE=1`); dafür legst du selbst einen Google-OAuth-Client an.
- **Authentication → URL Configuration**: Site URL und Redirect URLs (Vercel-Adresse und `http://localhost:5173`);
  nur für Google und E-Mail nötig, nicht für Gäste.

## Werte, die du selbst einträgst

Die ersten beiden findest du im Dashboard unter **Project Settings → API Keys** (die Adresse unter **Data API**):

| Name                            | Was                                              |
| ------------------------------- | ------------------------------------------------ |
| `VITE_SUPABASE_URL`             | Project URL                                      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key (öffentlich)                     |
| `VITE_AUTH_GOOGLE`              | `1` schaltet die Google-Anmeldung ein, sonst aus |
| `VITE_AUTH_EMAIL`               | `1` schaltet die E-Mail-Anmeldung ein, sonst aus |

Eintragen in `apps/web/.env.local` (wird nicht committet; Vorlage: `apps/web/.env.example`) und in Vercel unter
**Settings → Environment Variables**. Fehlen Adresse oder Schlüssel, läuft die App im lokalen Modus. Der alte Name
`VITE_SUPABASE_ANON_KEY` wird ersatzweise noch gelesen. Der **geheime Schlüssel** (im Dashboard „secret“ bzw.
„service_role“ genannt) gehört nie in die App, in Dateien oder in Vercel; ihn bekommt nur die Edge Function über
Supabase selbst.

## Offene Entscheidungen

1. **Freundschaftskampf** (M5) bucht weder Elo noch Pack. Ob `matches` dafür eine eigene Kennzeichnung braucht, klären
   wir in M5.
2. **Konto löschen**: Löscht ein Spieler sein Konto, verschwinden auch die gemeinsamen Matches beim Gegner. Für M4
   (nur Bots) egal, für M5 zu prüfen.

Erledigt seit der Vorarbeit: Wortfilter und Umbenennung (D-087), Vergleich der Startsammlung zwischen Datenbank und
Engine (Tests in `tools/backend-tests`).
