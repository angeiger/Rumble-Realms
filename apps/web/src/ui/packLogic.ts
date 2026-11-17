/** Pure logic of the reward packs (SPEC 7.4, 9.5): which pack is next, what a reward says. */
import type { PackReward } from '@rumble-realms/shared';
import type { PackInfo } from '../backend/types.ts';
import { t } from '../i18n/index.ts';

/** The pack to show first: the preferred one if it is still unopened, else the oldest. */
export function pickPack(packs: readonly PackInfo[], preferId: string | null): PackInfo | null {
  if (preferId !== null) {
    const preferred = packs.find((p) => p.id === preferId);
    if (preferred !== undefined) return preferred;
  }
  return packs[0] ?? null;
}

/** The pack after `doneId` was opened (the list may or may not still contain it); null if none. */
export function nextPack(packs: readonly PackInfo[], doneId: string): PackInfo | null {
  return packs.find((p) => p.id !== doneId) ?? null;
}

/** The welcome pack to open by itself, once per app start (SPEC 9.5); null if none or done. */
export function welcomeToOpen(packs: readonly PackInfo[], alreadyShown: boolean): PackInfo | null {
  if (alreadyShown) return null;
  return packs.find((p) => p.kind === 'welcome') ?? null;
}

export interface RewardLine {
  kind: PackReward['kind'];
  /** Main line, e.g. "+3 Kopien", "+80 Gold", "+2 Joker". */
  text: string;
  /** Only for card rewards: this card was not owned before. */
  isNew: boolean;
}

export function rewardLine(reward: PackReward, cardUnlocked: boolean): RewardLine {
  switch (reward.kind) {
    case 'cards':
      return {
        kind: 'cards',
        text: t(reward.copies === 1 ? 'pack.copiesOne' : 'pack.copies', { n: reward.copies }),
        isNew: cardUnlocked,
      };
    case 'gold':
      return { kind: 'gold', text: t('pack.gold', { n: reward.gold }), isNew: false };
    case 'jokers':
      return { kind: 'jokers', text: t('pack.jokers', { n: reward.jokers }), isNew: false };
  }
}

export function packTitle(kind: PackInfo['kind']): string {
  return kind === 'welcome' ? t('pack.welcomeTitle') : t('pack.title');
}
