import type { CardId } from '@rumble-realms/engine';
import { useEffect, useState, type ReactElement } from 'react';
import { getFigureImage } from '../render/figureImages.ts';
import type { Team } from '../render/figures.ts';

/** Figure of a unit as an image; an empty placeholder while loading or without WebGL. */
export function FigureImage({
  card,
  team = 'own',
  className = '',
}: {
  card: CardId;
  team?: Team;
  className?: string;
}): ReactElement {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    void getFigureImage(card, team).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [card, team]);
  return src ? (
    <img className={`figure ${className}`} src={src} alt="" draggable={false} />
  ) : (
    <span className={`figure figure--placeholder ${className}`} aria-hidden="true" />
  );
}
