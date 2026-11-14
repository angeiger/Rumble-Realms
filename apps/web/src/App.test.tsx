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
    expect(html).not.toContain('data-testid="deck-screen"');
  });

  it('shows the deck screen on the deck tab', () => {
    const html = renderToString(<AppView {...base} tab="deck" />);
    expect(html).toContain('data-testid="deck-screen"');
    expect(html).toContain('data-testid="tab-bar"');
    expect(html).not.toContain('data-testid="play-button"');
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
