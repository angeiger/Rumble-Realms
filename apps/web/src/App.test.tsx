import { ENGINE_VERSION } from '@rumble-realms/engine';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App, AppView, type AppViewProps } from './App.tsx';
import { START_DECK } from './game/config.ts';

const base: AppViewProps = {
  screen: 'title',
  tab: 'battle',
  deck: START_DECK,
  levels: {},
  botLevel: 'easy',
  onBotLevel: () => undefined,
  onTab: () => undefined,
  onPlay: () => undefined,
};

describe('App', () => {
  it('renders the title screen with play button and engine version', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Rumble Realms');
    expect(html).toContain('data-testid="play-button"');
    expect(html).toContain('Spielen');
    expect(html).toContain(`Engine v${ENGINE_VERSION}`);
    expect(html).toContain('Prototyp: Kampf gegen einen Bot');
  });

  it('shows the tab bar with the battle tab active and the current deck', () => {
    const html = renderToString(<App />);
    expect(html).toContain('data-testid="tab-bar"');
    expect(html).toContain('data-testid="tab-battle"');
    expect(html).toContain('data-testid="tab-deck"');
    expect(html).toContain('data-testid="mini-deck"');
    expect(html).toMatch(
      /data-testid="tab-battle"[^>]*aria-current="page"|aria-current="page"[^>]*data-testid="tab-battle"/,
    );
  });

  it('puts the deck page left of the battle page and only the active one is reachable', () => {
    const html = renderToString(<App />);
    expect(html.indexOf('data-testid="page-deck"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="page-deck"')).toBeLessThan(
      html.indexOf('data-testid="page-battle"'),
    );
    expect(html.indexOf('data-testid="deck-screen"')).toBeLessThan(
      html.indexOf('data-testid="play-button"'),
    );
    // The page of the inactive tab is inert.
    expect(html).toMatch(/<div class="pager__page"[^>]*data-testid="page-deck"[^>]*inert/);
    expect(html).not.toMatch(/<div class="pager__page"[^>]*data-testid="page-battle"[^>]*inert/);
  });

  it('shows the deck screen on the deck tab', () => {
    const html = renderToString(<AppView {...base} tab="deck" />);
    expect(html).toContain('data-testid="deck-screen"');
    expect(html).toContain('data-testid="tab-bar"');
    expect(html).toMatch(/<div class="pager__page"[^>]*data-testid="page-battle"[^>]*inert/);
    expect(html).toMatch(/data-testid="tab-pager" data-tab="deck"/);
  });

  it('shows the current deck with levels on the battle tab', () => {
    const html = renderToString(
      <AppView {...base} deck={['assassin', 'tnt', 'knight', 'archer']} levels={{ tnt: 3 }} />,
    );
    expect(html).toContain('Assassine');
    expect(html).toContain('Lauf-TNT');
    expect(html).toContain('Level 3');
  });

  it('has no tab bar during the battle', () => {
    const html = renderToString(<AppView {...base} screen="battle" />);
    expect(html).not.toContain('data-testid="tab-bar"');
    expect(html).not.toContain('data-testid="play-button"');
  });
});
