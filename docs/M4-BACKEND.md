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
| `matches`         | Matches: Spieler, Bot-Stufe, Seed, Engine-Version, Picks, Ergebnis  | beide Beteiligten         |
| `packs`           | Belohnungspacks: geöffnet ja/nein, Inhalt                           | nur der Besitzer          |
| `friendships`     | Freundschaftsanfragen und Freunde (eine Zeile pro Paar)             | beide Seiten              |

Bei jeder neuen Anmeldung (auch als Gast) legt ein Trigger automatisch an: Profil (Elo 1000, Gold 0, Arena 1, noch
kein Benutzername), die sechs Startkarten (Bogenschütze, Ritter, Skelette, Fledermäuse, Lauf-TNT, Heiler; Level 1,
je 1 Kopie) und das Startdeck (Bogenschütze, Ritter, Skelette, Heiler). Wird ein Konto gelöscht, verschwinden
seine Daten mit.

**Sicherheit:** Die App darf nur lesen, nie schreiben, nicht einmal die eigene Zeile. Gold, Karten, Elo und Packs
ändern später ausschließlich die Edge Functions auf dem Server. Wer nicht angemeldet ist, sieht gar nichts. Die
Datenbank lehnt außerdem ungültige Werte selbst ab (z. B. Benutzername mit Leerzeichen, doppelter Name in anderer
Schreibweise, Level 6, negatives Gold, Deck mit 3 Karten).

## Lokal testen

In der VM (PostgreSQL ist installiert):

```bash
bash supabase/tests/run_local.sh
```

Das Skript legt eine Wegwerf-Datenbank `rr_test` an, baut das Nötigste von Supabase nach, spielt die Migration und
die Tests ein und löscht die Datenbank wieder. Am Ende steht `OK: … assertions passed.`, bei einem Fehler bricht es
mit `FAILED: …` ab. Mit `--keep` bleibt die Datenbank zum Nachschauen stehen. Ein Supabase-Konto oder Passwort
braucht es dafür nicht.

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
