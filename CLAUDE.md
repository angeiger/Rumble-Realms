# Rumble Realms: Arbeitsweise der Agenten

Verbindliche Spezifikation: `docs/SPEC.md`. Allgemeine Regeln der VM: `~/.claude/CLAUDE.md`.
Das Repo ist **öffentlich**. Niemals Secrets committen.

## Rollen

Die **Hauptsitzung ist der Koordinator**, egal mit welchem Modell sie läuft
(bis 16.11.2026 Fable, danach Opus). Sie
- plant jeden Meilenstein, zerlegt ihn in Arbeitspakete und verteilt sie,
- erledigt **selbst nur die allerschwierigsten Aufgaben**: Architektur- und Schnittstellenentscheidungen,
  den Kern der deterministischen Engine (Abschnitt 6), knifflige Fehleranalysen, das Review vor jedem Gate,
- prüft alle Ergebnisse (Lint, Typecheck, Tests), committet, pusht den Branch und öffnet den Pull Request,
- hält Annahmen in `docs/DECISIONS.md` fest und schreibt Andreas den Gate-Bericht.

Subagenten (`.claude/agents/`):

| Agent | Modell | Wofür |
|---|---|---|
| `koordinator-opus` | Opus, high | leichtere Koordination: ein abgegrenztes Arbeitspaket selbst weiter zerlegen und verteilen |
| `entwickler-opus` | Opus, high | anspruchsvolle Umsetzung (Engine-Details, Netzwerk, Sicherheit, schwierige Bugs) |
| `entwickler-sonnet` | Sonnet, medium | normale Umsetzung (UI, Stores, Rendering, Tests, Konfiguration) |
| `helfer-haiku` | Haiku, low | Routine (Suchen, Daten übertragen, Formatierung, einfache Doku) |

Regeln:
- Delegiere alles, was nicht zu den allerschwierigsten Aufgaben gehört. Nimm das günstigste Modell, das die Aufgabe sicher schafft.
- Nur `koordinator-opus` darf selbst Subagenten starten (maximal 2 Ebenen unter der Hauptsitzung).
- Höchstens **5 Subagenten gleichzeitig**, und nur, wenn es sinnvoll ist (unabhängige Aufgaben, getrennte Dateien bzw. Worktrees).
  Schwere Läufe (Playwright/Browser, Build, ganze Testsuite) nur so viele gleichzeitig, wie der Arbeitsspeicher hergibt:
  Die VM bekommt dynamisch bis zu 6 GB, oft ist weniger frei. Richtwert 2 schwere Läufe; vor dem Start weiterer Agenten
  `free -m` prüfen. Der Koordinator entscheidet nach Lage.
- Gib Subagenten präzise Aufträge: Ziel, betroffene Dateien bzw. SPEC-Abschnitte, Abnahmekriterium.

## Nutzungslimit

Es wird **nur das Kontingent von Andreas' Claude-Abo** genutzt, nie Nutzungsguthaben oder API-Schlüssel.
Ist das Limit erreicht: Arbeitsstand sichern (committen auf dem Branch, `docs/DECISIONS.md` aktualisieren),
Andreas kurz informieren und warten. Niemals versuchen, auf andere Abrechnungswege auszuweichen.
