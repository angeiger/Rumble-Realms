/** Development-only pages for looking at parts of the renderer in isolation. */
export function mountHarness(root: HTMLElement, name: string): void {
  root.textContent = `Unknown harness: ${name}`;
}
