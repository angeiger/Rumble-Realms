/** Names and short effect texts of the upgrades (SPEC 5.4); keys derive from the engine's upgrade id. */
import { UPGRADES, UPGRADES_PER_CARD, type CardId } from '@rumble-realms/engine';
import { t, type MessageKey } from '../i18n/index.ts';

export type UpgradeIndex = 0 | 1 | 2;

/** Engine id of upgrade `index` of `card`, e.g. `knight.shield`. */
export function upgradeId(card: CardId, index: number): string {
  const def = UPGRADES[card][index];
  if (def === undefined) throw new Error(`upgradeId: ${card} has no upgrade ${index}`);
  return def.id;
}

export function upgradeName(card: CardId, index: number): string {
  return t(`upgrade.${upgradeId(card, index)}.name` as MessageKey);
}

export function upgradeText(card: CardId, index: number): string {
  return t(`upgrade.${upgradeId(card, index)}.text` as MessageKey);
}

/** Indices (0..2) of the bits set in `mask`, ascending. */
export function maskIndices(mask: number): UpgradeIndex[] {
  const out: UpgradeIndex[] = [];
  for (let i = 0; i < UPGRADES_PER_CARD; i++)
    if ((mask & (1 << i)) !== 0) out.push(i as UpgradeIndex);
  return out;
}

export interface ActiveUpgrade {
  card: CardId;
  index: UpgradeIndex;
}

/** All set bits of a per-card mask table, in card order of `UPGRADES`. */
export function activeUpgradeList(masks: Partial<Record<CardId, number>>): ActiveUpgrade[] {
  const out: ActiveUpgrade[] = [];
  for (const card of Object.keys(UPGRADES) as CardId[]) {
    for (const index of maskIndices(masks[card] ?? 0)) out.push({ card, index });
  }
  return out;
}
