import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/lilita-one/400.css';
import '@fontsource-variable/nunito/index.css';
import './styles.css';
import './ui/base.css';
import './ui/title.css';
import './ui/menu.css';
import './ui/cards.css';
import './ui/battle.css';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Development harnesses, e.g. /?harness=figures or /?harness=canvas (never linked in the app).
const harness = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('harness')
  : null;

if (harness !== null) {
  void import('./render/dev/harness.tsx').then((m) => m.mountHarness(root, harness));
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
