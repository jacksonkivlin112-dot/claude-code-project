import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Logo from './Logo.jsx';
import SearchSheet from './SearchSheet.jsx';
import { useData } from '../data.jsx';
import { FORMATS } from '../model.js';
import { Segmented, TeamLogo, kickoff, timeAgo, useNow, useUi } from './ui.jsx';

const NBA_NAV = [
  { path: 'home', label: 'Tonight', short: 'Tonight', icon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z' },
  { path: 'projections', label: 'Projections', icon: 'M4 19h16M6 16V9m5 7V5m5 11v-5m4 5V8' },
  { path: 'props', label: 'Props', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: 'scan', label: 'Slip Scan', short: 'Scan', icon: 'M3 7h3l2-3h8l2 3h3v13H3zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { path: 'parlays', label: 'Parlay Builder', short: 'Parlays', icon: 'M4 6h11M4 12h8M4 18h11M18 5l3 3-3 3M18 13l3 3-3 3' },
  { path: 'slips', label: 'My Slips', short: 'Slips', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3' },
  { path: 'record', label: 'Pick Record', short: 'Record', icon: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 6h3a3 3 0 0 1-3 4M7 6H4a3 3 0 0 0 3 4' },
  { path: 'stats', label: 'Season Stats', short: 'Stats', icon: 'M4 6h16M4 12h16M4 18h10' },
  { path: 'teams', label: 'Teams', menuOnly: true, icon: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z' },
  { path: 'matchups', label: 'Matchups', menuOnly: true, icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
];

const TENNIS_NAV = [
  { path: 'home', label: 'Matches', short: 'Matches', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8' },
  { path: 'picks', label: 'Picks & Parlays', short: 'Picks', icon: 'M4 6h11M4 12h8M4 18h11M18 5l3 3-3 3M18 13l3 3-3 3' },
  { path: 'bets', label: 'Betting Picks', short: 'Bets', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: 'rankings', label: 'Rankings', icon: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 6h3a3 3 0 0 1-3 4M7 6H4a3 3 0 0 0 3 4' },
  { path: 'record', label: 'Model Record', short: 'Record', icon: 'M4 19h16M6 16V9m5 7V5m5 11v-5m4 5V8' },
];
const CFB_NAV = [
  { path: 'home', label: 'This Week', short: 'Week', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { path: 'props', label: 'Props & Best Picks', short: 'Props', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: 'picks', label: 'Game Picks', short: 'Picks', icon: 'M4 6h11M4 12h8M4 18h11M18 5l3 3-3 3M18 13l3 3-3 3' },
  { path: 'projections', label: 'Projections', icon: 'M4 19h16M6 16V9m5 7V5m5 11v-5m4 5V8' },
  { path: 'stats', label: 'Season Stats', short: 'Stats', icon: 'M4 6h16M4 12h16M4 18h10' },
  { path: 'teams', label: 'Teams', icon: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z' },
  { path: 'matchups', label: 'Matchups', menuOnly: true, icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
];
const navFor = (sport) => (sport === 'nba' ? NBA_NAV : sport === 'tennis' ? TENNIS_NAV : sport === 'cfb' ? CFB_NAV : NAV);
const href = (sport, path) => `#/${sport === 'nfl' ? '' : `${sport}/`}${path}`;
const SPORTS_LIST = ['nfl', 'cfb', 'nba', 'tennis'];
const SPORT_NAME = { nfl: 'NFL', cfb: 'CFB', nba: 'NBA', tennis: 'Tennis' };

const NAV = [
  { path: 'home', label: 'This Week', short: 'Week', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { path: 'projections', label: 'Projections', icon: 'M4 19h16M6 16V9m5 7V5m5 11v-5m4 5V8' },
  { path: 'props', label: 'Props', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: 'scan', label: 'Slip Scan', short: 'Scan', icon: 'M3 7h3l2-3h8l2 3h3v13H3zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { path: 'parlays', label: 'Parlay Builder', short: 'Parlays', icon: 'M4 6h11M4 12h8M4 18h11M18 5l3 3-3 3M18 13l3 3-3 3' },
  { path: 'slips', label: 'My Slips', short: 'Slips', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3' },
  { path: 'record', label: 'Pick Record', short: 'Record', icon: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 6h3a3 3 0 0 1-3 4M7 6H4a3 3 0 0 0 3 4' },
  { path: 'stats', label: 'Season Stats', short: 'Stats', icon: 'M4 6h16M4 12h16M4 18h10' },
  { path: 'teams', label: 'Teams', menuOnly: true, icon: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z' },
  { path: 'matchups', label: 'Matchups', menuOnly: true, icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#f6f5ff');
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
      {SPORTS_LIST.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={route.sport === s} className={route.sport === s ? 'on' : ''} onClick={() => go(s)}>
          <span className={`sport-ico ${s}`} aria-hidden />
          {SPORT_NAME[s].toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function Header({ route }) {
  const { core, fmt, setFmt, updatedAt, reload, loading, anyLive, date } = useData();
  const nav = navFor(route.sport);
  const pill = core
    ? core.sport === 'tennis'
      ? `Tennis · ${core.label}`
      : core.sport === 'nba'
      ? `${core.label} · ${date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''}`
      : `${core.season} · Week ${core.week}`
    : null;
  const [theme, setTheme] = useTheme();
  const [menu, setMenu] = useState(false);
  useNow(30000);
  useEffect(() => setMenu(false), [route.path, route.sport]);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="menu-btn" onClick={() => setMenu(true)} aria-label="Open menu">
          <Icon d="M4 7h16M4 12h16M4 17h16" size={22} />
        </button>
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
          {nav.filter((n) => !n.menuOnly).map((n) => (
            <a key={n.path} href={href(route.sport, n.path)} className={route.path === n.path ? 'active' : ''} aria-current={route.path === n.path ? 'page' : undefined} title={n.label}>
              <Icon d={n.icon} size={16} />
              <span>{n.short || n.label}</span>
            </a>
          ))}
        </nav>
        <div className="topbar-tools">
          {setFmt && <span className="fmt-desktop"><Segmented size="sm" label="Scoring format" value={fmt} onChange={setFmt} options={Object.entries(FORMATS).map(([value, v]) => ({ value, label: v.label }))} /></span>}
          <button type="button" className="ai-hdr" onClick={() => window.dispatchEvent(new Event('ge:open-ai'))} aria-label="Ask the AI assistant"><span aria-hidden>✦</span> AI</button>
          <span className="tool-pill">
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
          </span>
        </div>
      </div>
      <LeagueTabs route={route} anyLive={anyLive} />
      {menu && createPortal(
        <div className="menu-sheet" onClick={() => setMenu(false)}>
          <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            <div className="menu-top">
              <a className="brand" href={href(route.sport, 'home')}><Logo size={30} /><span className="brand-text">Gridiron<span>Edge</span></span></a>
              <button type="button" className="icon-btn" onClick={() => setMenu(false)} aria-label="Close menu">✕</button>
            </div>
            {pill && <span className="week-pill menu-pill">{anyLive && <span className="live-dot" />}{pill}</span>}
            <nav className="menu-links">
              {nav.map((n) => (
                <a key={n.path} href={href(route.sport, n.path)} className={route.path === n.path ? 'active' : ''}>
                  <Icon d={n.icon} size={20} /> {n.label}
                </a>
              ))}
            </nav>
            <InstallApp />
            {setFmt && (
              <div className="menu-row">
                <span>Fantasy scoring</span>
                <Segmented size="sm" label="Scoring format" value={fmt} onChange={setFmt} options={Object.entries(FORMATS).map(([value, v]) => ({ value, label: v.label }))} />
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
}

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Install-to-home-screen: the browser prompt where supported, instructions on iPhone. */
function InstallApp() {
  const [can, setCan] = useState(() => !!window.__installPrompt);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const on = () => setCan(true);
    window.addEventListener('ge:installable', on);
    return () => window.removeEventListener('ge:installable', on);
  }, []);
  if (isStandalone()) return null;
  const install = async () => {
    if (window.__installPrompt) {
      window.__installPrompt.prompt();
      await window.__installPrompt.userChoice.catch(() => {});
      window.__installPrompt = null;
      setCan(false);
    } else setHelp((h) => !h);
  };
  return (
    <div className="install">
      <button type="button" className="install-btn" onClick={install}>
        <img src="./icon-192.png" alt="" width="36" height="36" />
        <span><strong>Install the app</strong><small>{can ? 'Full screen, home-screen icon, alerts' : 'Add Gridiron Edge to your home screen'}</small></span>
      </button>
      {help && (
        <ol className="install-help">
          {isIos() ? (
            <>
              <li>Open this page in <b>Safari</b>.</li>
              <li>Tap the <b>Share</b> button <span aria-hidden>⬆︎</span>.</li>
              <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            </>
          ) : (
            <>
              <li>Open your browser menu (<b>⋮</b>).</li>
              <li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li>
            </>
          )}
        </ol>
      )}
    </div>
  );
}

/** Big league tabs under the header on phones. */
function LeagueTabs({ route, anyLive }) {
  return (
    <nav className="league-tabs" aria-label="League">
      {SPORTS_LIST.map((s) => {
        const target = navFor(s).some((n) => n.path === route.path) ? route.path : 'home';
        return (
          <a key={s} href={href(s, target)} className={route.sport === s ? 'on' : ''}>
            {SPORT_NAME[s]}
            {route.sport === s && anyLive && <span className="lt-dot" aria-label="Live games" />}
          </a>
        );
      })}
    </nav>
  );
}

const DOCK = ['home', 'props', 'parlays', 'scan', 'slips'];

/** Floating rounded bottom bar with the main sections, plus a separate search button. */
export function MobileNav({ route }) {
  const [search, setSearch] = useState(false);
  const items = route.sport === 'tennis' ? navFor('tennis') : route.sport === 'cfb' ? navFor('cfb').filter((n) => !n.menuOnly && n.path !== 'teams') : navFor(route.sport).filter((n) => DOCK.includes(n.path)).sort((a, b) => DOCK.indexOf(a.path) - DOCK.indexOf(b.path));
  return (
    <div className="dock">
      <nav className="mobile-nav" aria-label="Primary mobile">
        {items.map((n) => (
          <a key={n.path} href={href(route.sport, n.path)} className={route.path === n.path ? 'active' : ''} aria-label={n.label} title={n.label}>
            <Icon d={n.icon} size={27} />
            <span className="mn-label">{n.short || n.label}</span>
          </a>
        ))}
      </nav>
      <button type="button" className="dock-search" aria-label="Search players" onClick={() => setSearch(true)}>
        <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={28} />
      </button>
      {search && <SearchSheet sport={route.sport} onClose={() => setSearch(false)} />}
    </div>
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
        <a key={g.id} role="listitem" href={`#/${sport && sport !== 'nfl' ? `${sport}/` : ''}game?id=${g.id}`} className={`tick ${g.state} ${g.redZone ? 'rz' : ''}`} title={`${g.away.abbr} @ ${g.home.abbr}: open Game Center`}>
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
