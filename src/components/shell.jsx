import { useEffect, useState } from 'react';
import { useData } from '../data.jsx';
import { FORMATS } from '../model.js';
import { Segmented, TeamLogo, kickoff, timeAgo, useNow, useUi } from './ui.jsx';

const NAV = [
  { path: 'home', label: 'This Week', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { path: 'projections', label: 'Projections', icon: 'M4 19h16M6 16V9m5 7V5m5 11v-5m4 5V8' },
  { path: 'props', label: 'Props', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: 'stats', label: 'Season Stats', icon: 'M4 6h16M4 12h16M4 18h10' },
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0f17' : '#f6f7fb');
    try { localStorage.setItem('ge:pref:theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme];
}

export function Header({ route }) {
  const { core, fmt, setFmt, updatedAt, reload, loading, anyLive } = useData();
  const [theme, setTheme] = useTheme();
  useNow(30000);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#/home" aria-label="Gridiron Edge home">
          <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden>
            <rect width="64" height="64" rx="14" fill="var(--brand-bg)" />
            <ellipse cx="32" cy="32" rx="22" ry="13" transform="rotate(-35 32 32)" fill="var(--accent)" />
            <path d="M23 41 41 23M27 33l4 4M31 29l4 4M35 25l4 4" stroke="var(--brand-bg)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="brand-text">
            Gridiron<span>Edge</span>
          </span>
        </a>
        {core && (
          <span className="week-pill" title={`${core.season} ${core.seasonType} season`}>
            {anyLive && <span className="live-dot" aria-label="Games live" />}
            {core.season} · Week {core.week}
          </span>
        )}
        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={route.path === n.path ? 'active' : ''} aria-current={route.path === n.path ? 'page' : undefined}>
              <Icon d={n.icon} size={16} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="topbar-tools">
          <Segmented size="sm" label="Scoring format" value={fmt} onChange={setFmt} options={Object.entries(FORMATS).map(([value, v]) => ({ value, label: v.label }))} />
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
      {NAV.map((n) => (
        <a key={n.path} href={`#/${n.path}`} className={route.path === n.path ? 'active' : ''}>
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
  const { board, loading } = useData();
  const { openTeam } = useUi();
  if (!board.games.length) {
    return <div className="ticker ticker-empty">{loading ? <span className="muted">Loading scores…</span> : <span className="muted">No games scheduled this week</span>}</div>;
  }
  const order = { in: 0, pre: 1, post: 2 };
  const games = [...board.games].sort((a, b) => order[a.state] - order[b.state] || new Date(a.date) - new Date(b.date));
  return (
    <div className="ticker" role="list" aria-label="Scores">
      {games.map((g) => (
        <div key={g.id} role="listitem" className={`tick ${g.state} ${g.redZone ? 'rz' : ''}`}>
          <div className="tick-head">
            <GameStatus g={g} />
            {g.tv && <span className="tv">{g.tv}</span>}
          </div>
          {[g.away, g.home].map((s) => {
            const lost = g.state === 'post' && !s.winner;
            return (
              <button type="button" key={s.abbr} className={`tick-row ${lost ? 'lost' : ''}`} onClick={() => openTeam(s.abbr)}>
                <TeamLogo abbr={s.abbr} size={20} />
                <span className="abbr">{s.abbr}</span>
                {g.possession && g.state === 'in' && g.possession === s.abbr && <span className="poss" title="Possession" />}
                <span className="rec">{g.state === 'pre' ? s.record : ''}</span>
                <span className="score">{g.state === 'pre' ? '' : s.score}</span>
              </button>
            );
          })}
          {g.state === 'in' && g.downDistance && <div className="tick-foot">{g.redZone && <b>RZ </b>}{g.downDistance}</div>}
        </div>
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
