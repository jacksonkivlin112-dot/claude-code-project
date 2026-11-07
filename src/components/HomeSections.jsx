import { useEffect, useMemo, useState } from 'react';
import { getSnapshot } from '../api.js';
import { sportPath, useData } from '../data.jsx';
import { favoriteRank, useFavorites } from '../favorites.js';
import { computeStreaks, injuryReport, topPerformers } from '../insights.js';
import { addDays, etDate } from '../nba/api.js';
import { Avatar, TeamLogo, useUi } from './ui.jsx';

export function SectionHead({ title, more, onMore }) {
  return (
    <div className="hs-head">
      <h2>{title}</h2>
      {more && <button type="button" className="hs-more" onClick={onMore}>{more} <span aria-hidden>›</span></button>}
    </div>
  );
}

const dayLabel = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const monthDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Swipeable strip of game days. NFL shows "W8 · Nov 2 / Mon"; NBA shows dates. */
export function DateStrip({ days, value, onChange }) {
  useEffect(() => {
    document.querySelector(`.ds-day[data-day="${value}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [value]);
  return (
    <div className="ds" role="tablist" aria-label="Game days">
      {days.map((d) => (
        <button key={d.ymd} data-day={d.ymd} type="button" role="tab" aria-selected={d.ymd === value} className={`ds-day ${d.ymd === value ? 'on' : ''}`} onClick={() => onChange(d.ymd)}>
          <small>{d.top}</small>
          <strong>{d.bottom}</strong>
          {d.live && <span className="ds-live" />}
        </button>
      ))}
    </div>
  );
}

/** NFL: all game days in the snapshot, labelled by week. */
export function useNflDays() {
  const { board } = useData();
  const [snap, setSnap] = useState(null);
  const { api } = useData();
  useEffect(() => { (api?.getSnapshot || getSnapshot)().then(setSnap).catch(() => setSnap({ games: [] })); }, [api]);
  return useMemo(() => {
    const byId = new Map(board.games.map((g) => [g.id, g]));
    const games = (snap?.games || board.games).map((g) => byId.get(g.id) || g);
    const map = new Map();
    for (const g of games) {
      const ymd = etDate(g.date);
      if (!map.has(ymd)) map.set(ymd, { ymd, week: g.week, games: [] });
      map.get(ymd).games.push(g);
    }
    const days = [...map.values()].sort((a, b) => (a.ymd < b.ymd ? -1 : 1)).map((d) => ({
      ...d,
      top: `W${d.week} · ${monthDay(d.ymd)}`,
      bottom: dayLabel(d.ymd),
      live: d.games.some((g) => g.state === 'in'),
    }));
    const today = etDate();
    const def = days.find((d) => d.live) || days.find((d) => d.ymd >= today && d.games.some((g) => g.state !== 'post')) || days[days.length - 1];
    return { days, defaultDay: def?.ymd, ready: !!snap };
  }, [snap, board.games]);
}

/** NBA: the days around the selected slate. */
export function useNbaDays() {
  const { allGames, date } = useData();
  return useMemo(() => {
    if (!date) return [];
    const out = [];
    for (let i = -3; i <= 6; i++) {
      const ymd = addDays(date, i);
      const games = allGames.filter((g) => etDate(g.date) === ymd);
      if (!games.length && i !== 0) continue;
      out.push({ ymd, top: monthDay(ymd), bottom: ymd === etDate() ? 'Today' : dayLabel(ymd), live: games.some((g) => g.state === 'in'), games });
    }
    return out;
  }, [allGames, date]);
}

/** Compact two-row game cards: badge, record, nickname, then time/TV/spread or score. */
export function GamesSection({ games, sport, spreadOf, onStandings }) {
  const { teams } = useData();
  const href = (id) => `#/${sportPath(sport)}game?id=${id}`;
  const order = { in: 0, pre: 1, post: 2 };
  const [favs] = useFavorites(sport);
  const best = (g) => Math.min(g.rank?.home && g.rank.home <= 25 ? g.rank.home : 99, g.rank?.away && g.rank.away <= 25 ? g.rank.away : 99);
  const [showAll, setShowAll] = useState(false);
  const sorted = [...games].sort((a, b) => order[a.state] - order[b.state] || favoriteRank(b, favs) - favoriteRank(a, favs) || best(a) - best(b) || new Date(a.date) - new Date(b.date));
  const CAP = 16;
  const list = showAll ? sorted : sorted.slice(0, CAP);
  return (
    <section className="hs">
      <SectionHead title="Games" more="Standings" onMore={onStandings} />
      {list.length === 0 ? <p className="muted hs-empty">No games on this day.</p> : (
        <div className="gs-grid">
          {list.map((g) => {
            const spread = spreadOf?.(g);
            return (
              <a key={g.id} href={href(g.id)} className={`gs-card ${g.state} ${favoriteRank(g, favs) ? 'fav' : ''}`} style={{ '--ac': teams?.[g.away.abbr]?.color || '#475569', '--hc': teams?.[g.home.abbr]?.color || '#475569' }}>
                <span className="gs-teams">
                  {[g.away, g.home].map((t) => (
                    <span key={t.abbr} className={`gs-team ${g.state === 'post' && !t.winner ? 'lost' : ''}`}>
                      <span className="gs-badge" style={{ '--tc': teams?.[t.abbr]?.color || 'var(--surface-3)' }}><TeamLogo abbr={t.abbr} size={30} /></span>
                      <span className="gs-rec">
                        <strong>{g.state === 'pre' ? t.record || '—' : t.score}</strong>
                        <small>{(() => { const r = g.rank?.[t === g.home ? 'home' : 'away']; return r && r <= 25 ? <span className="gs-rank">#{r}</span> : null; })()}{g.state === 'pre' ? teams?.[t.abbr]?.short || t.abbr : t.record || teams?.[t.abbr]?.short}</small>
                      </span>
                    </span>
                  ))}
                </span>
                <span className="gs-meta">
                  {g.state === 'in' ? <strong className="gs-live"><span className="live-dot" /> {g.detail}</strong>
                    : g.state === 'post' ? <strong>{g.detail}</strong>
                    : <strong>{new Date(g.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</strong>}
                  {g.tv && <span>{g.tv.split(',')[0]}</span>}
                  {g.state === 'pre' && spread && <span>{spread}</span>}
                  {g.state === 'in' && g.downDistance && <span>{g.downDistance}</span>}
                </span>
              </a>
            );
          })}
        </div>
      )}
      {sorted.length > CAP && <button type="button" className="more-btn card" onClick={() => setShowAll((x) => !x)}>{showAll ? 'Show fewer games' : `Show all ${sorted.length} games`}</button>}
    </section>
  );
}

const statusTone = (s) => (s === 'Active' ? 'ok' : s === 'Questionable' ? 'q' : 'out');

export function InjuriesSection({ sport }) {
  const { season } = useData();
  const { openPlayer } = useUi();
  const [n, setN] = useState(5);
  const list = useMemo(() => {
    if (!season?.players?.size) return [];
    const relevant = sport === 'nba'
      ? (p) => (p.fpg || 0) >= 15
      : (p) => p.games > 0 && (p.tot?.pts_ppr || 0) / p.games >= 6 && p.pos !== 'DEF' && p.pos !== 'K';
    return injuryReport(season.players, sport, relevant);
  }, [season, sport]);
  if (!list.length) return null;
  return (
    <section className="hs">
      <SectionHead title="Injuries" more={list.length > n ? 'View more' : null} onMore={() => setN((x) => x + 10)} />
      <ol className="hs-list">
        {list.slice(0, n).map((r) => (
          <li key={r.player.id}>
            <button type="button" className="hs-row" onClick={() => openPlayer(r.player.id)}>
              <Avatar player={r.player} size={52} badge />
              <span className="hs-main">
                <strong>{r.player.name}</strong>
                <span className="hs-sub">
                  {r.from && <><span className={`st-${statusTone(r.from)}`}>{r.from}</span> <span className="hs-arrow">→</span> </>}
                  <span className={`st-${statusTone(r.to)}`}>{r.to}</span>
                  {r.part && r.to !== 'Active' && <span className={`st-${statusTone(r.to)}`}> · {r.part}</span>}
                </span>
              </span>
              <span className="hs-side">{r.player.pos} · {r.player.team}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StreaksSection({ sport }) {
  const { season } = useData();
  const { openPlayer } = useUi();
  const [n, setN] = useState(5);
  const list = useMemo(() => (season?.players?.size ? computeStreaks(season.players, sport) : []), [season, sport]);
  if (!list.length) return null;
  return (
    <section className="hs">
      <SectionHead title="Streaks" more={list.length > n ? 'View more' : null} onMore={() => setN((x) => x + 10)} />
      <ol className="hs-list">
        {list.slice(0, n).map((r) => (
          <li key={r.player.id}>
            <button type="button" className="hs-row" onClick={() => openPlayer(r.player.id)}>
              <Avatar player={r.player} size={52} badge />
              <span className="hs-main">
                <strong>{r.player.name}</strong>
                <span className="hs-sub">{r.text} <span aria-hidden>🔥</span></span>
              </span>
              <span className="hs-side hs-n">{r.n}<small>games</small></span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Floating pill above the bottom bar that cycles through the best recent stat lines. */
export function PerformerPill({ sport }) {
  const { season } = useData();
  const { openPlayer } = useUi();
  const rows = useMemo(() => (season?.players?.size ? topPerformers(season.players, sport) : []), [season, sport]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (rows.length < 2) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % rows.length), 4500);
    return () => clearInterval(t);
  }, [rows.length]);
  if (!rows.length) return null;
  const r = rows[i % rows.length];
  const name = r.player.name.split(' ');
  return (
    <button type="button" className="perf-pill" onClick={() => openPlayer(r.player.id)} key={r.player.id}>
      <Avatar player={r.player} size={34} />
      <span className="perf-text"><b>{name[0][0]}. {name.slice(1).join(' ')}</b> {r.line}</span>
      <span className="perf-when">{String(r.when).startsWith('Wk') ? r.when : r.when === addDays(etDate(), -1) ? 'Last night' : r.when === etDate() ? 'Tonight' : monthDay(r.when)}</span>
    </button>
  );
}
