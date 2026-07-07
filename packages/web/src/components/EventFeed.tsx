import { useEffect, useRef } from 'react';
import { describeEvent } from '@labyrinthium/shared';
import { useGameStore } from '../state/gameStore.js';

/** What the game master tells you (and what everyone overhears). */
export function EventFeed(): JSX.Element {
  const feed = useGameStore((s) => s.feed);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feed.length]);

  return (
    <div className="event-feed" data-testid="event-feed">
      <h3>Game master says</h3>
      <div className="feed-scroll">
        {feed.map((entry) => (
          <div
            key={entry.seq}
            className={entry.isPublic ? 'feed-public' : entry.ownerName ? 'feed-foreign' : 'feed-private'}
          >
            <span className="feed-turn">t{entry.turn}</span>{' '}
            {entry.ownerName && <span className="feed-owner">{entry.ownerName} ▸</span>}{' '}
            {describeEvent(entry.event)}
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}
