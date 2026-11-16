# M4 Backend: Datenbank (Vorarbeit)

Stand 14.11.2026. Grundlage: SPEC 7, 9 und 14.

## Achtung: Der Merge ändert die echte Datenbank

Im Supabase-Projekt ist die GitHub-Integration mit **Deploy to production** eingeschaltet. Sobald dieser Branch nach
`main` gemergt wird, spielt Supabase die Datei in `supabase/migrations/` automatisch in die echte Datenbank ein.
Das geht nur in eine Richtung: Eine einmal angewendete Migration wird nicht zurückgenommen, Änderungen kommen später
als neue Migrationsdatei dazu.

Die Migration legt nur Neues an (Tabellen, View, eine Funktion, einen Trigger, die Erweiterung `citext`) und löscht
nichts. Danach siehst du das Ergebnis im Dashboard unter **Table Editor** und **Database → Migrations**.
Unter **Advisors → Security Advisor** erscheint eine erwartete Warnung „Security Definer View“ für `public_profiles`
(siehe unten).

`supabase/config.toml` enthält nur einen lokalen Namen. Auth-Einstellungen, Anbieter und Adressen ändert sie nicht;
die pflegst du weiter im Dashboard.

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
ändern später ausschließlich die Edge Functions auf dem Server. Wer nicht angemeldet ist, sieht gar nichts. Die
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
starten, `pnpm test:backend`. Er braucht keine Secrets.

## Was in M4 noch folgt

- **Edge Functions** (Server-Logik, nutzen dieselbe Engine wie die App): `create_match`, `report_match`,
  `open_pack`, `level_up_card`, `unlock_upgrade`, `spend_jokers`, `set_deck`, `set_username`.
- **Anmeldung** in der App: als Gast, per E-Mail (Magic Link), später mit Google; Benutzername wählen.
- **Client-Anbindung**: Sammlung, Deck, Gold, Joker, Elo und Packs kommen aus der Datenbank statt aus dem Browser.

## Einstellungen im Supabase-Dashboard

- **Authentication → Sign In / Providers → Anonymous sign-ins**: ist schon an (für „Als Gast spielen“).
- **Authentication → Sign In / Providers → Email**: für Magic Link (kein Passwort), wenn wir die E-Mail-Anmeldung
  einbauen.
- **Authentication → Sign In / Providers → Google**: später; dafür braucht es einen Google-OAuth-Client, den du selbst
  anlegst.
- **Authentication → URL Configuration**: Site URL und Redirect URLs (Vercel-Adresse und `http://localhost:5173`),
  wenn die Anmeldung kommt.

## Zwei Werte, die du später selbst einträgst

Beide findest du im Dashboard unter **Project Settings → API** (bzw. **Data API** und **API Keys**):

| Name                     | Was                                        |
| ------------------------ | ------------------------------------------ |
| `VITE_SUPABASE_URL`      | Project URL                                |
| `VITE_SUPABASE_ANON_KEY` | anon key bzw. publishable key (öffentlich) |

Eintragen in `apps/web/.env.local` (wird nicht committet) und in Vercel unter **Settings → Environment Variables**.
Der **geheime Schlüssel** (im Dashboard „service_role“ bzw. „secret“ genannt) gehört nie in die App, in Dateien oder
in Vercel; ihn bekommen nur die Edge Functions über Supabase selbst.

## Offene Entscheidungen

1. **Wortfilter für Benutzernamen** (SPEC 9): Die Datenbank prüft nur Länge, Zeichen und Eindeutigkeit. Der Filter
   kommt in `set_username`; welche Wörter, ist offen.
2. **„Einmal kostenlos änderbar“**: Die Spalte `username_changes` zählt Umbenennungen nach der ersten Wahl. Was eine
   weitere Änderung kostet (Gold? gar nicht?), ist offen.
3. **Freundschaftskampf** (M5) bucht weder Elo noch Pack. Ob `matches` dafür eine eigene Kennzeichnung braucht, klären
   wir in M5.
4. **Konto löschen**: Löscht ein Spieler sein Konto, verschwinden auch die gemeinsamen Matches beim Gegner. Für M4
   (nur Bots) egal, für M5 zu prüfen.
5. **Startsammlung doppelt gepflegt**: Startkarten, Startdeck und Elo 1000 stehen im Trigger und in der Engine. Ein
   Test in M4 soll beide vergleichen.
