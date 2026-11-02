import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';
import { useData } from '../data.jsx';
import { FORMATS } from '../model.js';
import { Segmented, TeamLogo, kickoff, timeAgo, useNow, useUi } from './ui.jsx';

const NBA_NAV = [
  { path: 'home', label: 'Tonight', short: 'Tonight', icon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z' },
  { path: 'projections', label: 'Projections', icon: 'M4 19h16M6 16V9m5 7V5m5 11v-5m4 5V8' },
  { path: 'props', label: 'Props', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: 'scan', label: 'Slip Scan', short: 'Scan', icon: 'M3 7h3l2-3h8l2 3h3v13H3zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { path: 'stats', label: 'Season Stats', short: 'Stats', icon: 'M4 6h16M4 12h16M4 18h10' },
  { path: 'teams', label: 'Teams', icon: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z' },
  { path: 'matchups', label: 'Matchups', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
];

const navFor = (sport) => (sport === 'nba' ? NBA_NAV : NAV);
const href = (sport, path) => `#/${sport === 'nba' ? 'nba/' : ''}${path}`;

const NAV = [
  { path: 'home', label: 'This Week', short: 'Week', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { path: 'projections', label: 'Projections', icon: 'M4 19h16M6 16V9m5 7V5m5 11v-5m4 5V8' },
  { path: 'props', label: 'Props', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: 'scan', label: 'Slip Scan', short: 'Scan', icon: 'M3 7h3l2-3h8l2 3h3v13H3zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { path: 'stats', label: 'Season Stats', short: 'Stats', icon: 'M4 6h16M4 12h16M4 18h10' },
  { path: 'teams', label: 'Teams', icon: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z' },
  { path: 'matchups', label: 'Matchups', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
];

export function Icon({ d, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('ge:pref:theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#06070f' : '#f6f5ff');
    try { localStorage.setItem('ge:pref:theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme];
}

function SportSwitch({ route }) {
  const go = (sport) => {
    if (sport === route.sport) return;
    const target = navFor(sport).some((n) => n.path === route.path) ? route.path : 'home';
    window.location.hash = href(sport, target).slice(1);
  };
  return (
    <div className="sport-switch" role="radiogroup" aria-label="Sport">
      {['nfl', 'nba'].map((s) => (
        <button key={s} type="button" role="radio" aria-checked={route.sport === s} className={route.sport === s ? 'on' : ''} onClick={() => go(s)}>
          <span className={`sport-ico ${s}`} aria-hidden />
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function Header({ route }) {
  const { core, fmt, setFmt, updatedAt, reload, loading, anyLive, date } = useData();
  const nav = navFor(route.sport);
  const pill = core
    ? core.sport === 'nba'
      ? `${core.label} · ${date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''}`
      : `${core.season} · Week ${core.week}`
    : null;
  const [theme, setTheme] = useTheme();
  useNow(30000);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href={href(route.sport, 'home')} aria-label="Gridiron Edge home">
          <Logo size={34} />
          <span className="brand-text">
            Gridiron<span>Edge</span>
          </span>
        </a>
        <SportSwitch route={route} />
        {pill && (
          <span className="week-pill">
            {anyLive && <span className="live-dot" aria-label="Games live" />}
            {pill}
          </span>
        )}
        <nav className="nav" aria-label="Primary">
          {nav.map((n) => (
            <a key={n.path} href={href(route.sport, n.path)} className={route.path === n.path ? 'active' : ''} aria-current={route.path === n.path ? 'page' : undefined} title={n.label}>
              <Icon d={n.icon} size={16} />
              <span>{n.short || n.label}</span>
            </a>
          ))}
        </nav>
        <div className="topbar-tools">
          {setFmt && <Segmented size="sm" label="Scoring format" value={fmt} onChange={setFmt} options={Object.entries(FORMATS).map(([value, v]) => ({ value, label: v.label }))} />}
          <button type="button" className="icon-btn" onClick={reload} title={updatedAt ? `Updated ${timeAgo(updatedAt)} · click to refresh` : 'Refresh'} aria-label="Refresh data">
            <svg className={loading ? 'spin' : ''} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
            </svg>
          </button>
          <button type="button" className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle color theme" title="Toggle theme">
            {theme === 'dark' ? (
              <Icon size={16} d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
            ) : (
              <Icon size={16} d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

export function MobileNav({ route }) {
  return (
    <nav className="mobile-nav" aria-label="Primary mobile">
      {navFor(route.sport).map((n) => (
        <a key={n.path} href={href(route.sport, n.path)} className={route.path === n.path ? 'active' : ''}>
          <Icon d={n.icon} size={20} />
          <span>{n.label.split(' ')[0]}</span>
        </a>
      ))}
    </nav>
  );
}

export function GameStatus({ g }) {
  if (g.state === 'in') {
    return (
      <span className="status live">
        <span className="live-dot" /> {g.detail}
      </span>
    );
  }
  if (g.state === 'post') return <span className="status final">{g.detail}</span>;
  return <span className="status">{kickoff(g.date)}</span>;
}

export function Ticker() {
  const { board, loading, sport } = useData();
  const { openTeam } = useUi();
  if (!board.games.length) {
    return <div className="ticker ticker-empty">{loading ? <span className="muted">Loading scores…</span> : <span className="muted">{sport === 'nba' ? 'No games on this date' : 'No games scheduled this week'}</span>}</div>;
  }
  const order = { in: 0, pre: 1, post: 2 };
  const games = [...board.games].sort((a, b) => order[a.state] - order[b.state] || new Date(a.date) - new Date(b.date));
  return (
    <div className="ticker" role="list" aria-label="Scores">
      {games.map((g) => (
        <a key={g.id} role="listitem" href={`#/${sport === 'nba' ? 'nba/' : ''}game?id=${g.id}`} className={`tick ${g.state} ${g.redZone ? 'rz' : ''}`} title={`${g.away.abbr} @ ${g.home.abbr}: open Game Center`}>
          <div className="tick-head">
            <GameStatus g={g} />
            {g.tv && <span className="tv">{g.tv}</span>}
          </div>
          {[g.away, g.home].map((s) => {
            const lost = g.state === 'post' && !s.winner;
            return (
              <span key={s.abbr} className={`tick-row ${lost ? 'lost' : ''}`}>
                <TeamLogo abbr={s.abbr} size={20} />
                <span className="abbr">{s.abbr}</span>
                {g.possession && g.state === 'in' && g.possession === s.abbr && <span className="poss" title="Possession" />}
                <span className="rec">{g.state === 'pre' ? s.record : ''}</span>
                <span className="score">{g.state === 'pre' ? '' : s.score}</span>
              </span>
            );
          })}
          {g.state === 'in' && g.downDistance && <div className="tick-foot">{g.redZone && <b>RZ </b>}{g.downDistance}</div>}
        </a>
      ))}
      {board.source === 'snapshot' && board.asOf && (
        <div className="tick asof" title="Live scores unavailable in this browser; showing the latest scheduled snapshot">
          <div className="tick-head"><span className="status">Scores as of</span></div>
          <strong>{timeAgo(new Date(board.asOf).getTime())}</strong>
        </div>
      )}
      {board.byes.length > 0 && (
        <div className="tick bye">
          <div className="tick-head"><span className="status">On bye</span></div>
          <div className="bye-logos">
            {board.byes.map((b) => (
              <button type="button" key={b} onClick={() => openTeam(b)} title={b}><TeamLogo abbr={b} size={22} /></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
