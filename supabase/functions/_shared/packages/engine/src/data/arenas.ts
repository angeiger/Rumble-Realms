/**
 * Arenas (SPEC 7.5): Elo threshold, gold multiplier of the packs. The card pool follows from
 * `CardDef.arena`. Display names are UI texts and live in the web app.
 */
export interface ArenaDef {
  /** 1-based; equals the index plus one. */
  id: number;
  /** Elo from which the arena is reached. */
  minElo: number;
  /** Gold multiplier in basis points (10000 = 1.0). */
  goldMultiplierBps: number;
}

export const ARENAS: readonly ArenaDef[] = [
  { id: 1, minElo: 0, goldMultiplierBps: 10000 },
  { id: 2, minElo: 1100, goldMultiplierBps: 12000 },
  { id: 3, minElo: 1250, goldMultiplierBps: 14000 },
  { id: 4, minElo: 1400, goldMultiplierBps: 16000 },
  { id: 5, minElo: 1600, goldMultiplierBps: 20000 },
];
