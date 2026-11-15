/**
 * Balance tool (SPEC 12): card against card, whole-match statistics and deck against deck.
 * Writes docs/BALANCE.md (German) and prints a short summary. Everything is derived from the
 * start seed, so two runs with the same options give the same file (no time stamps in it).
 * Built only on the public engine exports (the single-card battles use the army and
 * placement functions the same way `applyPick` does, see `duelBattle`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ALL_UPGRADES_MASK,
  CARD_IDS,
  DECK_SIZE,
  ENGINE_VERSION,
  GRID_COLS,
  GRID_ROWS,
  MAX_LEVEL,
  TICKS_PER_SECOND,
  TIME_LIMIT_TICKS,
  applyPick,
  createMatch,
  endRound,
  nextInt,
  randomConfig,
  randomPicker,
  rebuildField,
  seedRng,
  simulateToEnd,
  startBattle,
  unitCount,
} from '@rumble-realms/engine';
import type {
  ArmyEntry,
  BattleResult,
  CardId,
  MatchConfig,
  MatchState,
  PlayerConfig,
  PlayerIndex,
} from '@rumble-realms/engine';

/** Stream number for random picks (the engine itself uses 1..4; robust uses 100). */
const PICK_STREAM = 100;
export const DEFAULT_BALANCE_SEED = 20260101;
/** Marks cards whose mean win rate leaves this corridor (SPEC 12: no card above 60 %). */
const HIGH_PERCENT = 60;
const LOW_PERCENT = 40;

/** Thematic decks for the deck against deck table: four different cards each. */
export const THEME_DECKS: readonly { name: string; deck: readonly CardId[] }[] = [
  { name: 'Startdeck', deck: ['archer', 'knight', 'skeleton', 'healer'] },
  { name: 'Schwarm', deck: ['skeleton', 'shroomling', 'bat', 'necromancer'] },
  { name: 'Bollwerk', deck: ['knight', 'golem', 'beetle', 'healer'] },
  { name: 'Fernkampf', deck: ['archer', 'musketeer', 'pyromancer', 'frost_shaman'] },
  { name: 'Luftwaffe', deck: ['bat', 'whelp', 'archer', 'healer'] },
  { name: 'Sprengtrupp', deck: ['tnt', 'berserker', 'assassin', 'skeleton'] },
  { name: 'Magier', deck: ['pyromancer', 'necromancer', 'frost_shaman', 'golem'] },
  { name: 'Ausgewogen', deck: ['knight', 'musketeer', 'healer', 'whelp'] },
];

export interface BalanceOptions {
  seed: number;
  picks: number;
  level: number;
  duels: number;
  matches: number;
  deckMatches: number;
  out: string;
  only: 'cards' | 'matches' | 'decks' | 'all';
}

// ---------------------------------------------------------------------------
// 1. Card against card
// ---------------------------------------------------------------------------

function levels(deck: readonly CardId[], level: number): PlayerConfig {
  const map: Partial<Record<CardId, number>> = {};
  for (const card of deck) map[card] = level;
  return { deck: [...deck], levels: map };
}

/** A deck of four different cards that contains `card`: the card plus the first three others. */
function deckWith(card: CardId): CardId[] {
  return [card, ...CARD_IDS.filter((c) => c !== card).slice(0, DECK_SIZE - 1)];
}

/**
 * One battle in which player 0 plays `picks` copies of `a` and player 1 `picks` copies of `b`,
 * all at `level`, without special cards and upgrades. Workaround: the public flow only
 * offers random deck cards, so the army entries are put into the match state directly (the
 * same fields `applyPick` fills: random column from the placement stream, fresh unit ids)
 * and the field is built with `rebuildField`.
 */
function duelBattle(
  seed: number,
  a: CardId,
  b: CardId,
  picks: number,
  level: number,
): BattleResult {
  const state = createMatch({
    seed,
    players: [levels(deckWith(a), level), levels(deckWith(b), level)],
  });
  const sides: [PlayerIndex, CardId][] = [
    [0, a],
    [1, b],
  ];
  for (let i = 0; i < picks; i++) {
    for (const [player, card] of sides) {
      const ids: number[] = [];
      const n = unitCount(card, 0, false);
      for (let k = 0; k < n; k++) ids.push(state.nextUnitId++);
      const entry: ArmyEntry = {
        player,
        card,
        level,
        column: nextInt(state.rng.placement, GRID_COLS),
        round: 1,
        double: false,
        unitIds: ids,
      };
      state.army.push(entry);
    }
  }
  rebuildField(state);
  state.phase = 'battle';
  return simulateToEnd(startBattle(state));
}

interface CardResults {
  /** score[i][j]: points of card i against card j (win 1, draw 0.5), in [0, 1]. */
  score: number[][];
  mean: number[];
}

function runCards(o: BalanceOptions): CardResults {
  const n = CARD_IDS.length;
  const score: number[][] = CARD_IDS.map(() => CARD_IDS.map(() => 0.5));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let points = 0;
      let battles = 0;
      for (let d = 0; d < o.duels; d++) {
        const seed = o.seed * 1_000 + (i * n + j) * 100 + d;
        const a = CARD_IDS[i] as CardId;
        const b = CARD_IDS[j] as CardId;
        const r1 = duelBattle(seed, a, b, o.picks, o.level);
        points += r1.winner === 0 ? 1 : r1.winner === 'draw' ? 0.5 : 0;
        // Swapped sides, same seed.
        const r2 = duelBattle(seed, b, a, o.picks, o.level);
        points += r2.winner === 1 ? 1 : r2.winner === 'draw' ? 0.5 : 0;
        battles += 2;
      }
      (score[i] as number[])[j] = points / battles;
      (score[j] as number[])[i] = 1 - points / battles;
    }
  }
  const mean = score.map((row, i) => {
    let sum = 0;
    row.forEach((v, j) => {
      if (j !== i) sum += v;
    });
    return sum / (n - 1);
  });
  return { score, mean };
}

// ---------------------------------------------------------------------------
// 2. Whole random matches
// ---------------------------------------------------------------------------

interface RoundField {
  battles: number;
  maxUnits: number;
  forfeited: number;
  /** Highest own row (0 = base line, 11 = next to the middle) occupied by any unit. */
  maxFrontRow: number;
}

interface MatchResults {
  matches: number;
  rounds: number;
  maxRounds: number;
  ticks: number;
  timeouts: number;
  drawRounds: number;
  r1Decisive: number;
  r1WinnerWins: number;
  comebacks: number;
  matchDraws: number;
  picks: number;
  doublePicks: number;
  upgradePicks: number;
  activeAtEnd: number;
  perRound: RoundField[];
}

function otherSide(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

/** Plays a match with random picks and collects the statistics. `onMatch` may be omitted. */
function playStats(cfg: MatchConfig, r: MatchResults): MatchState {
  const state = createMatch(cfg);
  const picker = randomPicker(seedRng(cfg.seed, PICK_STREAM));
  let roundOneWinner: PlayerIndex | 'draw' | null = null;
  while (state.phase !== 'finished') {
    if (state.phase === 'draft') {
      applyPick(state, picker(state));
      const pick = state.lastPick;
      if (pick !== null) {
        r.picks++;
        if (pick.kind === 'double') r.doublePicks++;
        if (pick.kind === 'upgrade') r.upgradePicks++;
        r.perRound[state.round - 1] ??= { battles: 0, maxUnits: 0, forfeited: 0, maxFrontRow: 0 };
        (r.perRound[state.round - 1] as RoundField).forfeited += pick.forfeited;
      }
      continue;
    }
    const field = r.perRound[state.round - 1] as RoundField;
    field.battles++;
    const units: [number, number] = [0, 0];
    for (const u of state.battle.units) {
      units[u.owner]++;
      const row = u.owner === 0 ? u.y : GRID_ROWS - 1 - u.y;
      if (row > field.maxFrontRow) field.maxFrontRow = row;
    }
    field.maxUnits = Math.max(field.maxUnits, units[0], units[1]);
    const result = simulateToEnd(startBattle(state));
    r.rounds++;
    r.ticks += result.ticks;
    if (result.reason === 'timeout') r.timeouts++;
    if (result.winner === 'draw') r.drawRounds++;
    if (state.round === 1) roundOneWinner = result.winner;
    endRound(state);
  }
  r.matches++;
  r.maxRounds = Math.max(r.maxRounds, state.rounds.length);
  if (state.winner === 'draw') r.matchDraws++;
  if (roundOneWinner !== null && roundOneWinner !== 'draw') {
    r.r1Decisive++;
    if (state.winner === roundOneWinner) r.r1WinnerWins++;
    else if (state.winner === otherSide(roundOneWinner)) r.comebacks++;
  }
  for (const side of [0, 1] as const) {
    for (const card of CARD_IDS) {
      const mask = state.activeUpgrades[side][card] ?? 0;
      for (let i = 0; i < 3; i++) if ((mask & (1 << i)) !== 0) r.activeAtEnd++;
    }
  }
  return state;
}

function newMatchResults(): MatchResults {
  return {
    matches: 0,
    rounds: 0,
    maxRounds: 0,
    ticks: 0,
    timeouts: 0,
    drawRounds: 0,
    r1Decisive: 0,
    r1WinnerWins: 0,
    comebacks: 0,
    matchDraws: 0,
    picks: 0,
    doublePicks: 0,
    upgradePicks: 0,
    activeAtEnd: 0,
    perRound: [],
  };
}

function runMatches(o: BalanceOptions): MatchResults {
  const r = newMatchResults();
  const rng = seedRng(o.seed, 7);
  for (let i = 0; i < o.matches; i++) playStats(randomConfig(rng), r);
  return r;
}

// ---------------------------------------------------------------------------
// 3. Deck against deck
// ---------------------------------------------------------------------------

function runDecks(o: BalanceOptions): number[][] {
  const n = THEME_DECKS.length;
  const score: number[][] = THEME_DECKS.map(() => THEME_DECKS.map(() => 0.5));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let points = 0;
      for (let m = 0; m < o.deckMatches; m++) {
        const seed = o.seed * 1_000 + 500_000 + (i * n + j) * 1_000 + m;
        const swap = m % 2 === 1;
        const di = THEME_DECKS[i]?.deck as readonly CardId[];
        const dj = THEME_DECKS[j]?.deck as readonly CardId[];
        const full = (deck: readonly CardId[]): PlayerConfig => {
          const p = levels(deck, o.level);
          const upgrades: Partial<Record<CardId, number>> = {};
          for (const card of deck) upgrades[card] = ALL_UPGRADES_MASK;
          return { ...p, upgrades };
        };
        const cfg: MatchConfig = {
          seed,
          players: swap ? [full(dj), full(di)] : [full(di), full(dj)],
        };
        const state = playStats(cfg, newMatchResults());
        const iSide = swap ? 1 : 0;
        points += state.winner === iSide ? 1 : state.winner === 'draw' ? 0.5 : 0;
      }
      (score[i] as number[])[j] = points / o.deckMatches;
      (score[j] as number[])[i] = 1 - points / o.deckMatches;
    }
  }
  return score;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const pc = (x: number, digits = 1): string => `${(100 * x).toFixed(digits)}`.replace('.', ',');
const num = (x: number, digits = 1): string => x.toFixed(digits).replace('.', ',');

/** Markdown table with padded columns, so that `prettier --check` accepts the file. */
function table(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, c) => Math.max(3, ...all.map((r) => (r[c] ?? '').length)));
  const line = (cells: string[]): string =>
    `| ${cells.map((cell, c) => cell.padEnd(widths[c] as number)).join(' | ')} |`;
  const rule = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(header), rule, ...rows.map(line)].join('\n');
}

function cardsSection(res: CardResults): { md: string; summary: string[] } {
  const ids = [...CARD_IDS];
  const matrix = table(
    ['Zeile \\ Spalte', ...ids, 'Mittel'],
    ids.map((id, i) => [
      id,
      ...ids.map((_, j) => (i === j ? '-' : pc(res.score[i]?.[j] as number, 0))),
      `**${pc(res.mean[i] as number)}**`,
    ]),
  );
  const order = ids
    .map((_, i) => i)
    .sort((a, b) => (res.mean[b] as number) - (res.mean[a] as number));
  const flag = (m: number): string =>
    m * 100 > HIGH_PERCENT ? '**ZU STARK**' : m * 100 < LOW_PERCENT ? '**ZU SCHWACH**' : 'ok';
  const ranking = table(
    ['Rang', 'Karte', 'Mittlere Siegquote (%)', 'Bewertung'],
    order.map((i, k) => [
      String(k + 1),
      ids[i] as string,
      pc(res.mean[i] as number),
      flag(res.mean[i] as number),
    ]),
  );
  const md = [
    '## 1. Karte gegen Karte',
    '',
    `Jede Karte spielt gegen jede andere in einem einzelnen Rundenkampf, in dem beide Seiten dieselbe Zahl Picks ihrer einen Karte haben (ohne Sonderkarten, ohne Upgrades). Jede Seed-Paarung wird mit getauschten Seiten wiederholt.`,
    '',
    '### Siegquote in Prozent (Zeile schlägt Spalte)',
    '',
    'Ein Unentschieden zählt halb. Der Mittelwert ist der Schnitt über die 15 Gegner (Diagonale ausgenommen).',
    '',
    matrix,
    '',
    '### Rangliste',
    '',
    `Ziel der SPEC: keine Karte über ${HIGH_PERCENT} % im Schnitt; unter ${LOW_PERCENT} % gilt als zu schwach.`,
    '',
    ranking,
    '',
  ].join('\n');
  const bad = order
    .filter(
      (i) =>
        (res.mean[i] as number) * 100 > HIGH_PERCENT || (res.mean[i] as number) * 100 < LOW_PERCENT,
    )
    .map((i) => `${ids[i]} ${pc(res.mean[i] as number)} %`);
  const top = order[0] as number;
  const bottom = order[order.length - 1] as number;
  return {
    md,
    summary: [
      `Cards: best ${ids[top]} ${pc(res.mean[top] as number)} %, worst ${ids[bottom]} ${pc(res.mean[bottom] as number)} %`,
      `Cards outside ${LOW_PERCENT}..${HIGH_PERCENT} %: ${bad.length === 0 ? 'none' : bad.join(', ')}`,
    ],
  };
}

function matchesSection(r: MatchResults): { md: string; summary: string[] } {
  const kpi = table(
    ['Kennzahl', 'Wert'],
    [
      ['Matches', String(r.matches)],
      [
        'Siegquote des Siegers von Runde 1 (%)',
        `${pc(r.r1WinnerWins / Math.max(1, r.r1Decisive))} (von ${r.r1Decisive} Matches mit Rundensieger)`,
      ],
      ['Verlierer von Runde 1 dreht das Match (%)', pc(r.comebacks / Math.max(1, r.r1Decisive))],
      ['Matches mit Unentschieden (%)', pc(r.matchDraws / r.matches)],
      ['Runden pro Match, Mittel', num(r.rounds / r.matches)],
      ['Runden pro Match, Maximum', String(r.maxRounds)],
      ['Kampfdauer, Mittel (s)', num(r.ticks / r.rounds / TICKS_PER_SECOND)],
      [
        `Kämpfe im Zeitlimit (${TIME_LIMIT_TICKS / TICKS_PER_SECOND} s) (%)`,
        pc(r.timeouts / r.rounds),
      ],
      ['Unentschiedene Kämpfe (%)', pc(r.drawRounds / r.rounds)],
      [
        'Sonderkarten an allen Picks (%)',
        `${pc((r.doublePicks + r.upgradePicks) / r.picks)} (Doppelpack ${pc(r.doublePicks / r.picks)}, Upgrade ${pc(r.upgradePicks / r.picks)})`,
      ],
      ['Aktive Upgrades pro Spieler am Matchende, Mittel', num(r.activeAtEnd / (2 * r.matches), 2)],
    ],
  );
  const field = table(
    [
      'Runde',
      'Kämpfe',
      'Max. Einheiten pro Seite',
      'Verfallene Einheiten',
      'Vorderste belegte Reihe (0-11)',
    ],
    r.perRound.map((f, i) => [
      String(i + 1),
      String(f?.battles ?? 0),
      String(f?.maxUnits ?? 0),
      String(f?.forfeited ?? 0),
      String(f?.maxFrontRow ?? 0),
    ]),
  );
  const md = [
    '## 2. Match-Kennzahlen',
    '',
    'Ganze Zufallsmatches (zufällige Decks, Level, freigeschaltete Upgrades und Picks, mit Sonderkarten). Ziel der SPEC 4.3: ein bis drei aktive Upgrades pro Spieler am Ende. Die Siegquote des Rundensiegers zeigt, wie stark ein früher Vorsprung trägt (D-057).',
    '',
    kpi,
    '',
    '### Feldgröße je Rundennummer',
    '',
    'Größte Einheitenzahl einer Seite zu Kampfbeginn, Einheiten, die wegen voller Hälfte verfielen (nur beim Platzieren der Picks gezählt, ohne Wiederholung pro Runde), und die vorderste je belegte eigene Reihe (D-054, D-060).',
    '',
    field,
    '',
  ].join('\n');
  const first = r.perRound.reduce((m, f) => Math.max(m, f?.forfeited ?? 0), 0);
  return {
    md,
    summary: [
      `Matches: ${r.matches}, rounds/match mean ${num(r.rounds / r.matches)} (max ${r.maxRounds}), battle ${num(r.ticks / r.rounds / TICKS_PER_SECOND)} s, time limit ${pc(r.timeouts / r.rounds)} %, draw rounds ${pc(r.drawRounds / r.rounds)} %`,
      `Round 1 winner wins match: ${pc(r.r1WinnerWins / Math.max(1, r.r1Decisive))} %, comebacks ${pc(r.comebacks / Math.max(1, r.r1Decisive))} %`,
      `Special picks ${pc((r.doublePicks + r.upgradePicks) / r.picks)} %, active upgrades per player ${num(r.activeAtEnd / (2 * r.matches), 2)}, max forfeited units in a round ${first}`,
    ],
  };
}

function decksSection(score: number[][]): { md: string; summary: string[] } {
  const names = THEME_DECKS.map((d) => d.name);
  const list = table(
    ['Deck', 'Karten'],
    THEME_DECKS.map((d) => [d.name, d.deck.join(', ')]),
  );
  const mean = score.map((row, i) => {
    let sum = 0;
    row.forEach((v, j) => {
      if (j !== i) sum += v;
    });
    return sum / (names.length - 1);
  });
  const matrix = table(
    ['Zeile \\ Spalte', ...names, 'Mittel'],
    names.map((name, i) => [
      name,
      ...names.map((_, j) => (i === j ? '-' : pc(score[i]?.[j] as number, 0))),
      `**${pc(mean[i] as number)}**`,
    ]),
  );
  const md = [
    '## 3. Deck gegen Deck',
    '',
    'Acht feste, thematische Decks spielen ganze Matches mit Zufallspicks gegeneinander (alle Upgrades freigeschaltet, Seiten abwechselnd).',
    '',
    list,
    '',
    '### Siegquote in Prozent (Zeile schlägt Spalte)',
    '',
    'Ein unentschiedenes Match zählt halb.',
    '',
    matrix,
    '',
  ].join('\n');
  const best = mean.indexOf(Math.max(...mean));
  const worst = mean.indexOf(Math.min(...mean));
  return {
    md,
    summary: [
      `Decks: best ${names[best]} ${pc(mean[best] as number)} %, worst ${names[worst]} ${pc(mean[worst] as number)} %`,
    ],
  };
}

export function runBalance(o: BalanceOptions): number {
  const started = performance.now();
  const want = (part: 'cards' | 'matches' | 'decks'): boolean =>
    o.only === 'all' || o.only === part;
  const sections: string[] = [];
  const summary: string[] = [];
  const timing: string[] = [];
  const step = <T>(name: string, fn: () => T): T => {
    const t = performance.now();
    const value = fn();
    timing.push(`${name} ${((performance.now() - t) / 1000).toFixed(1)} s`);
    return value;
  };
  if (want('cards')) {
    const s = cardsSection(step('cards', () => runCards(o)));
    sections.push(s.md);
    summary.push(...s.summary);
  }
  if (want('matches')) {
    const s = matchesSection(step('matches', () => runMatches(o)));
    sections.push(s.md);
    summary.push(...s.summary);
  }
  if (want('decks')) {
    const s = decksSection(step('decks', () => runDecks(o)));
    sections.push(s.md);
    summary.push(...s.summary);
  }
  const header = [
    '# Balance-Bericht',
    '',
    '> **VORLÄUFIG, kleine Stichprobe, Engine noch in Arbeit.** Die Zahlen sind nur ein Funktionstest des Tools und keine Balance-Aussage. Erzeugt mit `pnpm sim balance`.',
    '',
    '## Parameter',
    '',
    table(
      ['Parameter', 'Wert'],
      [
        ['ENGINE_VERSION', String(ENGINE_VERSION)],
        ['Start-Seed (`--seed`)', String(o.seed)],
        ['Picks pro Karte im Kartenduell (`--picks`)', String(o.picks)],
        ['Level im Kartenduell und Deckduell (`--level`)', `${o.level} (max. ${MAX_LEVEL})`],
        ['Seeds pro Kartenpaar (`--duels`, je beide Seitenverteilungen)', String(o.duels)],
        ['Zufallsmatches (`--matches`)', String(o.matches)],
        ['Matches pro Deckpaar (`--deck-matches`)', String(o.deckMatches)],
        ['Teil (`--only`)', o.only],
      ],
    ),
    '',
  ].join('\n');
  const text = `${header}\n${sections.join('\n')}`.replace(/\n+$/, '\n');
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, text);
  console.log(`Engine version: ${ENGINE_VERSION}, seed ${o.seed}`);
  for (const line of summary) console.log(line);
  console.log(`Written: ${o.out}`);
  console.log(
    `Run time: ${timing.join(', ')}, total ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
  return 0;
}
