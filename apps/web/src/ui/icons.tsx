/** Small inline icons in the comic style (dark outline, flat colours). */
import type { ReactElement } from 'react';

const STROKE = '#14172e';

interface IconProps {
  size?: number;
}

export function HeartShape({ size = 20, fill }: IconProps & { fill: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21.2C5 15.6 2.2 12.2 2.2 8.4 2.2 5.3 4.5 3.2 7.2 3.2c2 0 3.8 1.1 4.8 2.9 1-1.8 2.8-2.9 4.8-2.9 2.7 0 5 2.1 5 5.2 0 3.8-2.8 7.2-9.8 12.8Z"
        fill={fill}
        stroke={STROKE}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HpIcon({ size = 14 }: IconProps): ReactElement {
  return <HeartShape size={size} fill="#ff5a5a" />;
}

export function DamageIcon({ size = 14 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M13 2 4 13h6l-2 9 11-13h-6.5L13 2Z"
        fill="#ffc83a"
        stroke={STROKE}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HealIcon({ size = 14 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"
        fill="#3fc46a"
        stroke={STROKE}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RangeIcon({ size = 14 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="#8fb8ff" stroke={STROKE} strokeWidth="2.2" />
      <circle cx="12" cy="12" r="3" fill="#fff6d6" stroke={STROKE} strokeWidth="2" />
    </svg>
  );
}

export function ClockIcon({ size = 14 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="#fff6d6" stroke={STROKE} strokeWidth="2.2" />
      <path
        d="M12 6.5V12l3.5 2"
        fill="none"
        stroke={STROKE}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SpeedIcon({ size = 14 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 12h12M10 6l7 6-7 6"
        fill="none"
        stroke={STROKE}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12h12M10 6l7 6-7 6"
        fill="none"
        stroke="#fff6d6"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 5l14 14M19 5 5 19"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InfoIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#fff6d6" stroke={STROKE} strokeWidth="2.4" />
      <circle cx="12" cy="7.2" r="1.9" fill={STROKE} />
      <path d="M12 11v6.5" stroke={STROKE} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SwordsIcon({ size = 26 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 3h5l11 11-2.5 2.5L6.5 5.5 4 3Zm16 0h-5L9 9l2.5 2.5L20 3ZM5 19l3 3 3-3-3-3-3 3Zm8.5-3.5 3 3 3-3-3-3-3 3Z"
        fill="currentColor"
        stroke={STROKE}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CardsIcon({ size = 26 }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="2.5"
        y="5"
        width="11"
        height="15"
        rx="2.4"
        transform="rotate(-10 8 12)"
        fill="currentColor"
        stroke={STROKE}
        strokeWidth="1.8"
      />
      <rect
        x="10"
        y="4"
        width="11"
        height="15"
        rx="2.4"
        transform="rotate(8 15.5 11.5)"
        fill="currentColor"
        stroke={STROKE}
        strokeWidth="1.8"
      />
    </svg>
  );
}
