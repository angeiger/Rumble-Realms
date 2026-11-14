import { START_LIVES } from '@rumble-realms/engine';
import type { ReactElement } from 'react';
import { HeartShape } from './icons.tsx';

export interface HeartsProps {
  lives: number;
  /** True if the heart that was just lost (index `lives`) should visibly break. */
  breaking?: boolean;
  size?: number;
  max?: number;
  testId: string;
  label: string;
}

/** Lives as hearts; lost hearts are empty. */
export function Hearts({
  lives,
  breaking = false,
  size = 20,
  max = START_LIVES,
  testId,
  label,
}: HeartsProps): ReactElement {
  return (
    <div className="hearts" data-testid={testId} data-lives={lives} role="img" aria-label={label}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className="heart" style={{ width: size, height: size }}>
          <HeartShape size={size} fill="#2a2f55" />
          {i < lives && (
            <span className="heart__full">
              <HeartShape size={size} fill="#ff4a5a" />
            </span>
          )}
          {breaking && i === lives && (
            <span className="heart__full heart__full--breaking">
              <HeartShape size={size} fill="#ff4a5a" />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
