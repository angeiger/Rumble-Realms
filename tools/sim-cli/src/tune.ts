/**
 * Tuning proposal (`pnpm sim tune`): finds factors for hit points and damage of every card so
 * that its win rate in a deck (see deckStats.ts) comes close to 50 %.
 *
 * The values are changed only in the memory of this process: the card definitions in `CARDS`
 * are mutated in place (the engine reads `hp` when a unit spawns and the damage or heal value
 * at every attack, so the change reaches every place) and restored afterwards. Nothing is
 * written to the engine files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CARDS, CARD_IDS, ENGINE_VERSION, MAX_LEVEL } from '@rumble-realms/engine';
import type { CardDef, CardId } from '@rumble-realms/engine';
import { runCards } from './balance.ts';
import { ci95, deckWinRates, runDeckCardMatches } from './deckStats.ts';
import type { DeckCardResults } from './deckStats.ts';
import { num, pc, table } from './report.ts';

export const DEFAULT_TUNE_SEED = 20260202;
/** Random streams: iteration i uses TUNE_STREAM + i, the final check the next one. */
const TUNE_STREAM = 300;

/** The tunable values of one card (level 1, engine units). */
export interface CardValues {
  hp: number;
  /** Attack damage (melee, ranged, artillery, explosion) or heal amount of the healer. */
  damage: number;
  /** Damage per second of the death cloud (shroomlings), scaled with the damage. */
  cloudDps?: number;
}

/** Reads the current tunable values of `card` from `CARDS`. */
export function readValues(card: CardId): CardValues {
  const def = CARDS[card];
  const atk = def.attack;
  const damage = atk.kind === 'heal' ? atk.amount : atk.damage;
  const values: CardValues = { hp: def.hp, damage };
  if (def.deathCloud !== undefined) values.cloudDps = def.deathCloud.damagePerSecond;
  return values;
}

/**
 * Writes `values` into the card definition in `CARDS` (in place, this process only).
 * The healer's emergency melee (`fallbackDamage`) stays as it is.
 */
export function writeValues(card: CardId, values: CardValues): void {
  const def: CardDef = CARDS[card];
  def.hp = values.hp;
  const atk = def.attack;
  if (atk.kind === 'heal') atk.amount = values.damage;
  else atk.damage = values.damage;
  if (def.deathCloud !== undefined && values.cloudDps !== undefined) {
    def.deathCloud.damagePerSecond = values.cloudDps;
  }
}

/** All tunable values, in the order of CARD_IDS. */
export function snapshotValues(): CardValues[] {
  return CARD_IDS.map(readValues);
}

/**
 * Values for a strength factor: hit points and damage each grow with the square root of the
 * factor (rounded to integers, at least 1), so that hp x damage grows with the factor.
 */
export function scaledValues(base: CardValues, factor: number): CardValues {
  const root = Math.sqrt(factor);
  const scale = (v: number): number => Math.max(1, Math.round(v * root));
  const values: CardValues = { hp: scale(base.hp), damage: scale(base.damage) };
  if (base.cloudDps !== undefined) values.cloudDps = scale(base.cloudDps);
  return values;
}

/** Runs `fn` with `values` (by CARD_IDS index) in `CARDS` and always restores the old values. */
export function withCardValues<T>(values: readonly CardValues[], fn: () => T): T {
  const saved = snapshotValues();
  try {
    CARD_IDS.forEach((card, i) => writeValues(card, values[i] as CardValues));
    return fn();
  } finally {
    CARD_IDS.forEach((card, i) => writeValues(card, saved[i] as CardValues));
  }
}

export interface UpdateOptions {
  /** Relative change per percentage point of distance from 50 % (0.01 x gain). */
  gain: number;
  /** Largest relative change of a factor per iteration (damping), e.g. 0.25. */
  maxStep: number;
  /** Bounds of every factor. */
  min: number;
  max: number;
}

/**
 * One damped step of the multiplicative tracking (pure, no simulation):
 * 1. factor x (1 + gain x (0.5 - rate)), the step limited to [1/(1+maxStep), 1+maxStep];
 * 2. all factors divided by their mean, so that the overall strength stays the same;
 * 3. every factor clamped to [min, max] and rounded to three decimals.
 * Plain arithmetic and rounding only, so the result is the same on every machine.
 */
export function nextFactors(
  factors: readonly number[],
  rates: readonly number[],
  o: UpdateOptions,
): number[] {
  const up = 1 + o.maxStep;
  const stepped = factors.map((f, i) => {
    const step = 1 + o.gain * (0.5 - (rates[i] as number));
    return f * Math.min(up, Math.max(1 / up, step));
  });
  const mean = stepped.reduce((a, b) => a + b, 0) / Math.max(1, stepped.length);
  return stepped.map((f) => {
    const clamped = Math.min(o.max, Math.max(o.min, f / mean));
    return Math.round(clamped * 1000) / 1000;
  });
}

export interface TuneOptions extends UpdateOptions {
  seed: number;
  iterations: number;
  /** Random matches per iteration (and for the final check). */
  matches: number;
  level: number;
  /** Card duel ranking at the end: seeds per pair (0 = skip) and picks per side. */
  duels: number;
  picks: number;
  /** Markdown file to write, or undefined. */
  out: string | undefined;
  log: (line: string) => void;
}

export interface TuneResult {
  /** Factor used in every iteration, then the proposal: factors[iteration][card]. */
  factors: number[][];
  /** Win rate measured in every iteration, then the final check: rates[iteration][card]. */
  rates: number[][];
  uses: number[][];
  original: CardValues[];
  proposed: CardValues[];
  duelBefore: number[] | null;
  duelAfter: number[] | null;
  markdown: string;
}

function measure(o: TuneOptions, stream: number, values: readonly CardValues[]): DeckCardResults {
  return withCardValues(values, () => runDeckCardMatches(o.seed, stream, o.matches, o.level));
}

function rateLine(label: string, rates: readonly number[], factors: readonly number[]): string {
  const worst = rates.reduce((m, r) => Math.max(m, Math.abs(r - 0.5)), 0);
  const cells = CARD_IDS.map(
    (c, i) => `${c} ${pc(rates[i] as number)} (x${num(factors[i] as number, 2)})`,
  );
  return `${label}: max deviation ${pc(worst)} pp | ${cells.join(', ')}`;
}

/** Runs the whole tuning; `CARDS` holds its original values again afterwards. */
export function runTune(o: TuneOptions): TuneResult {
  const original = snapshotValues();
  const valuesFor = (f: readonly number[]): CardValues[] =>
    original.map((v, i) => scaledValues(v, f[i] as number));
  const factors: number[][] = [];
  const rates: number[][] = [];
  const uses: number[][] = [];
  let current = CARD_IDS.map(() => 1);
  for (let it = 1; it <= o.iterations; it++) {
    const res = measure(o, TUNE_STREAM + it, valuesFor(current));
    const r = deckWinRates(res);
    factors.push(current);
    rates.push(r);
    uses.push(res.uses);
    o.log(rateLine(`Iteration ${it}/${o.iterations}`, r, current));
    current = nextFactors(current, r, o);
  }
  const proposed = valuesFor(current);
  const check = measure(o, TUNE_STREAM + o.iterations + 1, proposed);
  const finalRates = deckWinRates(check);
  factors.push(current);
  rates.push(finalRates);
  uses.push(check.uses);
  o.log(rateLine('Check with the proposal', finalRates, current));
  let duelBefore: number[] | null = null;
  let duelAfter: number[] | null = null;
  if (o.duels > 0) {
    duelBefore = runCards(o.seed, o.duels, o.picks, o.level).mean;
    duelAfter = withCardValues(proposed, () => runCards(o.seed, o.duels, o.picks, o.level).mean);
  }
  const result: TuneResult = {
    factors,
    rates,
    uses,
    original,
    proposed,
    duelBefore,
    duelAfter,
    markdown: '',
  };
  result.markdown = tuneMarkdown(o, result);
  if (o.out !== undefined) {
    mkdirSync(dirname(o.out), { recursive: true });
    writeFileSync(o.out, result.markdown);
  }
  return result;
}

function valueText(v: CardValues): string {
  return v.cloudDps === undefined
    ? `${v.hp} / ${v.damage}`
    : `${v.hp} / ${v.damage} (Wolke ${v.cloudDps}/s)`;
}

export function tuneMarkdown(o: TuneOptions, r: TuneResult): string {
  const n = o.iterations;
  const itHeader = Array.from({ length: n }, (_, i) => `It. ${i + 1}`);
  const rateTable = table(
    ['Karte', ...itHeader, 'Prüfung'],
    CARD_IDS.map((c, i) => [c, ...r.rates.map((row) => pc(row[i] as number))]),
  );
  const factorTable = table(
    ['Karte', ...itHeader, 'Vorschlag'],
    CARD_IDS.map((c, i) => [c, ...r.factors.map((row) => num(row[i] as number, 3))]),
  );
  const before = r.rates[0] as number[];
  const after = r.rates[r.rates.length - 1] as number[];
  const proposal = r.factors[r.factors.length - 1] as number[];
  const usesBefore = r.uses[0] as number[];
  const usesAfter = r.uses[r.uses.length - 1] as number[];
  const resultTable = table(
    [
      'Karte',
      'LP / Schaden alt',
      'Stärkefaktor',
      'LP / Schaden neu',
      'LP-Faktor real',
      'Schadensfaktor real',
      'Siegquote vorher (%)',
      'Siegquote nachher (%)',
    ],
    CARD_IDS.map((c, i) => {
      const old = r.original[i] as CardValues;
      const neu = r.proposed[i] as CardValues;
      return [
        c,
        valueText(old),
        num(proposal[i] as number, 3),
        valueText(neu),
        num(neu.hp / old.hp, 3),
        num(neu.damage / old.damage, 3),
        `${pc(before[i] as number)} ± ${pc(ci95(before[i] as number, usesBefore[i] as number))}`,
        `${pc(after[i] as number)} ± ${pc(ci95(after[i] as number, usesAfter[i] as number))}`,
      ];
    }),
  );
  const spread = (rates: readonly number[]): string =>
    pc(rates.reduce((m, x) => Math.max(m, Math.abs(x - 0.5)), 0));
  const parts = [
    '# Tuning-Vorschlag',
    '',
    '> Erzeugt mit `pnpm sim tune`. Die Werte wurden nur im Arbeitsspeicher des Tools geändert; die Engine-Dateien sind unverändert.',
    '',
    '## Parameter',
    '',
    table(
      ['Parameter', 'Wert'],
      [
        ['ENGINE_VERSION', String(ENGINE_VERSION)],
        ['Start-Seed (`--seed`)', String(o.seed)],
        ['Iterationen (`--iterations`)', String(o.iterations)],
        ['Matches pro Iteration (`--matches`)', String(o.matches)],
        ['Level beider Seiten (`--level`)', `${o.level} (max. ${MAX_LEVEL})`],
        ['Nachführung (`--gain`)', `${num(o.gain, 2)} (Faktor × (1 + gain × (0,5 − Siegquote)))`],
        ['Größter Schritt pro Iteration (`--max-step`)', `${pc(o.maxStep, 0)} %`],
        ['Bereich der Faktoren (`--min`, `--max`)', `${num(o.min, 2)} bis ${num(o.max, 2)}`],
        [
          'Kartenduell am Ende (`--duels`, `--picks`)',
          o.duels > 0 ? `${o.duels} Seeds pro Paar, ${o.picks} Picks` : 'aus',
        ],
      ],
    ),
    '',
    '## Verfahren',
    '',
    '- Jede Iteration spielt neue Zufallsmatches wie im Balance-Bericht (Abschnitt „Siegquote je Karte im Deck“): zufällige Decks aus 4 verschiedenen Karten, beide Seiten gleiches Level, alle Upgrades freigeschaltet, Zufallspicks.',
    '- Danach wird der Stärkefaktor jeder Karte multiplikativ nachgeführt: zu starke Karten schwächer, zu schwache stärker, gedämpft über `--gain` und `--max-step`. Anschließend werden alle Faktoren durch ihren Mittelwert geteilt (die Gesamtstärke bleibt gleich), auf den Bereich begrenzt und auf drei Stellen gerundet.',
    '- Der Faktor verteilt sich gleichmäßig auf LP und Schaden: beide werden mit der Wurzel des Faktors multipliziert und auf ganze Zahlen gerundet.',
    '- Die Spalte „Prüfung“ bzw. „nachher“ misst den Vorschlag in einer eigenen, frischen Stichprobe; „vorher“ ist Iteration 1 mit den Originalwerten.',
    '',
    '### Was skaliert wird',
    '',
    '- **LP** (`hp`): gilt für jede Einheit der Karte beim Erscheinen, auch für Einheiten aus Upgrades derselben Karte (Zombie, Mini-Golem, Tochter-TNT, Wiederbelebte, Geist des Nekromanten) und vor Level- und Upgrade-Boni.',
    '- **Schaden** (`attack.damage`, bei jedem Angriff gelesen): Nahkampf, Geschosse, Artillerie und Explosion des Lauf-TNT. Beim **Heiler** stattdessen der Heilwert (`attack.amount`); sein Notangriff (`fallbackDamage`, 10) bleibt unverändert.',
    '- **Pilzlinge:** die Sporenwolke beim Tod (`deathCloud.damagePerSecond`) wächst mit dem Schadensfaktor.',
    '- **Nekromant:** seine beschworenen Skelette sind Einheiten der Karte `skeleton` und bekommen deren Werte, nicht die des Nekromanten. Die Faktoren von Skeletten und Nekromant sind deshalb gekoppelt; die Nachführung misst das mit.',
    '- **Nicht skaliert:** feste Zahlen der Upgrades (z. B. Meteor, Erdstoß, Bajonett, Knochenhagel, Säurepfütze, Schildpunkte, Ansteckend). Die Engine liest sie beim Laden aus `data/upgrades.ts`. Prozentuale Boni (LP-Bonus, Lebensraub, Schadensbonus) wirken auf die skalierten Werte.',
    '',
    '## Siegquote je Karte im Deck pro Iteration (%)',
    '',
    rateTable,
    '',
    `Größte Abweichung von 50 %: vorher ${spread(before)} Prozentpunkte, nachher ${spread(after)} Prozentpunkte.`,
    '',
    '## Stärkefaktor pro Iteration',
    '',
    factorTable,
    '',
    '## Vorschlag je Karte',
    '',
    'Werte auf Level 1 (LP / Schaden bzw. Heilwert). „Real“ ist das Verhältnis nach dem Runden auf ganze Zahlen. Das Intervall ist die grobe 95-%-Näherung.',
    '',
    resultTable,
    '',
  ];
  if (r.duelBefore !== null && r.duelAfter !== null) {
    const db = r.duelBefore;
    const da = r.duelAfter;
    const order = CARD_IDS.map((_, i) => i).sort(
      (a, b) => (da[b] as number) - (da[a] as number) || a - b,
    );
    parts.push(
      `## Nebenwirkung: Karte gegen Karte (${o.picks} ${o.picks === 1 ? 'Pick' : 'Picks'})`,
      '',
      'Mittlere Siegquote im Kartenduell wie im Balance-Bericht, mit den Originalwerten und mit dem Vorschlag (gleiche Seeds).',
      '',
      table(
        ['Rang', 'Karte', 'Vorher (%)', 'Nachher (%)'],
        order.map((i, k) => [
          String(k + 1),
          CARD_IDS[i] as string,
          pc(db[i] as number),
          pc(da[i] as number),
        ]),
      ),
      '',
    );
  }
  return parts.join('\n').replace(/\n+$/, '\n');
}
