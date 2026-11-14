import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';
import type { Tab } from '../game/store.ts';
import { TAB_ORDER } from './TabBar.tsx';

export interface TabPagerProps {
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** One page per tab; the pages lie side by side in the order of `TAB_ORDER`. */
  pages: Record<Tab, ReactNode>;
}

/** Time after which a programmatic scroll counts as finished even without a `scrollend` event. */
const PROGRAMMATIC_MAX_MS = 700;
/** Pause after the last scroll event that counts as "the swipe came to rest" (no `scrollend`). */
const SETTLE_MS = 110;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * The menu pages side by side in a horizontal scroll-snap container: swiping moves between
 * them with native inertia, the tab bar follows. Tapping a tab scrolls over smoothly.
 * Only the page of the active tab takes part in focus and taps (`inert` for the other).
 */
export function TabPager({ tab, onTab, pages }: TabPagerProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const tabRef = useRef(tab);
  const onTabRef = useRef(onTab);
  useLayoutEffect(() => {
    tabRef.current = tab;
    onTabRef.current = onTab;
  });
  const programmatic = useRef(false);
  const timers = useRef<{ settle: number | null; program: number | null }>({
    settle: null,
    program: null,
  });
  const placed = useRef(false);
  const index = TAB_ORDER.indexOf(tab);

  // Tab changed (tap or first render): bring the matching page into view.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const target = index * el.clientWidth;
    if (!placed.current) {
      placed.current = true;
      el.scrollLeft = target;
      return;
    }
    if (Math.abs(el.scrollLeft - target) < 2) return; // the swipe already got there
    programmatic.current = true;
    if (timers.current.program !== null) window.clearTimeout(timers.current.program);
    timers.current.program = window.setTimeout(() => {
      programmatic.current = false;
    }, PROGRAMMATIC_MAX_MS);
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else {
      el.scrollLeft = target;
    }
  }, [index]);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const t = timers.current;
    const settle = (): void => {
      t.settle = null;
      if (programmatic.current || el.clientWidth === 0) return;
      const next = TAB_ORDER[Math.round(el.scrollLeft / el.clientWidth)];
      if (next !== undefined && next !== tabRef.current) onTabRef.current(next);
    };
    const onScroll = (): void => {
      if (programmatic.current) return;
      if (t.settle !== null) window.clearTimeout(t.settle);
      t.settle = window.setTimeout(settle, SETTLE_MS);
    };
    const onScrollEnd = (): void => {
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      if (t.settle !== null) window.clearTimeout(t.settle);
      settle();
    };
    // Keep the page in view when the width changes (rotation, window resize).
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            el.scrollLeft = TAB_ORDER.indexOf(tabRef.current) * el.clientWidth;
          });
    resizeObserver?.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', onScrollEnd);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onScrollEnd);
      resizeObserver?.disconnect();
      if (t.settle !== null) window.clearTimeout(t.settle);
      if (t.program !== null) window.clearTimeout(t.program);
    };
  }, []);

  return (
    <div className="pager" ref={ref} data-testid="tab-pager" data-tab={tab}>
      {TAB_ORDER.map((id) => (
        <div
          className="pager__page"
          key={id}
          data-testid={`page-${id}`}
          inert={id !== tab}
          aria-hidden={id !== tab}
        >
          {pages[id]}
        </div>
      ))}
    </div>
  );
}
