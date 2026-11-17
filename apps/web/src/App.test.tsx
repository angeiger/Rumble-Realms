import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App, AppView } from './App.tsx';
import { setBackendForTests } from './backend/index.ts';
import { resetAccountStoreForTests } from './game/accountStore.ts';
import { useGameStore } from './game/store.ts';
import { fakeBackend, fakePlayer, viewProps } from './ui/fakes.ts';

describe('AppView by account status', () => {
  it('shows the loading screen while the session is restored', () => {
    const html = renderToString(<AppView {...viewProps({ status: 'loading', player: null })} />);
    expect(html).toContain('data-testid="loading-screen"');
    expect(html).not.toContain('data-testid="tab-bar"');
  });

  it('shows the welcome screen when signed out', () => {
    const html = renderToString(<AppView {...viewProps({ status: 'signedOut', player: null })} />);
    expect(html).toContain('data-testid="welcome-screen"');
    expect(html).toContain('data-testid="welcome-play"');
    expect(html).not.toContain('data-testid="tab-bar"');
  });

  it('asks for a username during onboarding', () => {
    const html = renderToString(
      <AppView {...viewProps({ status: 'onboarding', player: fakePlayer({ username: null }) })} />,
    );
    expect(html).toContain('data-testid="username-screen"');
    expect(html).toContain('data-testid="username-input"');
    expect(html).not.toContain('data-testid="tab-bar"');
  });

  it('shows the menu with stat bar and tab bar when ready', () => {
    const html = renderToString(<AppView {...viewProps()} />);
    expect(html).toContain('data-testid="stat-bar"');
    expect(html).toContain('data-testid="tab-bar"');
    expect(html).toContain('data-testid="play-button"');
  });

  it('has no menu during the battle', () => {
    const html = renderToString(<AppView {...viewProps({ screen: 'battle' })} />);
    expect(html).not.toContain('data-testid="tab-bar"');
    expect(html).not.toContain('data-testid="stat-bar"');
    expect(html).not.toContain('data-testid="play-button"');
  });
});

describe('menu tabs', () => {
  it('has three pages Deck | Kampf | Profil, only the active one reachable', () => {
    const html = renderToString(<AppView {...viewProps()} />);
    const at = (id: string): number => html.indexOf(`data-testid="${id}"`);
    expect(at('page-deck')).toBeGreaterThan(-1);
    expect(at('page-deck')).toBeLessThan(at('page-battle'));
    expect(at('page-battle')).toBeLessThan(at('page-profile'));
    expect(at('tab-deck')).toBeLessThan(at('tab-battle'));
    expect(at('tab-battle')).toBeLessThan(at('tab-profile'));
    expect(html).toMatch(/<div class="pager__page"[^>]*data-testid="page-deck"[^>]*inert/);
    expect(html).toMatch(/<div class="pager__page"[^>]*data-testid="page-profile"[^>]*inert/);
    expect(html).not.toMatch(/<div class="pager__page"[^>]*data-testid="page-battle"[^>]*inert/);
  });

  it('marks the active tab with aria-current', () => {
    for (const tab of ['deck', 'battle', 'profile'] as const) {
      const html = renderToString(<AppView {...viewProps({ tab })} />);
      expect(html).toMatch(
        new RegExp(
          `data-testid="tab-${tab}"[^>]*aria-current="page"|aria-current="page"[^>]*data-testid="tab-${tab}"`,
        ),
      );
      expect(html).toContain(`data-tab="${tab}"`);
    }
  });

  it('shows the profile on the profile tab', () => {
    const html = renderToString(<AppView {...viewProps({ tab: 'profile' })} />);
    expect(html).toContain('data-testid="profile-screen"');
  });

  it('shows the deck and levels of the player on the battle tab', () => {
    const html = renderToString(<AppView {...viewProps()} />);
    expect(html).toContain('Level 3');
    expect(html).toContain('Ritter');
  });

  it('shows name, Elo, gold and jokers in the stat bar', () => {
    const html = renderToString(
      <AppView {...viewProps({ player: fakePlayer({ elo: 1234, gold: 56, jokers: 9 }) })} />,
    );
    expect(html).toMatch(/data-testid="stat-name">Anna</);
    expect(html).toMatch(/data-testid="stat-elo"[^>]*>.*?<span class="stat-bar__value">1234</);
    expect(html).toMatch(/data-testid="stat-gold"[^>]*>.*?<span class="stat-bar__value">56</);
    expect(html).toMatch(/data-testid="stat-jokers"[^>]*>.*?<span class="stat-bar__value">9</);
  });
});

describe('App container', () => {
  beforeEach(() => {
    setBackendForTests(fakeBackend());
    resetAccountStoreForTests();
  });
  afterEach(() => {
    setBackendForTests(null);
    resetAccountStoreForTests();
    useGameStore.setState({ screen: 'menu', tab: 'battle' });
  });

  // Server rendering always shows the initial store state, so the other statuses are covered
  // through AppView above.
  it('starts with the loading screen', () => {
    expect(renderToString(<App />)).toContain('data-testid="loading-screen"');
  });
});
