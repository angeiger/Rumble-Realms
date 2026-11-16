# Balance-Bericht

> Erzeugt mit `pnpm sim balance` (gleicher Seed und gleiche Parameter ergeben dieselbe Datei). Maßgeblich für die Balance ist die Siegquote je Karte im Deck (Abschnitt 2); zur Einordnung der übrigen Abschnitte siehe `docs/DECISIONS.md`, D-078.

## Parameter

| Parameter                                                                      | Wert                      |
| ------------------------------------------------------------------------------ | ------------------------- |
| ENGINE_VERSION                                                                 | 3                         |
| Start-Seed (`--seed`)                                                          | 20260101                  |
| Picks pro Karte im Kartenduell (`--picks`)                                     | 3 (Zusatzspalten 1 und 6) |
| Level im Kartenduell, Deckduell, Karte im Deck und Spiegel-Matches (`--level`) | 1 (max. 5)                |
| Seeds pro Kartenpaar (`--duels`, je beide Seitenverteilungen)                  | 1                         |
| Matches für die Siegquote je Karte im Deck (`--card-matches`)                  | 4000                      |
| Zufallsmatches (`--matches`)                                                   | 1000                      |
| Spiegel-Matches (`--mirror-matches`)                                           | 1000                      |
| Matches pro Deckpaar (`--deck-matches`)                                        | 40                        |
| Teil (`--only`)                                                                | all                       |

## 1. Karte gegen Karte

Jede Karte spielt gegen jede andere in einem einzelnen Rundenkampf, in dem beide Seiten dieselbe Zahl Picks ihrer einen Karte haben (ohne Sonderkarten, ohne Upgrades). Jede Seed-Paarung wird mit getauschten Seiten wiederholt. Für einen Draft-Auto-Battler ist das nur bedingt aussagekräftig: Flieger schlagen alle Karten ohne Luftangriff zwangsläufig, Heiler können allein nie gewinnen. Maßgeblich ist deshalb die Siegquote im Deck (Abschnitt 2).

### Siegquote in Prozent (Zeile schlägt Spalte, 3 Picks)

Ein Unentschieden zählt halb. Der Mittelwert ist der Schnitt über die 15 Gegner (Diagonale ausgenommen).

| Zeile \ Spalte | archer | knight | tnt | skeleton | healer | musketeer | bat | assassin | berserker | shroomling | pyromancer | necromancer | beetle | golem | frost_shaman | whelp | Mittel   |
| -------------- | ------ | ------ | --- | -------- | ------ | --------- | --- | -------- | --------- | ---------- | ---------- | ----------- | ------ | ----- | ------------ | ----- | -------- |
| archer         | -      | 0      | 0   | 0        | 100    | 100       | 100 | 0        | 0         | 0          | 100        | 100         | 100    | 0     | 100          | 100   | **53,3** |
| knight         | 100    | -      | 75  | 0        | 100    | 100       | 0   | 0        | 100       | 100        | 100        | 100         | 100    | 100   | 100          | 0     | **71,7** |
| tnt            | 100    | 25     | -   | 75       | 100    | 100       | 0   | 100      | 50        | 0          | 100        | 100         | 100    | 0     | 100          | 0     | **63,3** |
| skeleton       | 100    | 100    | 25  | -        | 100    | 100       | 0   | 100      | 50        | 100        | 100        | 100         | 100    | 100   | 100          | 0     | **78,3** |
| healer         | 0      | 0      | 0   | 0        | -      | 0         | 0   | 0        | 0         | 0          | 0          | 0           | 0      | 0     | 0            | 0     | **0,0**  |
| musketeer      | 0      | 0      | 0   | 0        | 100    | -         | 100 | 0        | 0         | 0          | 100        | 0           | 0      | 0     | 100          | 100   | **33,3** |
| bat            | 0      | 100    | 100 | 100      | 100    | 0         | -   | 100      | 100       | 100        | 0          | 100         | 100    | 100   | 0            | 0     | **66,7** |
| assassin       | 100    | 100    | 0   | 0        | 100    | 100       | 0   | -        | 100       | 0          | 100        | 100         | 100    | 100   | 100          | 0     | **66,7** |
| berserker      | 100    | 0      | 50  | 50       | 100    | 100       | 0   | 0        | -         | 100        | 100        | 100         | 100    | 100   | 100          | 0     | **66,7** |
| shroomling     | 100    | 0      | 100 | 0        | 100    | 100       | 0   | 100      | 0         | -          | 100        | 100         | 100    | 100   | 100          | 0     | **66,7** |
| pyromancer     | 0      | 0      | 0   | 0        | 100    | 0         | 100 | 0        | 0         | 0          | -          | 0           | 0      | 0     | 0            | 0     | **13,3** |
| necromancer    | 0      | 0      | 0   | 0        | 100    | 100       | 0   | 0        | 0         | 0          | 100        | -           | 100    | 0     | 100          | 0     | **33,3** |
| beetle         | 0      | 0      | 0   | 0        | 100    | 100       | 0   | 0        | 0         | 0          | 100        | 0           | -      | 0     | 100          | 0     | **26,7** |
| golem          | 100    | 0      | 100 | 0        | 100    | 100       | 0   | 0        | 0         | 0          | 100        | 100         | 100    | -     | 100          | 0     | **53,3** |
| frost_shaman   | 0      | 0      | 0   | 0        | 100    | 0         | 100 | 0        | 0         | 0          | 100        | 0           | 0      | 0     | -            | 100   | **26,7** |
| whelp          | 0      | 100    | 100 | 100      | 100    | 0         | 100 | 100      | 100       | 100        | 100        | 100         | 100    | 100   | 0            | -     | **80,0** |

### Rangliste

Ziel der SPEC: keine Karte über 60 % im Schnitt; unter 40 % gilt als zu schwach. Die Bewertung bezieht sich auf 3 Picks. Die letzten Spalten zeigen die mittlere Siegquote derselben Duelle mit 1 bzw. 6 Picks pro Seite (Skalierung mit der Armeegröße, ohne eigene Matrix).

| Rang | Karte        | Mittlere Siegquote, 3 Picks (%) | Bewertung      | 1 Pick (%) | 6 Picks (%) |
| ---- | ------------ | ------------------------------- | -------------- | ---------- | ----------- |
| 1    | whelp        | 80,0                            | **ZU STARK**   | 70,0       | 80,0        |
| 2    | skeleton     | 78,3                            | **ZU STARK**   | 86,7       | 86,7        |
| 3    | knight       | 71,7                            | **ZU STARK**   | 76,7       | 65,0        |
| 4    | bat          | 66,7                            | **ZU STARK**   | 73,3       | 66,7        |
| 5    | assassin     | 66,7                            | **ZU STARK**   | 60,0       | 66,7        |
| 6    | berserker    | 66,7                            | **ZU STARK**   | 70,0       | 66,7        |
| 7    | shroomling   | 66,7                            | **ZU STARK**   | 63,3       | 50,0        |
| 8    | tnt          | 63,3                            | **ZU STARK**   | 43,3       | 65,0        |
| 9    | archer       | 53,3                            | ok             | 41,7       | 40,0        |
| 10   | golem        | 53,3                            | ok             | 53,3       | 53,3        |
| 11   | musketeer    | 33,3                            | **ZU SCHWACH** | 56,7       | 33,3        |
| 12   | necromancer  | 33,3                            | **ZU SCHWACH** | 33,3       | 33,3        |
| 13   | beetle       | 26,7                            | **ZU SCHWACH** | 13,3       | 46,7        |
| 14   | frost_shaman | 26,7                            | **ZU SCHWACH** | 35,0       | 33,3        |
| 15   | pyromancer   | 13,3                            | **ZU SCHWACH** | 16,7       | 13,3        |
| 16   | healer       | 0,0                             | **ZU SCHWACH** | 6,7        | 0,0         |

## 2. Siegquote je Karte im Deck

4000 ganze Matches mit zufälligen Decks (je 4 verschiedene Karten aus allen 16), beide Seiten Level 1, alle Upgrades freigeschaltet, Zufallspicks mit Sonderkarten. Jede Karte bekommt das Ergebnis des Spielers, in dessen Deck sie steckt (Sieg 1, Unentschieden 0,5, Niederlage 0); steckt sie in beiden Decks, zählt sie für beide. Das Intervall ist die grobe Normalnäherung ±1,96·√(p(1−p)/n).

Ziel 45–55 %; unter 42 % bzw. über 58 % gilt eine Karte als auffällig.

| Rang | Karte        | Deck-Einsätze | Siegquote (%) | 95-%-Intervall (±) | Bewertung |
| ---- | ------------ | ------------- | ------------- | ------------------ | --------- |
| 1    | archer       | 2072          | 54,8          | 2,1                | ok        |
| 2    | pyromancer   | 2003          | 54,1          | 2,2                | ok        |
| 3    | whelp        | 2051          | 53,8          | 2,2                | ok        |
| 4    | beetle       | 2019          | 53,3          | 2,2                | ok        |
| 5    | knight       | 1996          | 53,0          | 2,2                | ok        |
| 6    | musketeer    | 1936          | 51,8          | 2,2                | ok        |
| 7    | golem        | 1969          | 51,1          | 2,2                | ok        |
| 8    | necromancer  | 1952          | 50,2          | 2,2                | ok        |
| 9    | healer       | 2038          | 49,3          | 2,2                | ok        |
| 10   | berserker    | 1987          | 48,8          | 2,2                | ok        |
| 11   | assassin     | 2044          | 48,0          | 2,2                | ok        |
| 12   | shroomling   | 1968          | 47,1          | 2,2                | ok        |
| 13   | bat          | 2023          | 46,6          | 2,2                | ok        |
| 14   | tnt          | 2019          | 46,6          | 2,2                | ok        |
| 15   | frost_shaman | 1967          | 45,8          | 2,2                | ok        |
| 16   | skeleton     | 1956          | 45,4          | 2,2                | ok        |

## 3. Match-Kennzahlen

Ganze Zufallsmatches (zufällige Decks, Level, freigeschaltete Upgrades und Picks, mit Sonderkarten). Ziel der SPEC 4.3: ein bis drei aktive Upgrades pro Spieler am Ende. Die Siegquote des Rundensiegers zeigt, wie stark ein früher Vorsprung trägt (D-057).

Weil in Zufallsmatches meist das stärkere Deck die erste Runde gewinnt, misst die Zeile „Spiegel-Matches“ denselben Wert in 1000 eigenen Matches, in denen beide Spieler dasselbe zufällige Deck spielen (Level 1, alle Upgrades freigeschaltet). Zum Vergleich der rechnerische Wert, wenn jede weitere Runde unabhängig 50:50 ausginge: Der Sieger von Runde 1 braucht noch 3 Rundensiege, bevor der Gegner 4 hat (42/64). Liegt der gemessene Wert darüber, wächst ein früher Vorsprung trotz Verlierer-Bonus weiter; liegt er darunter, gleicht der Verlierer-Bonus ihn teilweise aus.

| Kennzahl                                         | Wert                                          |
| ------------------------------------------------ | --------------------------------------------- |
| Matches                                          | 1000                                          |
| Siegquote des Siegers von Runde 1 (%)            | 60,4 (von 995 Matches mit Rundensieger)       |
| Dasselbe in Spiegel-Matches (%)                  | 54,1 ± 3,1 (von 987 Matches mit Rundensieger) |
| Rechnerisch bei unabhängigen 50:50-Runden (%)    | 65,6 (42/64)                                  |
| Verlierer von Runde 1 dreht das Match (%)        | 39,6                                          |
| Matches mit Unentschieden (%)                    | 0,0                                           |
| Runden pro Match, Mittel                         | 5,5                                           |
| Runden pro Match, Maximum                        | 7                                             |
| Kampfdauer, Mittel (s)                           | 37,8                                          |
| Kämpfe im Zeitlimit (90 s) (%)                   | 2,0                                           |
| Unentschiedene Kämpfe (%)                        | 0,2                                           |
| Sonderkarten an allen Picks (%)                  | 20,2 (Doppelpack 9,0, Upgrade 11,2)           |
| Aktive Upgrades pro Spieler am Matchende, Mittel | 2,12                                          |

### Feldgröße je Rundennummer

Größte Einheitenzahl einer Seite zu Kampfbeginn, Einheiten, die wegen voller Hälfte verfielen (nur beim Platzieren der Picks gezählt, ohne Wiederholung pro Runde), und die vorderste je belegte eigene Reihe (D-054, D-060). Dazu die größte Zahl gleichzeitig lebender Einheiten während eines Kampfes (nach jedem Tick gezählt, beide Seiten zusammen und die vollere Seite), der Mittelwert dieser Spitze über die Kämpfe und die im Kampf beschworenen Einheiten (Skelette, Zombies, Mini-Golems, Töchter, Wiederbelebte, Geister).

| Runde | Kämpfe | Max. Einheiten pro Seite | Verfallene Einheiten | Vorderste belegte Reihe (0-11) | Max. gleichzeitig lebend (beide) | Max. gleichzeitig lebend (pro Seite) | Spitze lebend, Mittel (beide) | Max. Beschwörungen | Beschwörungen, Mittel |
| ----- | ------ | ------------------------ | -------------------- | ------------------------------ | -------------------------------- | ------------------------------------ | ----------------------------- | ------------------ | --------------------- |
| 1     | 1000   | 21                       | 0                    | 2                              | 27                               | 21                                   | 12,8                          | 29                 | 1,8                   |
| 2     | 1000   | 39                       | 0                    | 4                              | 53                               | 39                                   | 27,7                          | 69                 | 5,3                   |
| 3     | 1000   | 53                       | 0                    | 6                              | 77                               | 53                                   | 42,7                          | 126                | 9,7                   |
| 4     | 1000   | 64                       | 0                    | 7                              | 102                              | 64                                   | 57,6                          | 182                | 15,4                  |
| 5     | 804    | 88                       | 0                    | 8                              | 129                              | 88                                   | 72,8                          | 191                | 21,7                  |
| 6     | 518    | 105                      | 0                    | 9                              | 155                              | 105                                  | 88,5                          | 252                | 29,3                  |
| 7     | 223    | 116                      | 0                    | 11                             | 180                              | 116                                  | 106,6                         | 183                | 39,2                  |

## 4. Deck gegen Deck

Acht feste, thematische Decks spielen ganze Matches mit Zufallspicks gegeneinander (alle Upgrades freigeschaltet, Seiten abwechselnd).

| Deck        | Karten                                       |
| ----------- | -------------------------------------------- |
| Startdeck   | archer, knight, skeleton, healer             |
| Schwarm     | skeleton, shroomling, bat, necromancer       |
| Bollwerk    | knight, golem, beetle, healer                |
| Fernkampf   | archer, musketeer, pyromancer, frost_shaman  |
| Luftwaffe   | bat, whelp, archer, healer                   |
| Sprengtrupp | tnt, berserker, assassin, skeleton           |
| Magier      | pyromancer, necromancer, frost_shaman, golem |
| Ausgewogen  | knight, musketeer, healer, whelp             |

### Siegquote in Prozent (Zeile schlägt Spalte)

Ein unentschiedenes Match zählt halb.

| Zeile \ Spalte | Startdeck | Schwarm | Bollwerk | Fernkampf | Luftwaffe | Sprengtrupp | Magier | Ausgewogen | Mittel   |
| -------------- | --------- | ------- | -------- | --------- | --------- | ----------- | ------ | ---------- | -------- |
| Startdeck      | -         | 80      | 23       | 35        | 40        | 73          | 18     | 30         | **42,5** |
| Schwarm        | 20        | -       | 95       | 35        | 15        | 95          | 15     | 5          | **40,0** |
| Bollwerk       | 78        | 5       | -        | 93        | 3         | 78          | 53     | 30         | **48,2** |
| Fernkampf      | 65        | 65      | 7        | -         | 95        | 5           | 45     | 73         | **50,7** |
| Luftwaffe      | 60        | 85      | 98       | 5         | -         | 100         | 0      | 13         | **51,4** |
| Sprengtrupp    | 28        | 5       | 22       | 95        | 0         | -           | 63     | 5          | **31,1** |
| Magier         | 83        | 85      | 48       | 55        | 100       | 38          | -      | 95         | **71,8** |
| Ausgewogen     | 70        | 95      | 70       | 28        | 88        | 95          | 5      | -          | **64,3** |
