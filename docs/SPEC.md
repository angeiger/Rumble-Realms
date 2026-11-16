# Rumble Realms – Coding-Protokoll für den Coding-Agenten

Version 1.3 · Stand 16.11.2026 · Auftraggeber: Andreas

> **An den Agenten:** Dieses Dokument ist die verbindliche Spezifikation. Lies es vollständig, bevor du Code schreibst. Lege es als `docs/SPEC.md` ins Repository. Wo es eine Frage offen lässt: triff eine vernünftige Annahme, halte sie in `docs/DECISIONS.md` fest und arbeite weiter. Frag nur bei Entscheidungen, die Geld kosten, etwas veröffentlichen oder nicht rückgängig zu machen sind.

---

## 1. Kurzbeschreibung

**Rumble Realms** ist ein rundenbasiertes Auto-Battler-Kartenspiel für das Handy im comicartigen Fantasy-Stil. Es läuft als Progressive Web App (PWA) im Browser und ist auf Android und iOS installierbar.

- Spieler sammeln Einheitenkarten, leveln sie (Level 1–5) und schalten pro Karte drei Upgrades frei.
- Ein Deck besteht aus 4 Karten.
- Ein Spiel besteht aus mehreren Runden. Jede Runde: abwechselnder Draft (je 3 Karten aus einem Angebot von 3), danach kämpfen die Einheiten **selbstständig**. Wer zuletzt noch Einheiten hat, gewinnt die Runde.
- Jeder Spieler hat 4 Leben; pro verlorener Runde 1 Leben weniger. Wer 0 Leben hat, verliert das Spiel.
- Gegner: Bots in vier Stärken, später echte Spieler mit ähnlicher Elo und Freunde.
- Jeder Sieg gibt ein Belohnungspack (Kartenkopien, Gold oder Joker).
- Mehrere Arenen, freigeschaltet über die Elo-Wertung.

**Langfristiges Ziel:** Andreas spielt gegen seine Freunde auf ihren Handys.

---

## 2. Arbeitsregeln für den Agenten

1. **Arbeitsumgebung:** Arbeite ausschließlich im Projektordner (vorgesehen: Andreas' isolierte Coding-VM). Lösche nichts außerhalb des Repositorys.
2. **Meilensteine nacheinander** (Abschnitt 13). Nach jedem Meilenstein: lauffähiger Stand, alle Tests grün, kurzer Bericht an Andreas (was funktioniert, wie man es testet, was offen ist).
3. **Keine kostenpflichtigen Dienste, keine Store-Veröffentlichung, kein Versand von E-Mails o. Ä.** ohne Andreas' ausdrückliches Ja.
4. **Keine Secrets im Repo.** Nur `.env.example` committen; echte Schlüssel in `.env.local` (in `.gitignore`).
5. **Datengetrieben:** Alle Balancewerte (Werte der Einheiten, Wahrscheinlichkeiten, Kosten, Elo-Parameter) stehen ausschließlich in `packages/engine/src/data/`. Keine „magischen Zahlen“ im Code.
6. **Determinismus ist heilig** (Abschnitt 6.1). Eine ESLint-Regel verbietet `Math.random`, `Date.now`, `performance.now` und Gleitkomma-Trigonometrie im Engine-Paket.
7. **Sprache:** Code, Kommentare, Commits auf Englisch. Alle UI-Texte auf Deutsch über eine i18n-Datei (`de.json`); Englisch (`en.json`) vorbereiten.
8. **Commits:** klein, nach Conventional Commits (`feat:`, `fix:`, `test:` …). Vor jedem Commit: Lint, Typecheck, Tests.
9. **Mobile first:** Hochformat, Touch-Ziele ≥ 44 px, Safe Areas (Notch) beachten. Referenzgeräte: Pixel 9a (Android) und ein aktuelles iPhone.
10. **Platzhalter-Grafik ist ausdrücklich erlaubt**, solange sie dem Stil in Abschnitt 11 folgt. Keine Grafiken, Namen oder Logos anderer Spiele (z. B. Clash Royale) verwenden.

---

## 3. Technik-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | TypeScript (strict) | ein Code für Client, Server und Bots |
| Monorepo | pnpm Workspaces | Engine wird von Client, Server und Bot-Tools geteilt |
| Client-Framework | Vite + React | Menüs, Sammlung, Deck-Builder |
| Kampf-Rendering | PixiJS v8 (WebGL) | flüssige 2D-Sprites, viele Einheiten, 60 Bilder/s |
| Client-State | Zustand | schlank |
| PWA | vite-plugin-pwa | installierbar auf Android und iOS, Offline-Shell |
| Backend | Supabase (Auth, Postgres, Realtime, Edge Functions) | Login, Daten, Echtzeit-Mehrspieler, serverseitige Logik |
| Hosting | Vercel | automatische Deployments aus GitHub |
| Tests | Vitest (Unit), Playwright (Ende-zu-Ende) | |
| CI (Continuous Integration) | GitHub Actions | Lint, Typecheck, Tests, Build bei jedem Push |
| Später optional | Capacitor | Verpacken als echte App für Play Store / App Store |

**Repository:** **öffentlich**: `angeiger/Rumble-Realms` (bewusste Entscheidung von Andreas, 14.11.2026). Deshalb gilt Regel 2.4 (keine Secrets im Repo) besonders streng: Auch Supabase-URLs mit Service-Role-Key, Vercel-Tokens oder Testpasswörter gehören nie in Commits.

**Hosting-Konto:** Andreas hat bereits ein Vercel-Konto, das mit GitHub verbunden ist (dort läuft seine App „Life“). Rumble Realms wird dort als weiteres Projekt importiert. Der Agent legt keine Konten an.

### Ordnerstruktur

```
rumble-realms/
├─ apps/
│  └─ web/                 # Vite + React + PixiJS Client (PWA)
├─ packages/
│  ├─ engine/              # reine Spiellogik, kein DOM, deterministisch
│  │  └─ src/data/         # cards.ts, specials.ts, balance.ts, arenas.ts, progression.ts
│  └─ shared/              # Typen, Netzwerkprotokoll, Validierung (zod)
├─ supabase/
│  ├─ migrations/          # SQL-Schema + RLS-Regeln
│  └─ functions/           # Edge Functions (Deno), importieren packages/engine
├─ tools/
│  └─ sim-cli/             # Kommandozeilen-Simulation für Balancing und Bot-Tests
└─ docs/
   ├─ SPEC.md              # dieses Dokument
   ├─ DECISIONS.md         # getroffene Annahmen
   └─ BALANCE.md           # Ergebnisse der Balance-Simulationen
```

---

## 4. Spielregeln

### 4.1 Spielfeld

- Raster **12 Felder breit × 24 Felder lang**, Hochformat.
- Jeder Spieler besitzt 12 Reihen. Der lokale Spieler sieht seine Hälfte immer **unten** (Darstellung wird für den Gegner gespiegelt, die Logik nutzt feste Koordinaten: Spieler A Reihen 0–11, Spieler B Reihen 12–23).
- **Zwei Ebenen:** Boden und Luft. Pro Feld darf **höchstens eine Bodeneinheit und eine Lufteinheit** stehen.
  - Begründung: Mit nur einer Einheit pro Feld könnten Fledermäuse (die Nahkämpfer nicht angreifen können) Nahkämpfern dauerhaft den Weg versperren → Patt. Die Luftebene verhindert das.
- Zu Rundenbeginn ist das Feld **leer**. Nach jeder Runde wird es vollständig geleert.

### 4.2 Spielablauf

1. **Spielstart:** Beide Spieler haben 4 Leben. Ein Münzwurf (aus dem Match-Seed) bestimmt, wer in Runde 1 beginnt.
2. **Draft-Phase** einer Runde:
   - Die Spieler wählen **abwechselnd** je eine Karte aus einem Angebot von **3 Karten**.
   - Normalfall: jeder 3 Picks → Reihenfolge `A B A B A B`.
   - **Verlierer-Bonus:** Wer die vorige Runde verloren hat, bekommt **4 Picks, fängt an und hört auf** → `V S V S V S V` (V = Verlierer, S = Sieger).
   - Endete die vorige Runde unentschieden: neuer Münzwurf, je 3 Picks.
   - Jede gewählte Spawnkarte erzeugt sofort ihre Einheiten auf dem Feld (Abschnitt 4.4). Die Einheiten stehen still, bis der Kampf beginnt.
   - **Offene Information:** Beide Spieler sehen jederzeit alle Einheiten auf dem Feld und welche Karte der Gegner gewählt hat.
3. **Kampf-Phase:** Nach dem letzten Pick Countdown „3 – 2 – 1 – Kampf!“. Die Einheiten handeln vollständig selbstständig (Abschnitt 6).
4. **Rundenende:**
   - Hat nur noch ein Spieler Einheiten → er gewinnt die Runde, der andere verliert 1 Leben.
   - Sterben die letzten Einheiten beider Seiten im selben Tick → Unentschieden, **beide** verlieren 1 Leben.
   - **Sudden Death** ab 60 s Kampfzeit: Jeder Schaden +50 %.
   - **Zeitlimit** 90 s: Es gewinnt die Seite mit der höheren Summe aktueller Lebenspunkte (LP); bei Gleichstand Unentschieden.
5. **Spielende:** Wer 0 Leben hat, verliert. Erreichen beide gleichzeitig 0 → Unentschieden.

### 4.3 Kartenangebot pro Pick

- Grundlage ist das **Deck des Spielers (4 Karten)**.
- Für jedes Angebot werden **3 der 4 Deckkarten** zufällig (Seed) gezogen, ohne Doppelung.
- Jeder Platz kann mit einer Wahrscheinlichkeit zu einer **Sonderkarte** derselben Einheit werden:
  - Verdoppeln: 12 % pro Platz
  - Upgrade: 20 % pro Platz. Das konkrete Upgrade wird zufällig (Seed) aus den Upgrades dieser Karte gezogen, die der Spieler **bereits freigeschaltet** hat und die **in diesem Spiel noch nicht aktiv** sind. Gibt es keines → kein Upgrade auf diesem Platz.
  - Höchstens **1 Sonderkarte pro Angebot** (Startwert, konfigurierbar).
- Folge: Spiele ganz ohne Upgrades sind möglich, aber unwahrscheinlich; ebenso Spiele mit Upgrades auf mehreren Einheiten oder mit mehreren Upgrades auf derselben Einheit (bis zu allen drei). Die Wahrscheinlichkeiten werden über die Simulation so eingestellt, dass ein Spiel typischerweise 1–3 Upgrades pro Spieler sieht.
- Auswahl: **Tippen** hebt eine Karte hervor und zeigt ihre Werte; **zweites Tippen oder Button „Ausspielen“** bestätigt. Langes Drücken zeigt die Detailansicht.
- Zeitlimit pro Pick gegen echte Spieler: 15 s, danach automatischer Zufallspick. Bots wählen nach ~1 s (für das Spielgefühl).

### 4.4 Aufstellung (automatisch, in zentrierten Reihen)

Die Einheiten werden automatisch in der eigenen Hälfte aufgestellt, so nah an der eigenen Grundlinie wie möglich. Reihen gezählt von der eigenen Grundlinie (0) zur Mitte (11). Die Aufstellung wird nach jedem Pick und zu Beginn jeder Runde aus der ganzen Armee neu berechnet; früher gespielte Einheiten können dabei weiterrücken. Sie braucht keinen Zufall.

Jede Karte gehört zu einem **Rang**. Die Ränge folgen von der Grundlinie zur Feldmitte aufeinander:

| Rang (von hinten) | Karten, in dieser Reihenfolge nebeneinander |
|---|---|
| 1 (Grundlinie) | Assassine |
| 2 | Bogenschütze, Musketier, Pyromantin, Nekromant, Frostschamane, Bombardierkäfer |
| 3 | Heiler; auf der Luftebene darüber: Fledermäuse, Drachenjunges |
| 4 | Ritter, Berserker, Steingolem |
| 5 | Lauf-TNT, Pilzlinge |
| 6 (vorne) | Skelette |

- Jeder Rang belegt eigene Reihen. Ein Rang ohne Einheiten belegt keine Reihe; der nächste Rang beginnt direkt davor.
- Innerhalb eines Rangs stehen die Karten in der Reihenfolge der Tabelle nebeneinander, aus Sicht des Spielers von links nach rechts; Einheiten derselben Karte in der Reihenfolge, in der sie gespielt wurden.
- Eine Reihe fasst 12 Einheiten. Hat ein Rang mehr, stehen die vollen Reihen hinten und der Rest in einer weiteren Reihe davor.
- **Jede Reihe steht mittig.** Kommen Einheiten dazu, wird die Reihe neu zentriert. Bleibt eine ungerade Zahl von Feldern frei, steht die Reihe aus Sicht des Spielers ein halbes Feld links der Mitte.
- Flieger stehen auf der Luftebene über dem Rang der Heiler und werden für sich zentriert. Der Rang ist so tief wie die vollere der beiden Ebenen.
- Einheiten, deren Reihe nicht mehr in die eigene Hälfte passt, verfallen (mit kurzer Anzeige).
- Die Angabe „Zone“ (vorne, Mitte, hinten) in Abschnitt 5.2 beschreibt nur noch grob, wo eine Einheit steht; maßgeblich ist der Rang.

### 4.5 Sonderkarten

| Karte | Wirkung |
|---|---|
| **Doppelpack** (Verdoppeln) | spawnt die **doppelte Anzahl** der Einheit (z. B. 10 statt 5 Skelette) |
| **Aufrüstung** (Upgrade) | zeigt ein **bestimmtes** freigeschaltetes Upgrade (z. B. „Ritter: Schild“). Gewählt, ist es **für den Rest des ganzen Spiels** aktiv – für alle Einheiten dieser Art des Spielers, die gerade auf dem Feld stehen oder später (auch in späteren Runden) gespawnt werden. Mehrere Upgrades derselben Einheit stapeln sich. Spawnt selbst keine Einheiten. Aktive Upgrades werden neben den Leben als Symbole angezeigt (für beide Spieler sichtbar). |

Ideen für später (Meilenstein 6, nicht im MVP = Minimum Viable Product):
- **Elite:** Eine Einheit der Art wird zum Champion (doppelte LP und doppelter Schaden, größere Figur).
- **Kriegstrommel:** Alle eigenen Einheiten +20 % Angriffstempo in dieser Runde.
- **Nachschub:** +1 Einheit für jede eigene Einheitenart, die bereits auf dem Feld steht.

---

## 5. Einheiten

### 5.1 Begriffe

- **Anzahl:** Einheiten pro gespielter Karte.
- **LP:** Lebenspunkte. **Intervall:** Sekunden zwischen zwei Angriffen. **Reichweite** in Feldern. **Tempo** in Feldern pro Sekunde.
- **Ziele:** Boden, Luft oder beides. **Nur Fernkampf-Einheiten** (Reichweite ≥ 2) können Lufteinheiten angreifen.
- **Fläche r X:** Flächenschaden im Radius X Feldern um den Einschlag.
- Alle Werte sind **Startwerte auf Level 1** und werden über die Balance-Simulation (Abschnitt 12) feinjustiert.

### 5.2 Werte der Einheiten (Level 1)

| ID | Name | Anzahl | Rolle / Zone | LP | Schaden | Intervall | Reichweite | Tempo | Ziele | Seltenheit | Arena |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `archer` | Bogenschütze | 3 | Fernkampf / hinten | 120 | 24 | 1,0 | 5 | 1,0 | Boden + Luft | Gewöhnlich | 1 |
| `knight` | Ritter | 2 | Tank / vorne | 560 | 60 | 1,2 | 1 | 0,8 | Boden | Gewöhnlich | 1 |
| `tnt` | Lauf-TNT | 3 | Bombe / vorne | 180 | 250 (Fläche r 1,5) | einmalig | Lunte ab 2 Feldern | 2,0 | Boden | Selten | 1 |
| `skeleton` | Skelette | 5 | Schwarm / vorne | 210 | 27 | 0,7 | 1 | 1,8 | Boden | Gewöhnlich | 1 |
| `healer` | Heiler | 2 | Support / Mitte | 230 | heilt 50 | 1,5 | 3 | 0,9 | Verbündete | Selten | 1 |
| `musketeer` | Musketier | 1 | Fernkampf / hinten | 360 | 105 | 2,5 | 8 | 0,9 | Boden + Luft | Selten | 1 |
| `bat` | Fledermäuse | 3 | Flieger / Mitte | 90 | 26 | 0,8 | 1 | 1,6 | Boden + Luft | Gewöhnlich | 1 |
| `assassin` | Assassine | 3 | Nahkampf / Mitte | 250 | 46 | 0,9 | 1 | 1,4 | Boden | Selten | 2 |
| `berserker` | Berserker | 1 | Tank-Nahkampf / vorne | 900 | 70 | 1,4 → 0,6 | 1 | 0,9 | Boden | Episch | 2 |
| `shroomling` | Pilzlinge | 4 | Schwarm / vorne | 200 | 28 | 1,0 | 1 | 1,0 | Boden | Gewöhnlich | 2 |
| `pyromancer` | Pyromantin | 1 | Magier / hinten | 250 | 58 (Fläche r 1) | 1,8 | 4 | 0,9 | Boden + Luft | Selten | 2 |
| `necromancer` | Nekromant | 1 | Beschwörer / hinten | 300 | 25 | 1,2 | 3 | 0,8 | Boden + Luft | Episch | 2 |
| `beetle` | Bombardierkäfer | 1 | Artillerie / hinten | 350 | 110 (Fläche r 1) | 6,0 | ganzes Feld | 0,4 | Boden | Episch | 3 |
| `golem` | Steingolem | 1 | Tank / vorne | 1600 | 90 | 2,0 | 1 | 0,5 | Boden | Episch | 3 |
| `frost_shaman` | Frostschamane | 1 | Support / hinten | 360 | 54 + 30 % langsamer (2 s) | 1,2 | 5 | 0,9 | Boden + Luft | Selten | 4 |
| `whelp` | Drachenjunges | 1 | Flieger / Mitte | 400 | 44 (Fläche r 1) | 1,8 | 2 | 1,1 | Boden + Luft | Episch | 5 |

Fliegend: `bat`, `whelp` (Luftebene, nur von Fernkampf angreifbar).

Die Werte sind der Stand nach der ersten Balance-Runde (16.11.2026, `docs/DECISIONS.md` D-078). Maßgeblich im Code ist `packages/engine/src/data/cards.ts`.

### 5.3 Besonderheiten der Grundeinheiten

- **Lauf-TNT:** läuft zum nächsten Bodengegner und behält dieses Ziel, bis es stirbt oder nicht mehr anvisierbar ist. Kommt ein Bodengegner bis auf 2 Felder heran, brennt die Lunte (1,25 s); das TNT läuft dabei weiter. Ist am Ende der Lunte noch ein Gegner im Umkreis, explodiert es; sonst erlischt die Lunte und beginnt beim nächsten Mal von vorn. Stirbt es durch Schaden, explodiert es sofort. Zerstört sich dabei selbst. Kein Eigenschaden für Verbündete.
- **Heiler:** heilt die verbündete Einheit mit dem niedrigsten LP-Anteil in Reichweite 3; läuft dorthin, wenn niemand in Reichweite ist. Ohne verletzte Verbündete folgt er der nächsten verbündeten Einheit mit 2 Feldern Abstand. Sind keine Verbündeten mehr übrig, läuft er zum nächsten Gegner und greift im Nahkampf mit 10 Schaden an (damit Runden enden).
- **Assassine:** Fähigkeit „Schattensprung“ zu **Beginn jeder Kampfphase**: 2,5 s Animation (sichtbar aufladend, in dieser Zeit angreifbar), dann Teleport auf das Feld, auf dem der bei Kampfbeginn **am weitesten entfernte** Bodengegner zu Kampfbeginn stand. Ist das Feld belegt, nächstgelegenes freies Bodenfeld. Danach normaler Nahkampf.
- **Musketier:** weniger Schaden pro Sekunde als drei Bogenschützen (42 vs. 72), dafür viel größere Reichweite und mehr Schaden pro Schuss.
- **Fledermäuse:** fliegend; können Boden und Luft angreifen; nur von Fernkampf-Einheiten treffbar.
- **Berserker:** Angriffsintervall sinkt linear mit fehlenden LP: `Intervall = 1,4 − 0,8 × (1 − LP / maxLP)`. Lebensraub 25 % des verursachten Schadens.
- **Pilzlinge:** Beim Tod entsteht eine Sporenwolke (r 1, 25 Schaden/s für 3 s, nur Gegner).
- **Nekromant:** beschwört alle 4 s ein Skelett (Level des Nekromanten, max. 4 gleichzeitig) auf einem freien Nachbarfeld; greift zusätzlich selbst an. Ein beschworenes Skelett ist schwächer als ein Skelett aus der Karte „Skelette“: 30 % der LP und 75 % des Schadens (Level 1: 63 LP, 20 Schaden). Das gilt auch für die Skelette aus „Knochenarmee“ und „Seelenernte“. Beschworene Skelette sehen anders aus als Karten-Skelette, damit man sie unterscheiden kann.
- **Bombardierkäfer:** Reichweite über das ganze Feld. Schießt ein langsames Geschoss (Flugzeit 1,5 s) auf das **Feld**, auf dem das Ziel beim Abschuss steht – bewegliche Ziele können ausweichen. Mindestreichweite 2. (Name angelehnt an den echten Bombardierkäfer, der eine heiße chemische Reaktion verspritzt.)
- **Steingolem:** sehr langsam, sehr viele LP.
- **Frostschamane:** Treffer verlangsamen Bewegung und Angriffstempo des Ziels um 30 % für 2 s (erneuert, stapelt nicht).

### 5.4 Upgrades (drei pro Karte)

Freischaltung über die Sammlung (Abschnitt 7.3). Nur freigeschaltete Upgrades können im Spiel als Aufrüstungskarte erscheinen (Abschnitt 4.3). Alle drei Upgrades einer Karte müssen sich kombinieren lassen (Tests!).

| Karte | Upgrade 1 | Upgrade 2 | Upgrade 3 |
|---|---|---|---|
| Bogenschütze | **Feuerpfeile:** Treffer setzen 3 s in Brand (8 Schaden/s) | **Salve:** jeder 4. Schuss trifft bis zu 3 Ziele | **Adlerauge:** +2 Reichweite |
| Ritter | **Schild:** absorbiert die ersten 250 Schaden | **Ansturm:** erster Treffer nach Bewegung doppelter Schaden + 0,5 s Betäubung | **Spott:** Gegner in Radius 2 müssen ihn angreifen, wenn sie können |
| Lauf-TNT | **Tochter-TNT:** nach der Explosion spawnt 1 Mini-TNT (50 % LP, 50 % Schaden), das selbst keine Tochter erzeugt | **Kurze Lunte:** +60 % Tempo | **Panzerkiste:** +100 % LP |
| Skelette | **Untot:** 2 s nach dem Tod einmalig Auferstehung als Zombie mit 40 % LP | **Knochenhagel:** beim Tod 15 Schaden an allen angrenzenden Gegnern | **Rasselbande:** +2 Skelette pro Karte |
| Heiler | **Heilkreis:** heilt alle Verbündeten in Radius 2 mit je 60 % der Heilung | **Wiederbelebung:** einmal pro Runde kehrt die erste Verbündete, die in Reichweite stirbt, mit 50 % LP zurück | **Segen:** Geheilte erhalten 3 s lang +20 % Schaden |
| Musketier | **Durchschlag:** Kugel trifft zusätzlich den Gegner direkt dahinter mit 50 % | **Kopfschuss:** erster Schuss jeder Runde 3-facher Schaden | **Bajonett:** grenzt ein Gegner an, Nahkampf 45 Schaden / 1,0 s statt Schuss |
| Fledermäuse | **Blutdurst:** 40 % Lebensraub | **Schwarm:** +2 Fledermäuse | **Ultraschall:** Treffer verlangsamen das Angriffstempo des Ziels um 25 % für 2 s |
| Assassine | **Gift:** Treffer vergiften (12 Schaden/s für 4 s, erneuert) | **Schattenschritt:** stirbt sein Ziel, springt er erneut zum am weitesten entfernten Gegner (Abklingzeit 6 s) | **Rauchbombe:** nach jedem Sprung 2 s nicht anvisierbar |
| Berserker | **Unbändig:** fällt unter 20 % LP → 2 s unverwundbar (einmal pro Runde) | **Wirbelwind:** jeder 3. Angriff trifft alle angrenzenden Gegner | **Blutrausch:** jeder Kill heilt 15 % der max. LP |
| Pilzlinge | **Riesenpilz:** einer der vier wird groß (3-fache LP und 3-facher Schaden) | **Ansteckend:** vergiftete Gegner setzen beim Tod selbst eine Sporenwolke frei | **Myzel:** benachbarte Pilzlinge heilen sich gegenseitig um 5 LP/s |
| Pyromantin | **Inferno:** Ziele brennen 3 s (15 Schaden/s) | **Meteor:** alle 10 s Meteor auf die größte Gegnergruppe (200 Schaden, r 1,5) | **Hitzeschild:** die ersten 2 Treffer gegen sie werden ignoriert |
| Nekromant | **Knochenarmee:** alle 3 s, max. 6 Skelette | **Seelenernte:** stirbt ein Gegner in Radius 3, sofort +1 Skelett | **Lich-Form:** beim Tod einmalig Rückkehr als fliegender Geist mit 50 % LP |
| Bombardierkäfer | **Säurepfütze:** Einschlag hinterlässt 3 s Säure (25 Schaden/s) | **Doppelladung:** 2 Geschosse auf 2 verschiedene Ziele, je 60 % Schaden | **Chitinpanzer:** +60 % LP, Nahkampf-Angreifer erleiden 15 Rückschaden |
| Steingolem | **Steinhaut:** −20 % erlittener Schaden | **Erdstoß:** alle 6 s 60 Flächenschaden (r 1,5) + 30 % Verlangsamung für 2 s | **Geröll:** beim Tod 3 Mini-Golems mit 20 % der Werte |
| Frostschamane | **Eisblock:** jeder 4. Treffer friert das Ziel 1 s ein | **Frostnova:** zu Kampfbeginn und alle 12 s friert Gegner in Radius 2 für 1,5 s ein | **Eisrüstung:** Nahkampf-Angreifer werden verlangsamt |
| Drachenjunges | **Feueratem:** Kegel-Flächenschaden statt Kreis, +1 Reichweite | **Glutschuppen:** +40 % LP | **Wachstum:** alle 10 s +15 % Schaden und Größe (max. 3-mal) |

---

## 6. Kampf-Simulation

### 6.1 Determinismus (Pflicht)

Die Engine muss bei gleichem **Seed + gleichen Picks + gleicher Engine-Version** auf jedem Gerät exakt dasselbe Ergebnis liefern. Das ist die Grundlage für Bots, Replays, serverseitige Prüfung und Online-Mehrspieler (nur die Picks werden übertragen, nicht der Kampf).

- Fester Takt: **20 Ticks pro Sekunde** (50 ms). Alle Zeiten intern in Ticks.
- **Nur Ganzzahlen** in der Simulation: Positionen in Milli-Feldern, LP als Ganzzahl, Prozente als Basispunkte (1 % = 100). Distanzvergleiche über **quadrierte** Abstände, keine Wurzeln, kein `Math.sin/cos`.
- Zufall nur über einen eigenen Seed-Zufallsgenerator (z. B. `xoshiro128**`), getrennte Streams für Angebote und Kampf (die Aufstellung braucht keinen Zufall, Abschnitt 4.4).
- Feste Verarbeitungsreihenfolge: Einheiten sortiert nach `unitId` (aufsteigend, beim Spawn vergeben). Tode werden **am Ende** eines Ticks gemeinsam verarbeitet (gleichzeitige Tode möglich).
- `ENGINE_VERSION` als Konstante; jedes gespeicherte Match enthält sie.
- Test: Gleicher Input → gleicher Zustands-Hash nach dem Kampf (Abschnitt 12).

### 6.2 Verhalten pro Tick

1. **Statuseffekte** fortschreiben (Brand, Gift, Verlangsamung, Einfrieren, Schild).
2. **Zielwahl:** nächstgelegener angreifbarer Gegner (euklidischer Abstand der Feldmitten). Gleichstand → geringerer Reihenabstand, dann kleinere `unitId`. Neubewertung alle 0,5 s oder wenn das Ziel stirbt. Ausnahmen: Heiler (Verbündete), Assassine (Sprung), Spott.
3. **Angriff,** wenn das Ziel in Reichweite ist und der Angriff abgeklungen ist.
   - Nahkampf: Reichweite 1 = alle 8 Nachbarfelder.
   - Fernkampf (Bogen, Muskete, Magie): zielsuchendes Geschoss mit Flugzeit; trifft sicher, wenn das Ziel beim Einschlag noch lebt, sonst verpufft es.
   - Artillerie (Käfer): Geschoss auf ein Feld, Flächenschaden beim Einschlag.
4. **Bewegung,** wenn das Ziel nicht in Reichweite ist: 8-Richtungs-Raster. Die Einheit **reserviert** das nächste Feld beim Start eines Schritts (verhindert Doppelbelegung). Wahl des Feldes: freies Nachbarfeld, das den Abstand zum Ziel am stärksten verringert. Steckt eine Einheit > 1 s fest, A*-Pfadsuche auf ihrer Ebene. Lufteinheiten ignorieren den Boden.
5. **Tode** verarbeiten, Todeseffekte auslösen (Explosion, Sporen, Auferstehung …).
6. **Rundenende prüfen** (Abschnitt 4.2).

### 6.3 Level-Skalierung

Pro Level über 1: **+10 % LP und +10 % Schaden** (additiv; Level 5 = 140 %). Heilung skaliert wie Schaden.

### 6.4 Engine-Schnittstelle (Vorschlag)

```ts
createMatch(cfg: MatchConfig): MatchState            // Seed, Decks, Kartenlevel, Upgrades
getOffer(state: MatchState): Offer                   // 3 Karten für den Spieler am Zug
applyPick(state: MatchState, slot: 0|1|2): MatchState
startBattle(state: MatchState): BattleState
stepTick(battle: BattleState): TickEvents            // vom Renderer im Takt aufgerufen
simulateToEnd(battle: BattleState): BattleResult     // für Bots, Server, Tests
hashState(s: MatchState | BattleState): string
```

Der Renderer interpoliert zwischen Ticks und spielt Ereignisse ab (Treffer, Tod, Sprung, Explosion). Er verändert den Zustand nie selbst. Kampfgeschwindigkeit 1× / 2× ist reine Anzeige.

---

## 7. Meta-Spiel und Fortschritt

### 7.1 Sammlung

- Eine Karte ist freigeschaltet, sobald der Spieler mindestens 1 Kopie besitzt.
- **Startsammlung** für neue Spieler (Level 1): Bogenschütze, Ritter, Skelette, Fledermäuse, Lauf-TNT, Heiler. Startdeck: Bogenschütze, Ritter, Skelette, Heiler.
- Kartenkopien wirken wie Erfahrungspunkte der Karte: Man sammelt sie und investiert sie zusammen mit Gold in Level-Ups.

### 7.2 Level-Up (bis Level 5)

| Level-Up | Kopien Gewöhnlich | Kopien Selten | Kopien Episch | Gold |
|---|---|---|---|---|
| 1 → 2 | 5 | 3 | 1 | 100 |
| 2 → 3 | 10 | 6 | 3 | 300 |
| 3 → 4 | 20 | 12 | 6 | 800 |
| 4 → 5 | 40 | 24 | 12 | 2000 |

### 7.3 Upgrades freischalten

| Upgrade | benötigtes Kartenlevel | Gold |
|---|---|---|
| Upgrade 1 | 2 | 200 |
| Upgrade 2 | 3 | 600 |
| Upgrade 3 | 5 | 1500 |

Jedes freigeschaltete Upgrade kommt automatisch in den Zufallspool für Aufrüstungskarten. Es gibt keine Ausrüst-Auswahl.

### 7.4 Belohnungspack (nach jedem Sieg)

Jedes Pack enthält **eine** zufällige Belohnung (serverseitig gewürfelt):

| Belohnung | Wahrscheinlichkeit | Inhalt |
|---|---|---|
| Kartenkopien | 60 % | eine zufällige Karte aus dem Pool der freigeschalteten Arenen. Seltenheit: Gewöhnlich 70 % (3–8 Kopien), Selten 25 % (2–4), Episch 5 % (1–2) |
| Gold | 30 % | 50–150 × Arena-Multiplikator |
| Joker | 10 % | 1–3 Joker |

- **Joker** sind universell: 1 Joker = 1 Kopie Gewöhnlich, 2 Joker = 1 Kopie Selten, 4 Joker = 1 Kopie Episch. Damit kann man Kopien zu **jeder** Karte aus den freigeschalteten Arenen hinzufügen – auch zu einer, die man noch nicht besitzt (schaltet sie frei).
- Niederlage: 10 Gold Trostpreis, kein Pack.
- Pack-Öffnung mit Comic-Animation (Truhe wackelt, springt auf, Belohnung fliegt heraus).

### 7.5 Arenen und Elo

**Elo:** Startwert 1000. Erwartung `E = 1 / (1 + 10^((Rgegner − Rselbst) / 400))`, Änderung `K × (Ergebnis − E)` mit Ergebnis 1 / 0,5 / 0. K = 48 in den ersten 20 Spielen, danach 32. Gegen Bots K halbiert.

| Arena | Name | ab Elo | Neue Karten im Pool | Gold-Multiplikator |
|---|---|---|---|---|
| 1 | Grünwiesen-Dorf | 0 | Bogenschütze, Ritter, Skelette, Fledermäuse, Lauf-TNT, Heiler, Musketier | 1,0 |
| 2 | Knochensumpf | 1100 | Assassine, Berserker, Pilzlinge, Pyromantin, Nekromant | 1,2 |
| 3 | Goblin-Minen | 1250 | Bombardierkäfer, Steingolem | 1,4 |
| 4 | Frostgipfel | 1400 | Frostschamane | 1,6 |
| 5 | Drachenhort | 1600 | Drachenjunges | 2,0 |

- Eine einmal erreichte Arena bleibt freigeschaltet (Kartenpool), auch wenn die Elo wieder sinkt. Die angezeigte Arena-Kulisse folgt der aktuellen Elo.
- Jede Arena hat eine eigene Kampffeld-Kulisse.

---

## 8. Gegner

### 8.1 Bots

| Stufe | Bot-Elo | Kartenlevel | Pick-Strategie |
|---|---|---|---|
| Leicht | 800 | 1 | zufällig |
| Mittel | 1000 | 2 | Heuristik: Konter wählen (z. B. Fernkampf gegen Flieger, Flächenschaden gegen Schwärme) |
| Schwer | 1250 | 3 | für jede der 3 Optionen den Rest der Runde mehrfach simulieren (Monte Carlo mit zufälligen Folge-Picks), beste wählen |
| Meister | 1500 | 4–5 | wie Schwer, mehr Simulationen, gute Upgrades |

Bot-Decks: vordefinierte, thematisch sinnvolle Decks aus dem Pool der Arena des Spielers. Bots bekommen comichafte Namen („Goblin-Gustav“, „Lady Knochenkralle“ …).

### 8.2 Matchmaking (Meilenstein 5)

- Warteschlange: Gegner mit Elo-Differenz ≤ 100; alle 5 s um 50 erweitert.
- Nach 20 s ohne menschlichen Gegner: Bot mit passender Elo (für den Spieler transparent als Bot gekennzeichnet).
- **Freundschaftskampf:** Freund herausfordern oder Einladungslink teilen (`/join/<code>`). Ohne Elo-Änderung und ohne Pack.

---

## 9. Onboarding

1. **Titelbildschirm** mit Logo „Rumble Realms“ und Button „Spielen“.
2. **Anmelden** (Supabase Auth):
   - „Mit Google anmelden“
   - „Mit E-Mail anmelden“ (Magic Link, kein Passwort)
   - „Als Gast spielen“ (anonymes Konto, später mit Google/E-Mail verknüpfbar, Fortschritt bleibt erhalten)
3. **Benutzername wählen:** 3–16 Zeichen, nur `a–z A–Z 0–9 _`, eindeutig ohne Rücksicht auf Groß-/Kleinschreibung, Live-Prüfung auf Verfügbarkeit, einfacher Wortfilter. Einmal kostenlos änderbar.
4. **Tutorial-Kampf** (überspringbar) gegen einen geskripteten Bot, kurze Sprechblasen eines Maskottchens:
   - „Wähle eine Karte!“ → „Deine Einheiten kämpfen ganz von allein.“ → „Du hast 4 Leben – verlierst du eine Runde, ist eins weg.“ → „Wer eine Runde verliert, bekommt nächste Runde eine Karte extra.“
5. **Erstes Belohnungspack** (garantiert Musketier).
6. **Kurze Einführung** in Sammlung und Deck-Builder (Hinweis-Pfeile).
7. **Startbildschirm.**

Ziel: vom ersten Öffnen bis zum ersten echten Kampf unter 3 Minuten.

---

## 10. Bildschirme

| Bildschirm | Inhalt |
|---|---|
| Start | Arena-Kulisse, großer „Kampf!“-Button, Elo, Gold, Joker, Arena-Name, Bot-Stufe wählbar |
| Sammlung | alle Karten (gesperrte grau), Level, Kopien-Fortschrittsbalken, Level-Up, Upgrades freischalten, Detailansicht mit Werten |
| Deck | 4 Plätze, Karten per Tippen tauschen, freigeschaltete Upgrades pro Karte als Symbole sichtbar |
| Kampf | oben Gegnername + Leben (Herzen), Spielfeld, unten die 3 Angebotskarten + „Ausspielen“; Anzeige, wer am Zug ist und wie viele Picks übrig sind; während des Kampfes verschwindet die Kartenleiste und das Feld wird größer |
| Ergebnis | Sieg/Niederlage, Elo-Änderung, Pack öffnen |
| Rangliste | Freunde und global |
| Freunde | per Benutzername hinzufügen, Anfragen, Herausfordern |
| Profil / Einstellungen | Ton, Sprache, Kampfgeschwindigkeit, Konto verknüpfen, Abmelden |

**Layout-Hinweis:** 24 Reihen passen auf dem Handy nur knapp. Das Feld skaliert auf den verfügbaren Platz; Figuren werden etwa 1,3-mal so groß wie ein Feld gezeichnet (dürfen überlappen), damit sie gut erkennbar bleiben.

---

## 11. Grafik- und Tonstil

- **Comicartiger Fantasy-Stil:** dicke dunkle Konturen, kräftige gesättigte Farben, gedrungene „Chibi“-Proportionen (großer Kopf), übertriebene Animationen (Squash & Stretch), Treffer-Aufblitzen, hüpfende Schadenszahlen, Bildschirmwackeln bei Explosionen, Staubwolken.
- **Teamfarben:** Blau (eigene) vs. Orange-Rot (Gegner), zusätzlich unterschiedliche Fahnen-Symbole am Ring unter der Figur (farbenblind-freundlich).
- **Schriften:** z. B. „Lilita One“ für Überschriften, „Nunito“ für Text (Google Fonts, freie Lizenz).
- **MVP-Grafik:** Der Agent zeichnet Platzhalter-Figuren als Vektorgrafik (SVG bzw. PixiJS Graphics) im obigen Stil: Grundform + Kontur + Waffe/Merkmal + Teamring. Pro Einheit Zustände Stehen, Laufen, Angriff, Tod (einfache Transform-Animationen reichen).
- **Später:** Austausch gegen echte Sprites; Ordner `apps/web/public/assets/units/<id>/` mit klarer Benennung vorbereiten.
- **Ton (Meilenstein 6):** freie Soundeffekte (z. B. Kenney.nl, CC0), kurze fröhliche Musikschleife. Auf iOS muss Audio nach der ersten Berührung entsperrt werden.

---

## 12. Tests und Balancing

- **Unit-Tests (Vitest):** Zielwahl, Bewegung/Reservierung, jede Einheitenfähigkeit, jedes Upgrade, Sonderkarten, Draft-Reihenfolge inkl. Verlierer-Bonus, Leben und Rundenende, Elo-Formel, Pack-Wahrscheinlichkeiten, Level-Kosten.
- **Determinismus-Test:** 200 zufällige Matches je zweimal simulieren → identische Hashes. Zusätzlich ein gespeichertes „Golden Replay“, dessen Hash sich nur mit bewusster Erhöhung von `ENGINE_VERSION` ändern darf.
- **Robustheitstest:** 10 000 Zufallsmatches ohne Absturz, ohne Endlosschleife, jede Runde endet spätestens nach 90 s.
- **Balance-Tool (`tools/sim-cli`):** simuliert ganze Matches mit zufälligen Decks aus vier Karten sowie feste Decks gegeneinander und schreibt die Ergebnisse nach `docs/BALANCE.md`. **Maßstab ist die Siegquote je Karte im Deck:** Ziel 45–55 %, auffällig unter 42 % oder über 58 %. Der Vergleich jeder Karte gegen jede (gleiches Level, gleiche Anzahl Picks) bleibt als Zusatzinformation im Bericht, ist aber kein Ziel mehr: Im Duell einzelner Karten gewinnen Flieger zwangsläufig gegen alles ohne Fernkampf, und Heiler können allein nicht gewinnen.
- **Ende-zu-Ende (Playwright, mobiles Viewport):** Onboarding als Gast → Benutzername → Botkampf gewinnen → Pack öffnen → Level-Up.

---

## 13. Meilensteine

| # | Meilenstein | Ergebnis / Abnahme |
|---|---|---|
| M0 | Projektgerüst | Monorepo, Lint, Typecheck, Vitest, GitHub Actions, Vercel-Vorschau-Deployment einer leeren PWA |
| M1 | Engine ohne Grafik | Raster, Ebenen, Platzierung, Zielwahl, Bewegung, Kampf, Rundenende, Leben, Draft inkl. Verlierer-Bonus; die 10 Ursprungseinheiten ohne Upgrades; CLI kann ein Match simulieren; Determinismus-Test grün |
| M2 | Spielbarer Prototyp | Kampf-Renderer (PixiJS), Draft-Oberfläche, lokales Spiel gegen Bot „Leicht“ mit festen Decks; als PWA auf dem Handy installierbar und flüssig |
| M3 | Volle Kampfmechanik | Sonderkarten, alle 48 Upgrades, alle 16 Einheiten, Bots „Mittel“ und „Schwer“, Balance-Tool, erste Balance-Runde |
| M4 | Konten und Fortschritt | Supabase: Login, Onboarding, Benutzername, Sammlung, Level-Up, Upgrades freischalten, Packs, Gold, Joker, Deck-Builder, Arenen, Elo gegen Bots – alles serverseitig abgesichert |
| M5 | Online gegen Freunde | Freundesliste, Freundschaftskampf per Einladung, Matchmaking nach Elo, Wiederverbinden, Bot „Meister“ |
| M6 | Feinschliff | Tutorial, Pack-Animationen, Ton, Kulissen pro Arena, Leistungsoptimierung, weitere Sonderkarten, optional Push-Benachrichtigungen und Capacitor-Verpackung |

---

## 14. Backend (Supabase)

### 14.1 Tabellen

```sql
profiles        (id uuid pk = auth.uid, username citext unique, elo int default 1000,
                 highest_arena int default 1, gold int default 0, jokers int default 0,
                 games_played int default 0, created_at timestamptz)
player_cards    (user_id uuid, card_id text, level int default 1, copies int default 0,
                 unlocked_upgrades int default 0,   -- Bitmaske 0b111
                 primary key (user_id, card_id))
decks           (user_id uuid pk, cards text[4])
matches         (id uuid pk, player_a uuid, player_b uuid null, bot_level text null,
                 seed bigint, engine_version int, picks jsonb, result text,
                 elo_delta_a int, elo_delta_b int, created_at timestamptz)
packs           (id uuid pk, user_id uuid, match_id uuid, opened bool default false,
                 contents jsonb null)
friendships     (user_id uuid, friend_id uuid, status text, primary key (user_id, friend_id))
```

Die Kartendefinitionen liegen **im Code** (`packages/engine/src/data`), nicht in der Datenbank.

### 14.2 Sicherheit

- **RLS (Row Level Security)** auf allen Tabellen: Spieler lesen nur ihre eigenen Daten (plus öffentliche Profilfelder wie Benutzername und Elo).
- **Der Client schreibt nie direkt** Gold, Karten, Elo oder Packs. Alles läuft über Edge Functions:
  - `create_match` → erzeugt Seed und Match-Eintrag
  - `report_match` → simuliert das Match mit der Engine **auf dem Server nach**, prüft das Ergebnis, bucht Elo und erzeugt bei Sieg ein Pack
  - `open_pack`, `level_up_card`, `unlock_upgrade`, `spend_jokers`, `set_deck`, `set_username`
- Die Edge Functions importieren dasselbe Engine-Paket wie der Client.

### 14.3 Online-Mehrspieler (Meilenstein 5)

- Weil der Kampf deterministisch ist, werden **nur die Picks** übertragen (Lockstep).
- Kanal: Supabase Realtime Broadcast `match:<id>`. Nachricht: `{ pickIndex, slot }`.
- Angebote werden aus dem Server-Seed abgeleitet, beide Clients berechnen sie identisch.
- Jeder Pick wird zusätzlich in `matches.picks` gespeichert (für Wiederverbinden und Prüfung).
- Nach dem Draft simulieren beide Clients lokal; beide melden ihren Ergebnis-Hash; der Server simuliert nach und bucht.
- Verbindungsabbruch: 30 s Gnadenfrist, sonst Aufgabe. Zug-Zeitlimit 15 s.

---

## 15. Plattform-Hinweise

- **PWA-Manifest:** Name „Rumble Realms“, Hochformat, Vollbild (`display: standalone`), App-Icons 192/512 px plus Apple-Touch-Icon.
- **iOS:** Installation über Safari → Teilen → „Zum Home-Bildschirm“. Ausrichtung lässt sich dort nicht per Manifest sperren → bei Querformat ein Hinweis „Bitte drehen“ anzeigen. Web-Push nur für installierte PWAs ab iOS 16.4.
- **Android:** Installations-Banner von Chrome nutzen (`beforeinstallprompt`).
- **Leistung:** Ziel 60 Bilder/s auf einem Mittelklasse-Handy bei bis zu ~100 Einheiten; Sprites als Texture-Atlas; Objekt-Pools für Geschosse und Schadenszahlen.
- **Store-Veröffentlichung (später, nur nach Andreas' Ja):** Wird Google-Login in einer iOS-App angeboten, verlangt Apple zusätzlich „Sign in with Apple“.

---

## 16. Offene Punkte (vor bzw. während der Umsetzung klären)

1. **Wahrscheinlichkeit der Aufrüstungskarten:** Startwert 20 % pro Platz; nach ersten Testspielen anpassen.
2. **Einheitenanzahl:** Die Angaben (z. B. Skelette 5×) sind als Einheiten pro Karte umgesetzt, nicht als zufällige 1–3.
3. **Luftebene:** bewusste Abweichung von „eine Einheit pro Feld“ (siehe 4.1).
4. **Grafik:** Platzhalter-Vektorfiguren im MVP – später eigene/generierte Artworks oder Assetpakete?
5. **Name:** „Rumble Realms“ vor einer öffentlichen Veröffentlichung auf Markenrechte und bestehende Apps prüfen.
6. **Pack-Limit:** Unbegrenzt Packs gegen Bots ist für das Spielen unter Freunden in Ordnung; bei größerer Spielerzahl ggf. Tageslimit.
