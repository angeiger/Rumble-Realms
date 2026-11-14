import { ENGINE_VERSION } from '@rumble-realms/engine';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the title and the engine version', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Rumble Realms');
    expect(html).toContain(`Engine v${ENGINE_VERSION}`);
  });
});
