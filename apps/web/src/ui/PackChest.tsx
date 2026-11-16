import type { ReactElement } from 'react';

const STROKE = 'var(--outline)';

/** A simple treasure chest in the comic style; `open` lifts the lid and shows the glow. */
export function PackChest({
  open = false,
  size = 140,
}: {
  open?: boolean;
  size?: number;
}): ReactElement {
  return (
    <svg
      className={`chest${open ? ' chest--open' : ''}`}
      width={size}
      height={(size * 100) / 120}
      viewBox="0 0 120 100"
      aria-hidden="true"
      data-testid="pack-chest"
      data-open={open}
    >
      {open && <ellipse cx="60" cy="46" rx="40" ry="16" fill="#fff1b8" opacity="0.9" />}
      <rect
        x="10"
        y="46"
        width="100"
        height="46"
        rx="8"
        fill="#9b5b2b"
        stroke={STROKE}
        strokeWidth="4"
      />
      <rect x="10" y="62" width="100" height="8" fill="#7a4520" stroke={STROKE} strokeWidth="3" />
      <rect x="26" y="46" width="12" height="46" fill="#ffc83a" stroke={STROKE} strokeWidth="3" />
      <rect x="82" y="46" width="12" height="46" fill="#ffc83a" stroke={STROKE} strokeWidth="3" />
      <g className="chest__lid" style={{ transformOrigin: '12px 46px' }}>
        <path
          d="M10 46 V32 a22 22 0 0 1 22 -22 H88 a22 22 0 0 1 22 22 V46 Z"
          fill="#b86f35"
          stroke={STROKE}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <rect x="26" y="10" width="12" height="36" fill="#ffc83a" stroke={STROKE} strokeWidth="3" />
        <rect x="82" y="10" width="12" height="36" fill="#ffc83a" stroke={STROKE} strokeWidth="3" />
      </g>
      <rect
        x="51"
        y="40"
        width="18"
        height="20"
        rx="4"
        fill="#ffd95e"
        stroke={STROKE}
        strokeWidth="3.5"
      />
      <circle cx="60" cy="50" r="3" fill={STROKE} />
    </svg>
  );
}
