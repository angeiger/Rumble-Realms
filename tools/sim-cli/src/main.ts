/**
 * Command line simulation for the Rumble Realms engine (M1, growing armies since M3a,
 * special cards and upgrades since M3b).
 * No dependencies: arguments are parsed by hand. Node APIs and timing are allowed here.
 */
import { fileURLToPath } from 'node:url';
import {
  ALL_UPGRADES_MASK,
  CARD_IDS,
  DECK_SIZE,
  ENGINE_VERSION,
  MAX_LEVEL,
  TICKS_PER_SECOND,
  TIME_LIMIT_TICKS,
  UPGRADES,
  applyPick,
  createGoldenReplay,
  createMatch,
  endRound,
  hashState,
  randomConfig,
  randomPicker,
  seedRng,
  simulateToEnd,
  startBattle,
  stepTick,
} from '@rumble-realms/engine';
import { BALANCE_PARTS, DEFAULT_BALANCE_SEED, runBalance } from './balance.ts';
import type { BalancePart } from './balance.ts';
import { DEFAULT_TUNE_SEED, runTune } from './tune.ts';
import type {
  BattleEvent,
  CardId,
  MatchConfig,
  MatchState,
  OfferSlot,
  PlayerConfig,
  UpgradeIndex,
  Winner,
} from '@rumble-realms/engine';

const START_DECK: CardId[] = ['archer', 'knight', 'skeleton', 'healer'];
/** Stream number for the random picks of a match (the engine itself uses 1..4). */
const PICK_STREAM = 100;
const DEFAULT_SEED = 1;
const DEFAULT_ROBUST_MATCHES = 10000;
const NAMES = ['A', 'B'] as const;

class UsageError extends Error {}

const HELP = `Rumble Realms simulation (engine version ${ENGINE_VERSION})

Usage: pnpm sim [command] [options]

Commands:
  match   Play one match with random picks (default command)
            --seed N        match seed, non-negative integer (default ${DEFAULT_SEED})
            --deck-a a,b,c,d  deck of player A (${DECK_SIZE} different cards)
            --deck-b a,b,c,d  deck of player B
            --level-a N     level 1..${MAX_LEVEL} of all cards of A (default 1)
            --level-b N     level 1..${MAX_LEVEL} of all cards of B (default 1)
            --upgrades-a M  unlocked upgrades of all cards of A, bit mask 0..${ALL_UPGRADES_MASK} (default 0)
            --upgrades-b M  unlocked upgrades of all cards of B, bit mask 0..${ALL_UPGRADES_MASK} (default 0)
            --verbose       also show event counts per round
  robust  Play many random matches and check them; prints statistics per round
            --matches N     number of matches (default ${DEFAULT_ROBUST_MATCHES})
            --seed N        start seed of the random configs (default ${DEFAULT_SEED})
  balance Card against card, card in a deck, match statistics and deck against deck;
          writes a Markdown report
            --seed N        start seed (default fixed; same seed = same file)
            --picks N       picks of the one card per side in card duels (default 3)
            --level N       level 1..${MAX_LEVEL} in card and deck duels (default 1)
            --duels N       seeds per card pair, both side assignments each (default 1; duels are deterministic since D-070)
            --matches N     random matches for the match statistics (default 300)
            --card-matches N  random matches for the win rate of a card in a deck (default 1000)
            --mirror-matches N  mirror matches for the round 1 lead (default 400)
            --deck-matches N  matches per deck pair (default 20)
            --only P        ${BALANCE_PARTS.join(', ')} (default: all)
            --out PATH      target file (default docs/BALANCE.md)
  tune    Propose HP and damage factors per card for a win rate in a deck near 50 %
          (changes the card values in memory only, never the engine files)
            --seed N        start seed (default fixed)
            --iterations N  tracking steps (default 8)
            --matches N     random matches per iteration (default 1500)
            --level N       level 1..${MAX_LEVEL} of both sides (default 1)
            --min X         smallest factor (default 0.6)
            --max X         largest factor (default 1.6)
            --gain X        relative change per percentage point off 50 %, /100 (default 3)
            --max-step X    largest relative change per iteration (default 0.25)
            --duels N       seeds per pair for the final card duel ranking, 0 = off (default 1)
            --picks N       picks per side in that ranking (default 3)
            --out PATH      also write the result as Markdown
  golden  Print the JSON for packages/engine/src/golden/replay.json (use: pnpm --silent sim golden > file)

Default decks: ${START_DECK.join(', ')}
Cards: ${CARD_IDS.join(', ')}
Exit codes: 0 ok, 1 robust check failed, 2 invalid input`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

type Options = Map<string, string | true>;

function parseOptions(args: string[], valueFlags: string[], boolFlags: string[]): Options {
  const options: Options = new Map();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (boolFlags.includes(arg)) {
      options.set(arg, true);
    } else if (valueFlags.includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Option ${arg} needs a value.`);
      }
      options.set(arg, value);
      i++;
    } else {
      throw new UsageError(`Unknown option "${arg}". Try --help.`);
    }
  }
  return options;
}

function intOption(options: Options, name: string, fallback: number, min: number, max: number) {
  const raw = options.get(name);
  if (raw === undefined) return fallback;
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new UsageError(`${name} must be an integer ${min}..${max}, got "${String(raw)}".`);
  }
  return value;
}

function parseDeck(options: Options, name: string): CardId[] {
  const raw = options.get(name);
  if (raw === undefined) return [...START_DECK];
  const names = typeof raw === 'string' ? raw.split(',').map((s) => s.trim()) : [];
  const deck: CardId[] = [];
  for (const card of names) {
    if (!(CARD_IDS as readonly string[]).includes(card)) {
      throw new UsageError(`${name}: unknown card "${card}". Cards: ${CARD_IDS.join(', ')}.`);
    }
    if (deck.includes(card as CardId)) {
      throw new UsageError(`${name}: card "${card}" appears twice.`);
    }
    deck.push(card as CardId);
  }
  if (deck.length !== DECK_SIZE) {
    throw new UsageError(`${name}: a deck needs exactly ${DECK_SIZE} cards, got ${deck.length}.`);
  }
  return deck;
}

function player(deck: CardId[], level: number, upgrades: number): PlayerConfig {
  const levels: Partial<Record<CardId, number>> = {};
  for (const card of deck) levels[card] = level;
  if (upgrades === 0) return { deck, levels };
  const unlocked: Partial<Record<CardId, number>> = {};
  for (const card of deck) unlocked[card] = upgrades;
  return { deck, levels, upgrades: unlocked };
}

/** "rattle_gang" for "skeleton.rattle_gang". */
function upgradeName(card: CardId, index: UpgradeIndex): string {
  const id = UPGRADES[card][index].id;
  return id.slice(id.indexOf('.') + 1);
}

function slotText(slot: OfferSlot): string {
  if (slot.kind === 'double') return `double pack ${slot.card}`;
  if (slot.kind === 'upgrade') {
    return `upgrade ${slot.card} #${slot.upgrade + 1} ${upgradeName(slot.card, slot.upgrade)}`;
  }
  return slot.card;
}

/** Active upgrades of one player, e.g. "skeleton.rattle_gang, tnt.short_fuse" or "none". */
function activeText(state: MatchState, side: 0 | 1): string {
  const names: string[] = [];
  for (const card of CARD_IDS) {
    const mask = state.activeUpgrades[side][card] ?? 0;
    for (let i = 0; i < 3; i++) {
      if ((mask & (1 << i)) !== 0) names.push(UPGRADES[card][i as UpgradeIndex].id);
    }
  }
  return names.length === 0 ? 'none' : names.join(', ');
}

function countActive(state: MatchState, side: 0 | 1): number {
  let n = 0;
  for (const card of CARD_IDS) {
    const mask = state.activeUpgrades[side][card] ?? 0;
    for (let i = 0; i < 3; i++) if ((mask & (1 << i)) !== 0) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

function winnerName(w: Winner): string {
  return w === 'draw' ? 'draw' : `player ${NAMES[w]}`;
}

function deckText(p: PlayerConfig): string {
  return p.deck
    .map((card) => {
      const up = p.upgrades?.[card] ?? 0;
      return `${card} (L${p.levels[card] ?? 1}${up > 0 ? `, upgrades ${up}` : ''})`;
    })
    .join(', ');
}

/** Units per side on the field and in the army (D-046); call before the battle starts. */
interface ArmyCount {
  field: [number, number];
  army: [number, number];
}

function countArmy(state: MatchState): ArmyCount {
  const field: [number, number] = [0, 0];
  const army: [number, number] = [0, 0];
  for (const u of state.battle.units) field[u.owner]++;
  for (const entry of state.army) army[entry.player] += entry.unitIds.length;
  return { field, army };
}

function armyText(count: ArmyCount, side: 0 | 1): string {
  const lost = count.army[side] - count.field[side];
  return `${NAMES[side]} ${count.field[side]} units${lost > 0 ? ` (${lost} forfeited)` : ''}`;
}

function runMatch(args: string[]): void {
  const options = parseOptions(
    args,
    ['--seed', '--deck-a', '--deck-b', '--level-a', '--level-b', '--upgrades-a', '--upgrades-b'],
    ['--verbose'],
  );
  const seed = intOption(options, '--seed', DEFAULT_SEED, 0, Number.MAX_SAFE_INTEGER);
  const cfg: MatchConfig = {
    seed,
    players: [
      player(
        parseDeck(options, '--deck-a'),
        intOption(options, '--level-a', 1, 1, MAX_LEVEL),
        intOption(options, '--upgrades-a', 0, 0, ALL_UPGRADES_MASK),
      ),
      player(
        parseDeck(options, '--deck-b'),
        intOption(options, '--level-b', 1, 1, MAX_LEVEL),
        intOption(options, '--upgrades-b', 0, 0, ALL_UPGRADES_MASK),
      ),
    ],
  };
  const verbose = options.has('--verbose');

  console.log(`Engine version: ${ENGINE_VERSION}`);
  console.log(`Seed: ${seed}`);
  console.log(`Deck A: ${deckText(cfg.players[0])}`);
  console.log(`Deck B: ${deckText(cfg.players[1])}`);

  const state = createMatch(cfg);
  const picker = randomPicker(seedRng(seed, PICK_STREAM));
  let draftLines: string[] = [];
  while (state.phase !== 'finished') {
    if (state.phase === 'draft') {
      if (state.draft.pickIndex === 0) {
        const order = state.draft.order.map((p) => NAMES[p]).join(' ');
        draftLines.push(`  Draft order: ${order}`);
      }
      const offer = state.draft.offer;
      const offered = offer === null ? '' : offer.slots.map(slotText).join(' | ');
      const slot = picker(state);
      const chosen = offer?.slots[slot];
      applyPick(state, slot);
      const pick = state.lastPick;
      if (pick !== null && chosen !== undefined) {
        const lost = pick.forfeited > 0 ? `, ${pick.forfeited} forfeited` : '';
        const units =
          pick.kind === 'upgrade'
            ? `+${pick.spawned.length} units`
            : `${pick.spawned.length} units`;
        draftLines.push(
          `  ${NAMES[pick.player]} picks ${slotText(chosen)} (slot ${pick.slot} of: ${offered})` +
            ` -> ${units}${lost}`,
        );
      }
      continue;
    }
    const round = state.round;
    console.log(`\nRound ${round}`);
    console.log(draftLines.join('\n'));
    draftLines = [];
    const battle = startBattle(state);
    const count = countArmy(state);
    const cards = [0, 0];
    for (const entry of state.army) cards[entry.player]!++;
    console.log(
      `  Army at battle start: ${armyText(count, 0)} from ${cards[0]} cards, ` +
        `${armyText(count, 1)} from ${cards[1]} cards`,
    );
    if (verbose) {
      const counts = new Map<string, number>();
      const events: BattleEvent[] = [];
      while (battle.result === null) {
        events.length = 0;
        stepTick(battle, events);
        for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      }
      const text = [...counts.entries()].map(([k, v]) => `${k} ${v}`).join(', ');
      console.log(`  Events: ${text === '' ? 'none' : text}`);
    } else {
      simulateToEnd(battle);
    }
    const result = battle.result;
    if (result === null) throw new Error('battle ended without result');
    endRound(state);
    const seconds = (result.ticks / TICKS_PER_SECOND).toFixed(1);
    console.log(
      `  Battle: ${winnerName(result.winner)} wins by ${result.reason}, ${seconds} s, ` +
        `remaining HP A ${result.hp[0]} / B ${result.hp[1]}`,
    );
    console.log(`  Lives: A ${state.lives[0]} / B ${state.lives[1]}`);
    console.log(`  Active upgrades: A ${activeText(state, 0)} / B ${activeText(state, 1)}`);
  }

  console.log(`\nWinner: ${winnerName(state.winner as Winner)}`);
  console.log(`Rounds: ${state.rounds.length}`);
  console.log(`Picks: ${state.picks.join(',')}`);
  console.log(`Hash: ${hashState(state)}`);
}

// ---------------------------------------------------------------------------
// robust
// ---------------------------------------------------------------------------

function runRobust(args: string[]): number {
  const options = parseOptions(args, ['--matches', '--seed'], []);
  const matches = intOption(options, '--matches', DEFAULT_ROBUST_MATCHES, 1, 100_000_000);
  const startSeed = intOption(options, '--seed', DEFAULT_SEED, 0, Number.MAX_SAFE_INTEGER);
  const rng = seedRng(startSeed, 0);

  let rounds = 0;
  let totalTicks = 0;
  const perRound: RoundStats[] = [];
  let maxTicks = 0;
  let timeouts = 0;
  let drawRounds = 0;
  const wins = { a: 0, b: 0, draw: 0 };
  const pickKinds = { spawn: 0, double: 0, upgrade: 0 };
  let activeAtEnd = 0;
  const started = performance.now();

  for (let i = 0; i < matches; i++) {
    const cfg = randomConfig(rng);
    const picks: number[] = [];
    const picker = randomPicker(seedRng(cfg.seed, PICK_STREAM));
    const fail = (message: string): number => {
      console.error(`FAILED in match ${i + 1} of ${matches} (start seed ${startSeed}): ${message}`);
      console.error(`Match seed: ${cfg.seed}`);
      console.error(`Config: ${JSON.stringify(cfg)}`);
      console.error(`Picks so far: ${picks.join(',')}`);
      console.error('Reproduce with replayMatch(config, picks) from @rumble-realms/engine.');
      return 1;
    };
    try {
      const state = createMatch(cfg);
      while (state.phase !== 'finished') {
        if (state.phase === 'draft') {
          const slot = picker(state);
          picks.push(slot);
          applyPick(state, slot);
          if (state.lastPick !== null) pickKinds[state.lastPick.kind]++;
          continue;
        }
        const count = countArmy(state);
        const result = simulateToEnd(startBattle(state));
        if (result.ticks > TIME_LIMIT_TICKS) {
          return fail(`battle lasted ${result.ticks} ticks (limit ${TIME_LIMIT_TICKS})`);
        }
        const summoned = state.battle.nextUnitId - state.nextUnitId;
        addRound(perRound, state.round, count, result.ticks, result.reason === 'timeout', summoned);
        rounds++;
        totalTicks += result.ticks;
        maxTicks = Math.max(maxTicks, result.ticks);
        if (result.reason === 'timeout') timeouts++;
        if (result.winner === 'draw') drawRounds++;
        endRound(state);
      }
      activeAtEnd += countActive(state, 0) + countActive(state, 1);
      if (state.winner === 0) wins.a++;
      else if (state.winner === 1) wins.b++;
      else wins.draw++;
    } catch (error) {
      return fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
  }

  const ms = performance.now() - started;
  const pct = (n: number, d: number): string => `${((100 * n) / d).toFixed(2)} %`;
  console.log(`Engine version: ${ENGINE_VERSION}`);
  console.log(`Matches: ${matches} (start seed ${startSeed}), rounds: ${rounds}`);
  console.log(
    `Battle duration: mean ${(totalTicks / rounds).toFixed(1)} ticks, max ${maxTicks} ticks ` +
      `(limit ${TIME_LIMIT_TICKS})`,
  );
  console.log(`Time limit endings: ${timeouts} (${pct(timeouts, rounds)})`);
  console.log(`Drawn rounds: ${drawRounds} (${pct(drawRounds, rounds)})`);
  console.log(
    `Match wins: A ${wins.a} (${pct(wins.a, matches)}), B ${wins.b} (${pct(wins.b, matches)}), ` +
      `draw ${wins.draw} (${pct(wins.draw, matches)})`,
  );
  const allPicks = pickKinds.spawn + pickKinds.double + pickKinds.upgrade;
  console.log(
    `Picks: ${allPicks}, special cards ${pct(pickKinds.double + pickKinds.upgrade, allPicks)} ` +
      `(double packs ${pct(pickKinds.double, allPicks)}, upgrades ${pct(pickKinds.upgrade, allPicks)})`,
  );
  console.log(
    `Active upgrades per player at match end: mean ${(activeAtEnd / (2 * matches)).toFixed(2)}`,
  );
  console.log(
    `Run time: ${(ms / 1000).toFixed(2)} s total, ${(ms / matches).toFixed(2)} ms per match`,
  );
  console.log('');
  printRoundStats(perRound);
  return 0;
}

/** Sums per round number (1-based), over all matches that reached that round. */
interface RoundStats {
  rounds: number;
  /** Units per side at battle start, summed over both sides. */
  units: number;
  maxUnits: number;
  armyUnits: number;
  forfeited: number;
  ticks: number;
  timeouts: number;
  /** Units summoned during the battles (both sides). */
  summoned: number;
  maxSummoned: number;
}

function addRound(
  stats: RoundStats[],
  round: number,
  count: ArmyCount,
  ticks: number,
  timeout: boolean,
  summoned: number,
): void {
  let s = stats[round - 1];
  if (s === undefined) {
    for (let i = stats.length; i < round; i++) {
      stats.push({
        rounds: 0,
        units: 0,
        maxUnits: 0,
        armyUnits: 0,
        forfeited: 0,
        ticks: 0,
        timeouts: 0,
        summoned: 0,
        maxSummoned: 0,
      });
    }
    s = stats[round - 1] as RoundStats;
  }
  s.rounds++;
  for (const side of [0, 1] as const) {
    s.units += count.field[side];
    s.maxUnits = Math.max(s.maxUnits, count.field[side]);
    s.armyUnits += count.army[side];
    s.forfeited += count.army[side] - count.field[side];
  }
  s.ticks += ticks;
  if (timeout) s.timeouts++;
  s.summoned += summoned;
  s.maxSummoned = Math.max(s.maxSummoned, summoned);
}

function printRoundStats(stats: RoundStats[]): void {
  console.log('Per round (units per side at battle start):');
  console.log(
    'round  battles  units mean  units max  forfeited  duration mean  time limit' +
      '  summons mean  summons max',
  );
  stats.forEach((s, i) => {
    if (s.rounds === 0) return;
    const cols = [
      String(i + 1).padStart(5),
      String(s.rounds).padStart(8),
      (s.units / (2 * s.rounds)).toFixed(1).padStart(11),
      String(s.maxUnits).padStart(10),
      `${((100 * s.forfeited) / Math.max(1, s.armyUnits)).toFixed(2)} %`.padStart(10),
      `${(s.ticks / s.rounds / TICKS_PER_SECOND).toFixed(1)} s`.padStart(14),
      `${((100 * s.timeouts) / s.rounds).toFixed(2)} %`.padStart(11),
      (s.summoned / s.rounds).toFixed(1).padStart(12),
      String(s.maxSummoned).padStart(11),
    ];
    console.log(cols.join('  '));
  });
}

// ---------------------------------------------------------------------------
// balance
// ---------------------------------------------------------------------------

function runBalanceCommand(args: string[]): number {
  const options = parseOptions(
    args,
    [
      '--seed',
      '--picks',
      '--level',
      '--duels',
      '--matches',
      '--card-matches',
      '--mirror-matches',
      '--deck-matches',
      '--only',
      '--out',
    ],
    [],
  );
  const raw = options.get('--only') ?? 'all';
  const only = BALANCE_PARTS.find((p) => p === raw) ?? (raw === 'all' ? 'all' : undefined);
  if (only === undefined) {
    throw new UsageError(`--only must be ${BALANCE_PARTS.join(', ')}.`);
  }
  const out = options.get('--out');
  return runBalance({
    seed: intOption(options, '--seed', DEFAULT_BALANCE_SEED, 0, 1_000_000_000),
    picks: intOption(options, '--picks', 3, 1, 30),
    level: intOption(options, '--level', 1, 1, MAX_LEVEL),
    duels: intOption(options, '--duels', 1, 1, 1000),
    matches: intOption(options, '--matches', 300, 1, 1_000_000),
    deckMatches: intOption(options, '--deck-matches', 20, 1, 10_000),
    cardMatches: intOption(options, '--card-matches', 1000, 1, 1_000_000),
    mirrorMatches: intOption(options, '--mirror-matches', 400, 1, 1_000_000),
    out: typeof out === 'string' ? out : defaultBalancePath(),
    only: only satisfies BalancePart | 'all',
  });
}

/** A decimal number option like "0.6" within [min, max]. */
function numberOption(options: Options, name: string, fallback: number, min: number, max: number) {
  const raw = options.get(name);
  if (raw === undefined) return fallback;
  const value = typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new UsageError(`${name} must be a number ${min}..${max}, got "${String(raw)}".`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// tune
// ---------------------------------------------------------------------------

function runTuneCommand(args: string[]): number {
  const options = parseOptions(
    args,
    [
      '--seed',
      '--iterations',
      '--matches',
      '--level',
      '--min',
      '--max',
      '--gain',
      '--max-step',
      '--duels',
      '--picks',
      '--out',
    ],
    [],
  );
  const min = numberOption(options, '--min', 0.6, 0.05, 1);
  const max = numberOption(options, '--max', 1.6, 1, 20);
  const out = options.get('--out');
  const started = performance.now();
  const result = runTune({
    seed: intOption(options, '--seed', DEFAULT_TUNE_SEED, 0, 1_000_000_000),
    iterations: intOption(options, '--iterations', 8, 1, 100),
    matches: intOption(options, '--matches', 1500, 1, 1_000_000),
    level: intOption(options, '--level', 1, 1, MAX_LEVEL),
    min,
    max,
    gain: numberOption(options, '--gain', 3, 0, 20),
    maxStep: numberOption(options, '--max-step', 0.25, 0.01, 1),
    duels: intOption(options, '--duels', 1, 0, 1000),
    picks: intOption(options, '--picks', 3, 1, 30),
    out: typeof out === 'string' ? out : undefined,
    log: (line) => console.log(line),
  });
  console.log('');
  console.log(result.markdown);
  if (typeof out === 'string') console.log(`Written: ${out}`);
  console.log(`Run time: ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return 0;
}

/** docs/BALANCE.md in the repo root, wherever pnpm runs the script from. */
function defaultBalancePath(): string {
  return fileURLToPath(new URL('../../../docs/BALANCE.md', import.meta.url));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(argv: string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return 0;
  }
  const first = argv[0];
  const command = first === undefined || first.startsWith('--') ? 'match' : first;
  const rest = command === first ? argv.slice(1) : argv;
  try {
    switch (command) {
      case 'match':
        runMatch(rest);
        return 0;
      case 'robust':
        return runRobust(rest);
      case 'balance':
        return runBalanceCommand(rest);
      case 'tune':
        return runTuneCommand(rest);
      case 'golden':
        parseOptions(rest, [], []);
        console.log(JSON.stringify(createGoldenReplay(), null, 2));
        return 0;
      default:
        throw new UsageError(`Unknown command "${command}". Try --help.`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Error: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

process.exitCode = main(process.argv.slice(2));
