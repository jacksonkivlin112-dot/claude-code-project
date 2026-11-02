import { useEffect, useMemo, useRef, useState } from 'react';
import { statLine } from '../liveFeed.js';
import { Segmented, TeamLogo } from './ui.jsx';

const Q = (p) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
const PAGE = 40;

function Headshot({ a, size = 40, ring }) {
  const [err, setErr] = useState(false);
  const initials = (a?.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('');
  return (
    <span className="lf-head" style={{ width: size, height: size, '--ring': ring }}>
      {err || !a?.headshot ? <span className="lf-init">{initials}</span> : <img src={a.headshot} alt="" loading="lazy" onError={() => setErr(true)} />}
    </span>
  );
}

/**
 * Real-time play feed: one card per play (newest first), player headshots,
 * score changes, win-probability swing, highlighted big moments.
 */
export default function LiveFeed({ feed, game, color, sport }) {
  const [filter, setFilter] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [fresh, setFresh] = useState(new Set());
  const [pending, setPending] = useState(0);
  const seen = useRef(new Set());
  const topRef = useRef();
  const [scrolledAway, setScrolledAway] = useState(false);

  // Detect plays that arrived since the last refresh.
  useEffect(() => {
    const ids = feed.items.map((i) => i.id);
    if (seen.current.size) {
      const n = ids.filter((x) => !seen.current.has(x));
      if (n.length) {
        setFresh(new Set(n));
        if (scrolledAway) setPending((c) => c + n.length);
        setTimeout(() => setFresh(new Set()), 5000);
      }
    }
    seen.current = new Set(ids);
  }, [feed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = topRef.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => { setScrolledAway(!e.isIntersecting); if (e.isIntersecting) setPending(0); });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const items = useMemo(() => feed.items.filter((i) => {
    if (team !== 'ALL' && i.team !== team) return false;
    if (filter === 'BIG') return i.big;
    if (filter === 'SCORE') return i.scored;
    return !i.quiet;
  }), [feed, filter, team]);

  const teamColor = (abbr) => (abbr === game.home.abbr ? color(game.home) : abbr === game.away.abbr ? color(game.away) : 'var(--accent)');
  const live = game.state === 'in';
  let lastPeriod = null;

  return (
    <div className="lf">
      <div className="lf-sticky">
        <span className="lf-score">
          <TeamLogo abbr={game.away.abbr} size={20} /> <b>{game.away.score ?? 0}</b>
          <span className="lf-clock">{live && <span className="live-dot" />}{game.shortDetail || ''}</span>
          <b>{game.home.score ?? 0}</b> <TeamLogo abbr={game.home.abbr} size={20} />
        </span>
        <span className="lf-tools">
          <Segmented size="sm" label="Feed filter" value={filter} onChange={(v) => { setFilter(v); setLimit(PAGE); }} options={[{ value: 'ALL', label: 'All' }, { value: 'BIG', label: 'Big plays' }, { value: 'SCORE', label: 'Scoring' }]} />
          <Segmented size="sm" label="Team" value={team} onChange={(v) => { setTeam(v); setLimit(PAGE); }} options={[{ value: 'ALL', label: 'Both' }, { value: game.away.abbr, label: game.away.abbr }, { value: game.home.abbr, label: game.home.abbr }]} />
        </span>
      </div>
      <div ref={topRef} />
      {pending > 0 && (
        <button type="button" className="lf-pill" onClick={() => { topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setPending(0); }}>
          ↑ {pending} new play{pending === 1 ? '' : 's'}
        </button>
      )}
      {items.length === 0 ? (
        <p className="muted center lf-empty">{game.state === 'pre' ? 'The feed starts at kickoff.' : 'No plays match this filter yet.'}</p>
      ) : (
        <ol className="lf-list">
          {items.slice(0, limit).map((i) => {
            const header = i.period !== lastPeriod ? <li key={`q${i.period}`} className="lf-period">{Q(i.period)}</li> : null;
            lastPeriod = i.period;
            const tc = teamColor(i.team);
            const lead = i.actors[0];
            const second = i.actors[1];
            const isPass = sport === 'nfl' && /pass/i.test(i.text) && second;
            const swing = i.wpDelta != null && Math.abs(i.wpDelta) >= 0.01 ? i.wpDelta : null;
            const swingTeam = swing != null ? (swing > 0 ? game.home.abbr : game.away.abbr) : null;
            return [header, (
              <li key={i.id} className={`lf-card ${i.big ? 'big' : ''} ${i.scored ? 'scored' : ''} ${fresh.has(i.id) ? 'new' : ''}`} style={{ '--tc': tc }}>
                {i.big && i.tags[0] && <div className={`lf-banner tone-${i.tags[0].tone}`}>{i.tags[0].label}</div>}
                <div className="lf-row">
                  <div className="lf-faces">
                    {lead ? <Headshot a={lead} size={i.big ? 54 : 42} ring={tc} /> : <span className="lf-teamface"><TeamLogo abbr={i.team} size={i.big ? 40 : 30} /></span>}
                    {second && <Headshot a={second} size={i.big ? 34 : 28} ring={tc} />}
                  </div>
                  <div className="lf-body">
                    <div className="lf-who">
                      {lead ? (
                        <strong>{lead.name}{second && <span className="lf-arrow">{isPass ? ' → ' : ' · '}</span>}{second && second.name}</strong>
                      ) : <strong>{i.type || 'Play'}</strong>}
                      <span className="lf-time"><TeamLogo abbr={i.team} size={13} /> {Q(i.period)} {i.clock}</span>
                    </div>
                    {i.dd && <div className="lf-dd">{i.dd}</div>}
                    <p className="lf-text">{sport === 'nba' && lead && i.text.startsWith(lead.name) ? i.text.slice(lead.name.length).trim().replace(/^./, (c) => c.toUpperCase()) : i.text}</p>
                    {(i.big || i.scored) && lead && statLine(lead, sport) && <div className="lf-line">{lead.name.split(' ').slice(-1)[0]}: {statLine(lead, sport)}</div>}
                    <div className="lf-chips">
                      {i.tags.slice(i.big ? 1 : 0).map((t) => <span key={t.label} className={`tag tone-${t.tone}`}>{t.label}</span>)}
                      {i.yards != null && i.yards !== 0 && /rush|pass|reception|sack|scramble/i.test(i.type) && <span className={`yds ${i.yards > 0 ? 'pos' : 'neg'}`}>{i.yards > 0 ? '+' : ''}{i.yards} yds</span>}
                      {swing != null && <span className={`lf-swing ${Math.abs(swing) >= 0.08 ? 'hot' : ''}`} title="Change in win probability on this play">{swing > 0 ? '▲' : '▼'} {Math.abs(Math.round(swing * 100))}% {swingTeam}</span>}
                    </div>
                  </div>
                  {i.scored && (
                    <div className="lf-scorebox">
                      <span>{game.away.abbr} <b>{i.awayScore}</b></span>
                      <span>{game.home.abbr} <b>{i.homeScore}</b></span>
                    </div>
                  )}
                </div>
              </li>
            )];
          })}
        </ol>
      )}
      {items.length > limit && <button type="button" className="more-btn card" onClick={() => setLimit((l) => l + PAGE)}>Load earlier plays · {items.length - limit} more</button>}
    </div>
  );
}
