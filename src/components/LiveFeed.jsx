import { useEffect, useMemo, useRef, useState } from 'react';
import { summarize } from '../liveFeed.js';
import { Segmented, TeamLogo } from './ui.jsx';
import { usePlayerOpener } from './playerLink.js';

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
/** Small result marker on the photo: made / missed / turnover. */
function outcome(i, sport) {
  if (i.scored) return { cls: 'made', sym: '✓' };
  if (i.tags.some((t) => /TURNOVER|INTERCEPTION/.test(t.label)) || /turnover/i.test(i.type)) return { cls: 'to', sym: '↺' };
  if (sport === 'nba' && /misses/i.test(i.text)) return { cls: 'miss', sym: '✕' };
  if (sport === 'nfl' && /incomplete/i.test(i.text)) return { cls: 'miss', sym: '✕' };
  if (/field goal/i.test(i.type) && /no good|missed|blocked/i.test(i.type + i.text)) return { cls: 'miss', sym: '✕' };
  return null;
}

/** One play as a flat, full-width row: score/clock, play line, running stats. */
export function PlayCard({ item: i, game, color, sport, fresh, open, onToggle, gameTag }) {
  const tc = i.team === game.home.abbr ? color(game.home) : i.team === game.away.abbr ? color(game.away) : 'var(--accent)';
  // Photo follows the headline player (the receiver on a catch, not the passer).
  const lead = (i.after?.[0] && i.actors.find((a) => String(a.id) === String(i.after[0].id))) || i.actors[0];
  const swing = i.wpDelta != null && Math.abs(i.wpDelta) >= 0.03 ? i.wpDelta : null;
  const swingTeam = swing != null ? (swing > 0 ? game.home.abbr : game.away.abbr) : null;
  const extraTags = i.tags.slice(i.big ? 1 : 0).filter((t) => t.label !== 'MOMENTUM' && t.label !== 'FLAG');
  const oc = outcome(i, sport);
  const label = i.big && i.tags[0] ? i.tags[0] : null;
  const openPlayer = usePlayerOpener();
  const tapPlayer = (e) => { if (lead && openPlayer(lead.name, i.team)) e.stopPropagation(); };
  return (
    <article className={`lf-card ${i.big ? 'big' : ''} ${fresh ? 'new' : ''}`} style={{ '--tc': tc }}>
      <button type="button" className="lf-row" onClick={onToggle} aria-expanded={open}>
        <span className="lf-faces" onClick={tapPlayer} title={lead ? `${lead.name}: season stats` : undefined}>
          {lead ? <Headshot a={lead} size={58} ring={tc} /> : <span className="lf-teamface">{i.team ? <TeamLogo abbr={i.team} size={40} /> : <span className="lf-glyph" aria-hidden>{sport === 'nba' ? '◷' : '⚑'}</span>}</span>}
          {lead && i.team && <span className="lf-tbadge"><TeamLogo abbr={i.team} size={18} /></span>}
          {oc && <span className={`lf-oc ${oc.cls}`}>{oc.sym}</span>}
        </span>
        <span className="lf-body">
          <span className="lf-meta">
            {gameTag || (
              <span className="lf-sc">
                <TeamLogo abbr={game.away.abbr} size={14} /> {i.awayScore ?? '–'}-{i.homeScore ?? '–'} <TeamLogo abbr={game.home.abbr} size={14} />
              </span>
            )}
            <span>{Q(i.period)} {i.clock}{i.dd ? ` · ${i.dd}` : ''}</span>
          </span>
          {label && <span className={`lf-label tone-${label.tone}`}>{label.label}</span>}
          <strong className="lf-sum">{summarize(i, sport)}</strong>
          {i.after?.length > 0 && (
            <span className="lf-after">
              {i.after.map((x) => <span key={x.name}><b>{x.name}</b> · {x.line}</span>)}
            </span>
          )}
          {extraTags.length > 0 && <span className="lf-chips">{extraTags.map((t) => <span key={t.label} className={`lf-chip tone-${t.tone}`}>{t.label}</span>)}</span>}
        </span>
        {swing != null && (
          <span className={`lf-wp ${swing > 0 ? 'home' : 'away'}`} title="Change in win probability on this play">
            {swing > 0 ? '▲' : '▼'} {Math.abs(Math.round(swing * 100))}%<small>{swingTeam}</small>
          </span>
        )}
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
