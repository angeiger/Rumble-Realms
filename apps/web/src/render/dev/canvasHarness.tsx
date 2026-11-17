/**
 * Harness /?harness=canvas: a full-screen BattleCanvas with a local match that plays
 * itself (the human picks slot 0 whenever an offer appears).
 * Query: seed=<n> (default 1), speed=1|2, deck=tnt,assassin,shroomling,bat (player deck).
 */
import { BOT_PROFILES, CARDS, ENGINE_VERSION, type CardId } from '@rumble-realms/engine';
import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createLocalSession } from '../../game/session.ts';
import { START_DECK } from '../../game/config.ts';
import { BattleCanvas } from '../BattleCanvas.tsx';

function parseDeck(value: string | null): CardId[] | undefined {
  if (value === null) return undefined;
  const ids = value.split(',').filter((id): id is CardId => id in CARDS);
  return ids.length === 0 ? undefined : ids;
}

function Harness() {
  const params = new URLSearchParams(window.location.search);
  const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
  const speed = params.get('speed') === '2' ? 2 : 1;
  const deckParam = params.get('deck');

  const session = useMemo(() => {
    const bot = BOT_PROFILES.find((b) => b.name.includes('Gustav')) ?? BOT_PROFILES[0];
    if (bot === undefined) throw new Error('No bot profile');
    const deck = parseDeck(deckParam) ?? START_DECK;
    const levels = Object.fromEntries(deck.map((card) => [card, 1]));
    const s = createLocalSession({
      ticket: {
        matchId: 'harness',
        seed,
        engineVersion: ENGINE_VERSION,
        botLevel: bot.level,
        botProfile: bot.id,
        player: { deck: [...deck], levels },
      },
      playerName: 'Harness',
    });
    s.setSpeed(speed);
    return s;
  }, [seed, speed, deckParam]);

  useEffect(() => {
    const autoPick = () => {
      if (session.getSnapshot().offer === null) return;
      session.play(0);
    };
    autoPick();
    return session.subscribe(autoPick);
  }, [session]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <BattleCanvas session={session} />
    </div>
  );
}

export function mountCanvasHarness(root: HTMLElement): void {
  document.body.style.margin = '0';
  createRoot(root).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
