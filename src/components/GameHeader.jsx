import { useData } from '../data.jsx';
import { TeamLogo, useUi } from './ui.jsx';

/** Back button plus a swipeable strip of the other games on the slate. */
export function GameSwitcher({ currentId, sport, back }) {
  const { board } = useData();
  const order = { in: 0, pre: 1, post: 2 };
  const games = [...board.games].sort((a, b) => order[a.state] - order[b.state] || new Date(a.date) - new Date(b.date));
  const href = (id) => `#/${sport === 'nba' ? 'nba/' : ''}game?id=${id}`;
  return (
    <div className="gsw">
      <a className="gsw-back" href={back} aria-label="Back">‹</a>
      <div className="gsw-strip">
        {games.map((g) => (
          <a key={g.id} href={href(g.id)} className={`gsw-item ${g.id === currentId ? 'on' : ''}`}>
            <small>{g.state === 'in' && <span className="live-dot" />}{g.state === 'pre' ? new Date(g.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : g.detail}</small>
            <span>
              <TeamLogo abbr={g.away.abbr} size={16} />
              {g.state === 'pre' ? ` ${g.away.abbr} @ ${g.home.abbr} ` : ` ${g.away.score}-${g.home.score} `}
              <TeamLogo abbr={g.home.abbr} size={16} />
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Flat scoreboard on black: logo, big score, team; clock and win odds in the middle. */
export function FlatScore({ game, wp }) {
  const { teams } = useData();
  const { openTeam } = useUi();
  const name = (t) => teams?.[t.abbr]?.short || t.short || t.abbr;
  return (
    <div className="fsb">
      {[game.away, game.home].map((t, idx) => (
        <button key={t.abbr} type="button" className={`fsb-team ${idx ? 'home' : 'away'} ${game.state === 'post' && !t.winner ? 'lost' : ''}`} onClick={() => openTeam(t.abbr)}>
          <TeamLogo abbr={t.abbr} size={44} />
          <span className="fsb-num">
            <strong>{game.state === 'pre' ? (t.record || '–') : t.score}</strong>
            <small>{name(t)}</small>
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
