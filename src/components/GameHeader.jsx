import { useRef } from 'react';
import { useData } from '../data.jsx';
import { favoriteRank, useFavorites } from '../favorites.js';
import { TeamLogo, useUi } from './ui.jsx';

/** Back button plus a swipeable strip of the other games on the slate. */
const ORDER = { in: 0, pre: 1, post: 2 };
/** Slate order used by the switcher and swipes: live, then upcoming, then final; favorites first within each. */
export function useSlate(sport) {
  const { board } = useData();
  const [favs] = useFavorites(sport);
  return [...board.games].sort((a, b) => ORDER[a.state] - ORDER[b.state] || favoriteRank(b, favs) - favoriteRank(a, favs) || new Date(a.date) - new Date(b.date));
}

/** Swipe left/right anywhere on the game to move to the next/previous game. */
export function useSwipeGames(currentId, sport) {
  const games = useSlate(sport);
  const start = useRef(null);
  const go = (dir) => {
    const i = games.findIndex((g) => g.id === currentId);
    const next = games[i + dir];
    if (i >= 0 && next) window.location.hash = `/${sport === 'nba' ? 'nba/' : ''}game?id=${next.id}`;
  };
  return {
    onTouchStart: (e) => {
      const t = e.touches[0];
      // Ignore swipes that start in horizontally scrolling strips (game switcher, tables, filters).
      start.current = e.target.closest('.gsw-strip, .table-wrap, .lf-filters, .seg, .field-wrap, [data-noswipe]') ? null : { x: t.clientX, y: t.clientY, t: Date.now() };
    },
    onTouchEnd: (e) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 90 && Math.abs(dx) > 2.2 * Math.abs(dy) && Date.now() - s.t < 600) go(dx < 0 ? 1 : -1);
    },
  };
}

export function GameSwitcher({ currentId, sport, back }) {
  const games = useSlate(sport);
  const href = (id) => `#/${sport === 'nba' ? 'nba/' : ''}game?id=${id}`;
  return (
    <div className="gsw">
      <a className="gsw-back" href={back} aria-label="Back">‹</a>
      <div className="gsw-strip">
        {games.map((g) => (
          <a key={g.id} href={href(g.id)} className={`gsw-item ${g.id === currentId ? 'on' : ''}`}>
            <small>{g.state === 'in' && <span className="live-dot" />}{g.state === 'pre' ? new Date(g.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : g.detail}</small>
            <span>
              <TeamLogo abbr={g.away.abbr} size={16} eager />
              {g.state === 'pre' ? ` ${g.away.abbr} @ ${g.home.abbr} ` : ` ${g.away.score}-${g.home.score} `}
              <TeamLogo abbr={g.home.abbr} size={16} eager />
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Flat scoreboard on black: logo, big score, team; clock and win odds in the middle. */
export function FlatScore({ game, wp, sport }) {
  const { teams } = useData();
  const [favs, toggle] = useFavorites(sport);
  const { openTeam } = useUi();
  const name = (t) => teams?.[t.abbr]?.short || t.short || t.abbr;
  return (
    <div className="fsb">
      {[game.away, game.home].map((t, idx) => (
        <button key={t.abbr} type="button" className={`fsb-team ${idx ? 'home' : 'away'} ${game.state === 'post' && !t.winner ? 'lost' : ''}`} onClick={() => openTeam(t.abbr)}>
          <TeamLogo abbr={t.abbr} size={44} />
          <span className="fsb-num">
            <strong>{game.state === 'pre' ? (t.record || '–') : t.score}</strong>
            <small>
              {name(t)}
              <span role="button" tabIndex={0} className={`fav-star ${favs.has(t.abbr) ? 'on' : ''}`} aria-label={favs.has(t.abbr) ? `Unfavorite ${t.abbr}` : `Favorite ${t.abbr}`} onClick={(e) => { e.stopPropagation(); toggle(t.abbr); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggle(t.abbr); } }}>{favs.has(t.abbr) ? '★' : '☆'}</span>
            </small>
          </span>
        </button>
      ))}
      <div className="fsb-mid">
        <strong className={game.state === 'in' ? 'live' : ''}>{game.state === 'in' && <span className="live-dot" />}{game.state === 'pre' ? new Date(game.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : game.shortDetail}</strong>
        {wp != null && <small>{wp >= 0.5 ? game.home.abbr : game.away.abbr} {Math.round(Math.max(wp, 1 - wp) * 100)}% to win</small>}
        {game.line?.details && <small>{game.line.details}</small>}
      </div>
    </div>
  );
}
