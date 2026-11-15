# Balance-Bericht

> **VORLÄUFIG, kleine Stichprobe, Engine noch in Arbeit.** Die Zahlen sind nur ein Funktionstest des Tools und keine Balance-Aussage. Erzeugt mit `pnpm sim balance`.

## Parameter

| Parameter                                                     | Wert       |
| ------------------------------------------------------------- | ---------- |
| ENGINE_VERSION                                                | 3          |
| Start-Seed (`--seed`)                                         | 20260101   |
| Picks pro Karte im Kartenduell (`--picks`)                    | 3          |
| Level im Kartenduell und Deckduell (`--level`)                | 1 (max. 5) |
| Seeds pro Kartenpaar (`--duels`, je beide Seitenverteilungen) | 4          |
| Zufallsmatches (`--matches`)                                  | 60         |
| Matches pro Deckpaar (`--deck-matches`)                       | 4          |
| Teil (`--only`)                                               | all        |

## 1. Karte gegen Karte

Jede Karte spielt gegen jede andere in einem einzelnen Rundenkampf, in dem beide Seiten dieselbe Zahl Picks ihrer einen Karte haben (ohne Sonderkarten, ohne Upgrades). Jede Seed-Paarung wird mit getauschten Seiten wiederholt.

### Siegquote in Prozent (Zeile schlägt Spalte)

Ein Unentschieden zählt halb. Der Mittelwert ist der Schnitt über die 15 Gegner (Diagonale ausgenommen).

| Zeile \ Spalte | archer | knight | tnt | skeleton | healer | musketeer | bat | assassin | berserker | shroomling | pyromancer | necromancer | beetle | golem | frost_shaman | whelp | Mittel   |
| -------------- | ------ | ------ | --- | -------- | ------ | --------- | --- | -------- | --------- | ---------- | ---------- | ----------- | ------ | ----- | ------------ | ----- | -------- |
| archer         | -      | 0      | 100 | 100      | 100    | 13        | 100 | 0        | 0         | 100        | 75         | 100         | 0      | 38    | 100          | 100   | **61,7** |
| knight         | 100    | -      | 100 | 100      | 100    | 100       | 0   | 63       | 63        | 100        | 100        | 100         | 0      | 100   | 100          | 0     | **75,0** |
| tnt            | 0      | 0      | -   | 6        | 81     | 13        | 0   | 88       | 6         | 0          | 50         | 0           | 19     | 0     | 63           | 0     | **21,7** |
| skeleton       | 0      | 0      | 94  | -        | 100    | 25        | 0   | 0        | 0         | 25         | 0          | 38          | 25     | 0     | 100          | 0     | **27,1** |
| healer         | 0      | 0      | 19  | 0        | -      | 0         | 0   | 0        | 0         | 0          | 0          | 0           | 0      | 0     | 0            | 0     | **1,3**  |
| musketeer      | 88     | 0      | 88  | 75       | 100    | -         | 100 | 0        | 0         | 100        | 100        | 38          | 0      | 63    | 100          | 100   | **63,3** |
| bat            | 0      | 100    | 100 | 100      | 100    | 0         | -   | 100      | 100       | 100        | 0          | 50          | 100    | 100   | 0            | 0     | **63,3** |
| assassin       | 100    | 38     | 13  | 100      | 100    | 100       | 0   | -        | 13        | 100        | 100        | 100         | 88     | 63    | 100          | 0     | **67,5** |
| berserker      | 100    | 38     | 94  | 100      | 100    | 100       | 0   | 88       | -         | 100        | 100        | 100         | 25     | 88    | 100          | 0     | **75,4** |
| shroomling     | 0      | 0      | 100 | 75       | 100    | 0         | 0   | 0        | 0         | -          | 0          | 0           | 0      | 0     | 88           | 0     | **24,2** |
| pyromancer     | 25     | 0      | 50  | 100      | 100    | 0         | 100 | 0        | 0         | 100        | -          | 63          | 0      | 0     | 100          | 25    | **44,2** |
| necromancer    | 0      | 0      | 100 | 63       | 100    | 63        | 50  | 0        | 0         | 100        | 38         | -           | 0      | 25    | 100          | 0     | **42,5** |
| beetle         | 100    | 100    | 81  | 75       | 100    | 100       | 0   | 13       | 75        | 100        | 100        | 100         | -      | 100   | 100          | 0     | **76,3** |
| golem          | 63     | 0      | 100 | 100      | 100    | 38        | 0   | 38       | 13        | 100        | 100        | 75          | 0      | -     | 100          | 0     | **55,0** |
| frost_shaman   | 0      | 0      | 38  | 0        | 100    | 0         | 100 | 0        | 0         | 13         | 0          | 0           | 0      | 0     | -            | 0     | **16,7** |
| whelp          | 0      | 100    | 100 | 100      | 100    | 0         | 100 | 100      | 100       | 100        | 75         | 100         | 100    | 100   | 100          | -     | **85,0** |

### Rangliste

Ziel der SPEC: keine Karte über 60 % im Schnitt; unter 40 % gilt als zu schwach.

| Rang | Karte        | Mittlere Siegquote (%) | Bewertung      |
| ---- | ------------ | ---------------------- | -------------- |
| 1    | whelp        | 85,0                   | **ZU STARK**   |
| 2    | beetle       | 76,3                   | **ZU STARK**   |
| 3    | berserker    | 75,4                   | **ZU STARK**   |
| 4    | knight       | 75,0                   | **ZU STARK**   |
| 5    | assassin     | 67,5                   | **ZU STARK**   |
| 6    | musketeer    | 63,3                   | **ZU STARK**   |
| 7    | bat          | 63,3                   | **ZU STARK**   |
| 8    | archer       | 61,7                   | **ZU STARK**   |
| 9    | golem        | 55,0                   | ok             |
| 10   | pyromancer   | 44,2                   | ok             |
| 11   | necromancer  | 42,5                   | ok             |
| 12   | skeleton     | 27,1                   | **ZU SCHWACH** |
| 13   | shroomling   | 24,2                   | **ZU SCHWACH** |
| 14   | tnt          | 21,7                   | **ZU SCHWACH** |
| 15   | frost_shaman | 16,7                   | **ZU SCHWACH** |
| 16   | healer       | 1,3                    | **ZU SCHWACH** |

## 2. Match-Kennzahlen

Ganze Zufallsmatches (zufällige Decks, Level, freigeschaltete Upgrades und Picks, mit Sonderkarten). Ziel der SPEC 4.3: ein bis drei aktive Upgrades pro Spieler am Ende. Die Siegquote des Rundensiegers zeigt, wie stark ein früher Vorsprung trägt (D-057).

| Kennzahl                                         | Wert                                   |
| ------------------------------------------------ | -------------------------------------- |
| Matches                                          | 60                                     |
| Siegquote des Siegers von Runde 1 (%)            | 68,3 (von 60 Matches mit Rundensieger) |
| Verlierer von Runde 1 dreht das Match (%)        | 31,7                                   |
| Matches mit Unentschieden (%)                    | 0,0                                    |
| Runden pro Match, Mittel                         | 5,3                                    |
| Runden pro Match, Maximum                        | 7                                      |
| Kampfdauer, Mittel (s)                           | 34,5                                   |
| Kämpfe im Zeitlimit (90 s) (%)                   | 1,9                                    |
| Unentschiedene Kämpfe (%)                        | 0,0                                    |
| Sonderkarten an allen Picks (%)                  | 19,3 (Doppelpack 9,1, Upgrade 10,2)    |
| Aktive Upgrades pro Spieler am Matchende, Mittel | 1,82                                   |

### Feldgröße je Rundennummer

Größte Einheitenzahl einer Seite zu Kampfbeginn, Einheiten, die wegen voller Hälfte verfielen (nur beim Platzieren der Picks gezählt, ohne Wiederholung pro Runde), und die vorderste je belegte eigene Reihe (D-054, D-060).

| Runde | Kämpfe | Max. Einheiten pro Seite | Verfallene Einheiten | Vorderste belegte Reihe (0-11) |
| ----- | ------ | ------------------------ | -------------------- | ------------------------------ |
| 1     | 60     | 15                       | 0                    | 3                              |
| 2     | 60     | 29                       | 0                    | 4                              |
| 3     | 60     | 41                       | 0                    | 5                              |
| 4     | 60     | 53                       | 0                    | 6                              |
| 5     | 39     | 63                       | 0                    | 6                              |
| 6     | 24     | 70                       | 0                    | 8                              |
| 7     | 13     | 79                       | 0                    | 8                              |

## 3. Deck gegen Deck

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
| Startdeck      | -         | 100     | 0        | 25        | 25        | 100         | 25     | 0          | **39,3** |
| Schwarm        | 0         | -       | 25       | 0         | 0         | 100         | 0      | 0          | **17,9** |
| Bollwerk       | 100       | 75      | -        | 100       | 0         | 100         | 100    | 0          | **67,9** |
| Fernkampf      | 75        | 100     | 0        | -         | 100       | 50          | 75     | 50         | **64,3** |
| Luftwaffe      | 75        | 100     | 100      | 0         | -         | 100         | 25     | 0          | **57,1** |
| Sprengtrupp    | 0         | 0       | 0        | 50        | 0         | -           | 25     | 0          | **10,7** |
| Magier         | 75        | 100     | 0        | 25        | 75        | 75          | -      | 75         | **60,7** |
| Ausgewogen     | 100       | 100     | 100      | 50        | 100       | 100         | 25     | -          | **82,1** |
