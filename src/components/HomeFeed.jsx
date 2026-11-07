import { useEffect, useMemo, useRef, useState } from 'react';
import { getGameSummary } from '../api.js';
import { sportPath, useData } from '../data.jsx';
import { parseSummary } from '../gamecast.js';
import { buildFeed } from '../liveFeed.js';
import { getNbaSummary } from '../nba/api.js';
import { parseNbaSummary } from '../nba/gamecast.js';
import { PlayCard } from './LiveFeed.jsx';
import { favoriteRank, useFavorites } from '../favorites.js';
import { TeamLogo, kickoff } from './ui.jsx';

const lum = (hex = '#000000') => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
const POLL_MS = 40000;
const MAX_GAMES = 8;

const SOURCES = {
  nfl: { get: getGameSummary, parse: parseSummary, href: (id) => `#/game?id=${id}` },
  nba: { get: getNbaSummary, parse: parseNbaSummary, href: (id) => `#/nba/game?id=${id}` },
};

/**
 * Home feed: swipeable game cards, then the biggest plays from every live game
 * (or today's finished games when nothing is live), newest first.
 */
export default function HomeFeed({ sport, rail = true }) {
  const { board, teams, api, sport: league } = useData();
  // Football leagues share the NFL parser; the feed and links follow the active league.
  const src = sport === 'nfl' ? { ...SOURCES.nfl, get: api?.getGameSummary || SOURCES.nfl.get, href: (id) => `#/${sportPath(league)}game?id=${id}` } : SOURCES[sport];
  const [plays, setPlays] = useState(null); // null = loading, [] = none
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(12);
  const [openId, setOpenId] = useState(null);
  const seen = useRef(new Set());
  const [fresh, setFresh] = useState(new Set());

  const color = (t) => {
    const tm = teams?.[t.abbr] || {};
    const c = t.color || tm.color || '#475569';
    const a = t.alt || tm.alt;
    return lum(c) < 0.16 && a && lum(a) > lum(c) && lum(a) < 0.92 ? a : c;
  };

  const [favs] = useFavorites(sport);
  const games = useMemo(() => {
    const order = { in: 0, pre: 1, post: 2 };
    return [...board.games].sort((a, b) => order[a.state] - order[b.state] || favoriteRank(b, favs) - favoriteRank(a, favs) || (a.state === 'post' ? new Date(b.date) - new Date(a.date) : new Date(a.date) - new Date(b.date)));
  }, [board.games, favs]);
  const live = games.filter((g) => g.state === 'in');
  const targets = (live.length ? live : games.filter((g) => g.state === 'post').slice(0, 4)).slice(0, MAX_GAMES);
  const targetKey = targets.map((g) => g.id).join(',');

  useEffect(() => {
    if (!targets.length) { setPlays([]); return undefined; }
    let alive = true;
    let timer;
    const load = async () => {
      const results = await Promise.allSettled(targets.map(async (g) => {
        const raw = await src.get(g.id);
        const game = src.parse(raw);
        const { items } = buildFeed(game, raw, sport);
        return items.filter((i) => i.big).slice(0, 12).map((i) => ({ ...i, key: `${g.id}:${i.id}`, game }));
      }));
      if (!alive) return;
      const ok = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
      setFailed(ok.length === 0 && results.some((r) => r.status === 'rejected'));
      ok.sort((a, b) => (b.wallclock && a.wallclock ? new Date(b.wallclock) - new Date(a.wallclock) : 0));
      const keys = ok.map((i) => i.key);
      if (seen.current.size) {
        const n = keys.filter((k) => !seen.current.has(k));
        if (n.length) { setFresh(new Set(n)); setTimeout(() => setFresh(new Set()), 5000); }
      }
      seen.current = new Set(keys);
      setPlays(ok);
      if (live.length) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [targetKey, sport]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!games.length) return null;

  return (
    <section className="hf">
      {rail && <div className="hf-rail" role="list" aria-label="Games">
        {games.map((g) => {
          const pHome = g.liveHomeWp;
          return (
            <a key={g.id} role="listitem" href={src.href(g.id)} className={`hf-game ${g.state}`} style={{ '--ac': color(g.away), '--hc': color(g.home) }}>
              <span className="hf-status">
                {g.state === 'in' ? <><span className="live-dot" /> {g.detail}</> : g.state === 'post' ? g.detail : kickoff(g.date)}
                {g.tv && <span className="muted"> · {g.tv.split(',')[0]}</span>}
              </span>
              <span className="hf-teams">
                {[g.away, g.home].map((t) => (
                  <span key={t.abbr} className={`hf-team ${g.state === 'post' && !t.winner ? 'lost' : ''}`}>
                    <TeamLogo abbr={t.abbr} size={46} />
                    <b>{t.abbr}</b>
                    <strong>{g.state === 'pre' ? '' : t.score}</strong>
                    <small>{t.record}</small>
                  </span>
                ))}
              </span>
              {g.state === 'in' && pHome != null && (
                <span className="hf-wp"><span style={{ width: `${(1 - pHome) * 100}%`, background: 'var(--ac)' }} /><span style={{ width: `${pHome * 100}%`, background: 'var(--hc)' }} /></span>
              )}
              {g.state === 'in' && g.downDistance && <span className="hf-dd">{g.redZone && <b>RZ </b>}{g.downDistance}</span>}
              <span className="hf-cta">{g.state === 'in' ? 'Live feed →' : g.state === 'post' ? 'Recap →' : 'Preview →'}</span>
            </a>
          );
        })}
      </div>}

      <div className="hf-head">
        <h2>{live.length ? 'Biggest plays right now' : 'Biggest plays today'}</h2>
        <span className="muted small">{live.length ? `${live.length} live game${live.length === 1 ? '' : 's'} · updates automatically` : targets.length ? `From the ${targets.length} most recent finals` : ''}</span>
      </div>
      {plays === null ? (
        <div className="hf-empty muted">Loading plays…</div>
      ) : plays.length === 0 ? (
        <div className="hf-empty muted">{failed ? 'Live plays couldn’t load in this browser. Open any game above for its feed.' : targets.length ? 'No big plays yet. Check back soon.' : 'No games have started yet. Big plays appear here once they tip off or kick off.'}</div>
      ) : (
        <>
          <ol className="lf-list">
            {plays.slice(0, limit).map((i) => (
              <li key={i.key}>
                <PlayCard
                  item={i}
                  game={i.game}
                  color={color}
                  sport={sport}
                  fresh={fresh.has(i.key)}
                  open={openId === i.key}
                  onToggle={() => setOpenId(openId === i.key ? null : i.key)}
                  gameTag={(
                    <span className="hf-tag" role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); window.location.hash = src.href(i.game.id).slice(1); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); window.location.hash = src.href(i.game.id).slice(1); } }}>
                      <TeamLogo abbr={i.game.away.abbr} size={14} /> {i.game.away.abbr} {i.awayScore ?? i.game.away.score} – {i.homeScore ?? i.game.home.score} {i.game.home.abbr} <TeamLogo abbr={i.game.home.abbr} size={14} />
                    </span>
                  )}
                />
              </li>
            ))}
          </ol>
          {plays.length > limit && <button type="button" className="more-btn card" onClick={() => setLimit((l) => l + 12)}>More big plays · {plays.length - limit} remaining</button>}
        </>
      )}
    </section>
  );
}
