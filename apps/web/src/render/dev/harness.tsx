/** Development-only pages for looking at parts of the renderer in isolation. */
export function mountHarness(root: HTMLElement, name: string): void {
  switch (name) {
    case 'figures':
      void import('./figuresHarness.ts').then((m) => m.mountFiguresHarness(root));
      return;
    default:
      root.textContent = `Unknown harness: ${name}`;
  }
}
