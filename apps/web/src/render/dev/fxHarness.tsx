/**
 * Harness /?harness=fx: the battle renderer on a hand-made battle state, without a match.
 * - Bottom half: units in all statuses and variants (burn, poison, slow, ice, stun, shield,
 *   heat shield, invulnerable, untargetable, damage bonus, giant, ghost, zombie, daughter TNT,
 *   mini golem, whelp growth) and a few combinations; a legend over the empty top rows names them.
 * - Top half: a looping script of all new events (lob + shell + acid puddle, splash, quake,
 *   nova, meteor, breath, summons, spore cloud). The zombie lies down and gets up again.
 * Nothing is simulated: the scenario only sets fields and emits events.
 * Query: legend=0 hides the legend, loop=0 plays the script once, t=<ms> starts at that time.
 */
import {
  AIR,
  createBattle,
  occIndex,
  spawnUnit,
  type BattleEvent,
  type BattleState,
  type CardId,
  type UnitState,
} from '@rumble-realms/engine';
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import type { FrameInfo, GameSession, SessionSnapshot } from '../../game/types.ts';
import { BattleCanvas } from '../BattleCanvas.tsx';

const FOREVER = 1_000_000_000;
const TICK_MS = 50;
const LOOP_MS = 15000;
const LEGEND_HEIGHT = 112;

interface Entry {
  card: CardId;
  label: string;
  set?: (u: UnitState) => void;
  air?: boolean;
}

const ROWS: Entry[][] = [
  [
    { card: 'archer', label: 'burn', set: (u) => (u.burnUntil = FOREVER) },
    { card: 'archer', label: 'poison', set: (u) => (u.poisonUntil = FOREVER) },
    { card: 'knight', label: 'slow', set: (u) => (u.slowUntil = FOREVER) },
    { card: 'knight', label: 'atk slow', set: (u) => (u.atkSlowUntil = FOREVER) },
    {
      card: 'archer',
      label: 'frozen',
      set: (u) => {
        u.stunUntil = FOREVER;
        u.frozenUntil = FOREVER;
      },
    },
    { card: 'knight', label: 'stun', set: (u) => (u.stunUntil = FOREVER) },
  ],
  [
    { card: 'knight', label: 'shield', set: (u) => (u.shield = 200) },
    { card: 'pyromancer', label: 'heat shield', set: (u) => (u.ignoreHits = 2) },
    { card: 'berserker', label: 'invuln', set: (u) => (u.invulnUntil = FOREVER) },
    { card: 'assassin', label: 'untargetable', set: (u) => (u.untargetableUntil = FOREVER) },
    { card: 'healer', label: 'dmg bonus', set: (u) => (u.dmgBonusUntil = FOREVER) },
    {
      card: 'shroomling',
      label: 'giant',
      set: (u) => {
        u.giant = true;
      },
    },
  ],
  [
    {
      card: 'necromancer',
      label: 'ghost (air)',
      air: true,
      set: (u) => {
        u.ghost = true;
      },
    },
    { card: 'skeleton', label: 'zombie', set: (u) => (u.variant = 'zombie') },
    { card: 'skeleton', label: 'zombie lying', set: (u) => (u.variant = 'zombie') },
    { card: 'tnt', label: 'daughter', set: (u) => (u.variant = 'daughter') },
    { card: 'golem', label: 'mini golem', set: (u) => (u.variant = 'mini') },
    { card: 'whelp', label: 'growth x3', air: true, set: (u) => (u.stacks = 3) },
  ],
  [
    {
      card: 'knight',
      label: 'burn+slow+shield',
      set: (u) => {
        u.burnUntil = FOREVER;
        u.slowUntil = FOREVER;
        u.shield = 100;
      },
    },
    {
      card: 'archer',
      label: 'poison+slow+bonus',
      set: (u) => {
        u.poisonUntil = FOREVER;
        u.slowUntil = FOREVER;
        u.dmgBonusUntil = FOREVER;
      },
    },
    {
      card: 'pyromancer',
      label: 'heat+shield+burn',
      set: (u) => {
        u.ignoreHits = 1;
        u.shield = 80;
        u.burnUntil = FOREVER;
      },
    },
    {
      card: 'golem',
      label: 'frozen+shield',
      set: (u) => {
        u.stunUntil = FOREVER;
        u.frozenUntil = FOREVER;
        u.shield = 100;
      },
    },
    { card: 'healer', label: 'revived', set: (u) => (u.variant = 'revived') },
    {
      card: 'bat',
      label: 'burn (air)',
      air: true,
      set: (u) => (u.burnUntil = FOREVER),
    },
  ],
];
const ROW_Y = [1, 3, 5, 7];
const COL_X = [1, 3, 5, 7, 9, 11];

/** A scripted step: fires once per loop when the loop time passes `at`. */
interface Step {
  at: number;
  run: (s: Scenario) => void;
}

class Scenario {
  readonly battle: BattleState;
  readonly events: BattleEvent[] = [];
  private readonly temp: number[] = [];
  private lying: UnitState | null = null;
  private readonly steps: Step[];
  /** Time in the loop in ms (dev: read as `window.__fxMs` by screenshot scripts). */
  timeMs = 0;
  private lastMs = -1;

  constructor() {
    this.battle = createBattle([1, 2, 3, 4]);
    this.battle.started = true;
    ROWS.forEach((row, r) => {
      row.forEach((e, c) => {
        const u = spawnUnit(
          this.battle,
          0,
          e.card,
          1,
          COL_X[c] as number,
          ROW_Y[r] as number,
          undefined,
          e.air === true ? AIR : undefined,
        );
        e.set?.(u);
        if (e.label === 'zombie lying') this.lying = u;
      });
    });
    // Actors of the effect script, on the middle and the far half of the field.
    spawnUnit(this.battle, 0, 'beetle', 1, 3, 10);
    spawnUnit(this.battle, 0, 'whelp', 1, 9, 10, undefined, AIR);
    spawnUnit(this.battle, 1, 'golem', 1, 6, 15);
    spawnUnit(this.battle, 1, 'frost_shaman', 1, 9, 15);
    spawnUnit(this.battle, 1, 'pyromancer', 1, 9, 19);
    spawnUnit(this.battle, 1, 'archer', 1, 3, 17);
    spawnUnit(this.battle, 1, 'knight', 1, 4, 17);
    spawnUnit(this.battle, 1, 'archer', 1, 6, 19);
    this.steps = this.script();
  }

  private id(card: CardId): number {
    return (this.battle.units.find((u) => u.card === card) as UnitState).id;
  }

  private spawnTemp(
    owner: 0 | 1,
    card: CardId,
    x: number,
    y: number,
    set: (u: UnitState) => void,
  ): UnitState {
    const u = spawnUnit(this.battle, owner, card, 1, x, y);
    set(u);
    this.temp.push(u.id);
    return u;
  }

  private clearTemp(): void {
    const b = this.battle;
    for (const id of this.temp) {
      const i = b.units.findIndex((u) => u.id === id);
      if (i < 0) continue;
      const u = b.units[i] as UnitState;
      b.occ[occIndex(u.layer, u.x, u.y)] = 0;
      b.units.splice(i, 1);
    }
    this.temp.length = 0;
  }

  private script(): Step[] {
    const t = (s: Scenario) => s.battle.tick;
    return [
      {
        at: 0,
        run: (s) => s.clearTemp(),
      },
      {
        at: 500,
        run: (s) =>
          s.events.push({
            type: 'lob',
            id: 1,
            unit: s.id('beetle'),
            x: 3,
            y: 17,
            impactTick: t(s) + 30,
          }),
      },
      {
        at: 2000,
        run: (s) => {
          const unit = s.id('beetle');
          s.events.push(
            { type: 'impact', kind: 'shell', unit, x: 3, y: 17, radius: 1500 },
            { type: 'zone', kind: 'acid', id: 101, x: 3, y: 17, radius: 1500, endTick: t(s) + 70 },
          );
        },
      },
      {
        at: 3000,
        run: (s) =>
          s.events.push({
            type: 'impact',
            kind: 'splash',
            unit: s.id('pyromancer'),
            x: 9,
            y: 18,
            radius: 1000,
          }),
      },
      {
        at: 4000,
        run: (s) =>
          s.events.push({
            type: 'impact',
            kind: 'quake',
            unit: s.id('golem'),
            x: 6,
            y: 15,
            radius: 1500,
          }),
      },
      {
        at: 5200,
        run: (s) =>
          s.events.push({
            type: 'impact',
            kind: 'nova',
            unit: s.id('frost_shaman'),
            x: 9,
            y: 15,
            radius: 2000,
          }),
      },
      {
        at: 6400,
        run: (s) =>
          s.events.push({
            type: 'impact',
            kind: 'meteor',
            unit: s.id('pyromancer'),
            x: 6,
            y: 19,
            radius: 1500,
          }),
      },
      {
        at: 7600,
        run: (s) =>
          s.events.push({
            type: 'breath',
            unit: s.id('whelp'),
            x: 9,
            y: 10,
            target: 0,
            tx: 9,
            ty: 14,
            range: 4,
          }),
      },
      {
        at: 8300,
        run: (s) => {
          const u = s.spawnTemp(0, 'skeleton', 5, 12, () => undefined);
          s.events.push({ type: 'summon', unit: u.id, summoner: 0, card: 'skeleton', x: 5, y: 12 });
        },
      },
      {
        at: 9000,
        run: (s) => {
          const u = s.spawnTemp(0, 'healer', 7, 12, (x) => (x.variant = 'revived'));
          s.events.push({ type: 'summon', unit: u.id, summoner: 0, card: 'healer', x: 7, y: 12 });
        },
      },
      {
        at: 9700,
        run: (s) => {
          const u = s.spawnTemp(0, 'necromancer', 9, 12, (x) => (x.ghost = true));
          s.events.push({
            type: 'summon',
            unit: u.id,
            summoner: 0,
            card: 'necromancer',
            x: 9,
            y: 12,
          });
        },
      },
      {
        at: 10400,
        run: (s) => {
          const u = s.spawnTemp(0, 'skeleton', 3, 12, (x) => {
            x.variant = 'zombie';
            x.stunUntil = t(s) + 40;
            x.invulnUntil = t(s) + 40;
          });
          s.events.push({ type: 'summon', unit: u.id, summoner: 0, card: 'skeleton', x: 3, y: 12 });
        },
      },
      {
        at: 11600,
        run: (s) =>
          s.events.push({
            type: 'zone',
            kind: 'spores',
            id: 102,
            x: 6,
            y: 17,
            radius: 1000,
            endTick: t(s) + 60,
          }),
      },
      {
        at: 12000,
        run: (s) => {
          // The lying zombie of the showcase gets up and lies down again for each loop.
          if (s.lying !== null) {
            s.lying.stunUntil = t(s) + 40;
            s.lying.invulnUntil = t(s) + 40;
            s.lying.untargetableUntil = t(s) + 40;
          }
        },
      },
      {
        at: 13500,
        run: (s) => s.clearTemp(),
      },
    ];
  }

  /** Advances the scenario by `dtMs` of real time and returns the frame description. */
  advance(dtMs: number, loop: boolean): FrameInfo {
    this.events.length = 0;
    const prev = this.timeMs;
    this.timeMs += dtMs;
    this.battle.tick = Math.floor(this.timeMs / TICK_MS);
    const frameStart = prev;
    let now = this.timeMs;
    if (loop && now >= LOOP_MS) {
      now %= LOOP_MS;
      this.timeMs = now;
      this.lastMs = -1;
    }
    // The zombie of the first loop lies from the start.
    if (frameStart === 0 && this.lying !== null) {
      this.lying.stunUntil = 40;
      this.lying.invulnUntil = 40;
    }
    for (const step of this.steps) {
      if (step.at > this.lastMs && step.at <= now) step.run(this);
    }
    this.lastMs = now;
    (window as unknown as { __fxMs?: number }).__fxMs = this.timeMs;
    return {
      events: this.events,
      ticks: 0,
      alpha: (this.timeMs % TICK_MS) / TICK_MS,
      fieldReset: false,
    };
  }
}

function createFxSession(loop: boolean, startMs: number): GameSession {
  const scenario = new Scenario();
  const snapshot: SessionSnapshot = {
    phase: 'battle',
    round: 1,
    me: 0,
    players: [
      { name: 'Me', isBot: false, deck: [], levels: {}, upgrades: {} },
      { name: 'Bot', isBot: true, deck: [], levels: {}, upgrades: {} },
    ],
    lives: [3, 3],
    turn: null,
    picksLeft: [0, 0],
    offer: null,
    lastPick: null,
    roundResult: null,
    winner: null,
    speed: 1,
    activeUpgrades: [{}, {}],
  };
  let pending = startMs;
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    battle: scenario.battle,
    play: () => undefined,
    setSpeed: () => undefined,
    advance: (dtMs: number) => {
      // A start offset is played in small steps so that no script step is skipped.
      let frame = scenario.advance(dtMs, loop);
      while (pending > 0) {
        const step = Math.min(pending, 100);
        pending -= step;
        frame = scenario.advance(step, loop);
      }
      return frame;
    },
  };
}

function legendLines(): string[] {
  return ROWS.map(
    (row, r) =>
      `Row ${r + 1}${r === 0 ? ' (bottom)' : ''}: ${row.map((e) => `${e.card}:${e.label}`).join(', ')}`,
  );
}

function Harness() {
  const params = new URLSearchParams(window.location.search);
  const loop = params.get('loop') !== '0';
  const startMs = Number.parseInt(params.get('t') ?? '0', 10) || 0;
  const showLegend = params.get('legend') !== '0';
  const session = useMemo(() => createFxSession(loop, startMs), [loop, startMs]);
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <BattleCanvas session={session} />
      {showLegend && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            pointerEvents: 'none',
            height: LEGEND_HEIGHT,
            boxSizing: 'border-box',
            padding: '6px 8px',
            background: 'rgba(20, 23, 46, 0.85)',
            color: '#fff6d6',
            font: '600 10px/1.35 system-ui, sans-serif',
            overflow: 'hidden',
          }}
        >
          {legendLines().map((line) => (
            <div key={line}>{line}</div>
          ))}
          <div>Top half: lob, shell+acid, splash, quake, nova, meteor, breath, summons, spores</div>
        </div>
      )}
    </div>
  );
}

export function mountFxHarness(root: HTMLElement): void {
  document.body.style.margin = '0';
  createRoot(root).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
