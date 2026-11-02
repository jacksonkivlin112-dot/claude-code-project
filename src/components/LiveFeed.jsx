import { useEffect, useMemo, useRef, useState } from 'react';
import { keyStat, statLine, summarize } from '../liveFeed.js';
import { Segmented, TeamLogo } from './ui.jsx';

export const Q = (p) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
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

/** One play: big photo, one-line summary, the key stat large on the right. */
export function PlayCard({ item: i, game, color, sport, fresh, open, onToggle, gameTag }) {
  const tc = i.team === game.home.abbr ? color(game.home) : i.team === game.away.abbr ? color(game.away) : 'var(--accent)';
  const lead = i.actors[0];
  const second = i.actors[1];
  const swing = i.wpDelta != null && Math.abs(i.wpDelta) >= 0.03 ? i.wpDelta : null;
  const swingTeam = swing != null ? (swing > 0 ? game.home.abbr : game.away.abbr) : null;
  const ks = keyStat(i, sport);
  const extraTags = i.tags.slice(i.big ? 1 : 0).filter((t) => t.label !== 'MOMENTUM' || !i.big);
  return (
    <article className={`lf-card ${i.big ? 'big' : ''} ${i.scored ? 'scored' : ''} ${fresh ? 'new' : ''}`} style={{ '--tc': tc }}>
      {i.big && i.tags[0] && <div className={`lf-banner tone-${i.tags[0].tone}`}>{i.tags[0].label}</div>}
      <button type="button" className="lf-row" onClick={onToggle} aria-expanded={open}>
        <span className="lf-faces">
          {lead ? <Headshot a={lead} size={i.big ? 76 : 58} ring={tc} /> : <span className="lf-teamface"><TeamLogo abbr={i.team} size={i.big ? 52 : 40} /></span>}
          {second && <Headshot a={second} size={i.big ? 40 : 32} ring={tc} />}
        </span>
        <span className="lf-body">
          {gameTag}
          <strong className="lf-sum">{summarize(i, sport)}</strong>
          <span className="lf-time"><TeamLogo abbr={i.team} size={14} /> {Q(i.period)} {i.clock}{i.dd ? ` · ${i.dd}` : ''}</span>
          {(i.big || i.scored) && lead && statLine(lead, sport) && <span className="lf-line">{lead.name.split(' ').slice(-1)[0]}: {statLine(lead, sport)}</span>}
          {(extraTags.length > 0 || swing != null) && (
            <span className="lf-chips">
              {extraTags.map((t) => <span key={t.label} className={`tag tone-${t.tone}`}>{t.label}</span>)}
              {swing != null && <span className={`lf-swing ${Math.abs(swing) >= 0.08 ? 'hot' : ''}`} title="Change in win probability on this play">{swing > 0 ? '▲' : '▼'} {Math.abs(Math.round(swing * 100))}% {swingTeam}</span>}
            </span>
          )}
        </span>
        {i.scored ? (
          <span className="lf-key score">
            <span>{game.away.abbr} <b>{i.awayScore}</b></span>
            <span>{game.home.abbr} <b>{i.homeScore}</b></span>
          </span>
        ) : ks ? (
          <span className={`lf-key ${String(ks.value).startsWith('-') ? 'neg' : ''}`}><b>{ks.value}</b>{ks.label && <small>{ks.label}</small>}</span>
        ) : null}
      </button>
      {open && <p className="lf-text">{i.text}</p>}
    </article>
  );
}

/** Real-time play feed for one game: filters, new-play detection, paging. */
export default function LiveFeed({ feed, game, color, sport }) {
  const [filter, setFilter] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [fresh, setFresh] = useState(new Set());
  const [pending, setPending] = useState(0);
  const seen = useRef(new Set());
  const topRef = useRef();
  const [scrolledAway, setScrolledAway] = useState(false);
  const [openId, setOpenId] = useState(null);

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

  let lastPeriod = null;
  return (
    <div className="lf">
      <div className="lf-filters" ref={topRef}>
        <Segmented size="sm" label="Feed filter" value={filter} onChange={(v) => { setFilter(v); setLimit(PAGE); }} options={[{ value: 'ALL', label: 'All plays' }, { value: 'BIG', label: 'Big plays' }, { value: 'SCORE', label: 'Scoring' }]} />
        <Segmented size="sm" label="Team" value={team} onChange={(v) => { setTeam(v); setLimit(PAGE); }} options={[{ value: 'ALL', label: 'Both' }, { value: game.away.abbr, label: game.away.abbr }, { value: game.home.abbr, label: game.home.abbr }]} />
      </div>
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
            return [header, (
              <li key={i.id}>
                <PlayCard item={i} game={game} color={color} sport={sport} fresh={fresh.has(i.id)} open={openId === i.id} onToggle={() => setOpenId(openId === i.id ? null : i.id)} />
              </li>
            )];
          })}
        </ol>
      )}
      {items.length > limit && <button type="button" className="more-btn card" onClick={() => setLimit((l) => l + PAGE)}>Load earlier plays · {items.length - limit} more</button>}
    </div>
  );
}
