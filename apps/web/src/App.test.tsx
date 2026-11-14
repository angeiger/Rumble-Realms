import { ENGINE_VERSION } from '@rumble-realms/engine';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the title screen with play button and engine version', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Rumble Realms');
    expect(html).toContain('data-testid="play-button"');
    expect(html).toContain('Spielen');
    expect(html).toContain(`Engine v${ENGINE_VERSION}`);
    expect(html).toContain('Prototyp: Kampf gegen einen Bot');
  });
});
