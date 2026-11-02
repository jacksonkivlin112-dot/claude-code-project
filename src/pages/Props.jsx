import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useData, usePersistentState } from '../data.jsx';
import { MARKETS, SPORTS, fetchPrizePicksLines, listEvents, normName } from '../oddsapi.js';
import { BREAKEVEN, buildLookups, evaluateProp, parseManual, probabilities } from '../propsModel.js';
import { parseManualNba } from '../nba/props.js';
import { useProjectionRows, useTeamOutlook } from '../components/players.jsx';
import { SaveSlipButton } from '../components/Tracking.jsx';
import { gradePicks, logPicks } from '../tracker.js';
import { Avatar, Card, Empty, InjuryDot, PosBadge, Segmented, SkeletonRows, TeamLogo, WeeklyBars, f1, kickoff, timeAgo, useNow, useUi } from '../components/ui.jsx';

const lsKeys = (sport) => {
  const sfx = sport === 'nba' ? ':nba' : '';
  return { key: 'ge:pref:oddsKey', manual: `ge:props:manual${sfx}`, lines: `ge:props:lastLines${sfx}`, live: `ge:props:live${sfx}` };
};

// Sport-specific settings shared by every component on the page.
const CfgCtx = createContext(null);
const useCfg = () => useContext(CfgCtx);

const SKILL = ['QB', 'RB', 'WR', 'TE'];
export const NFL_CFG = {
  sport: 'nfl',
  markets: MARKETS,
  evaluate: evaluateProp,
  parseManual,
  groups: SKILL,
  groupOf: (r) => r.pos,
  groupLabel: (g) => g,
  boardMinProj: 0.5,
  safeMinProj: 5,
  period: 'week',
  title: 'Player Props · Over / Under',
  example: 'Josh Allen, Pass Yards, 245.5\nBijan Robinson Rush Yds 82.5\nPuka Nacua, Receptions, 6.5',
  searchHint: 'Search any player or team (e.g. Josh Allen, Bijan, KC)',
  keyMarkets: {
    QB: ['player_pass_yds', 'player_pass_tds', 'player_rush_yds'],
    RB: ['player_rush_yds', 'player_receptions', 'player_rush_reception_yds'],
    WR: ['player_receptions', 'player_reception_yds'],
    TE: ['player_receptions', 'player_reception_yds'],
  },
  safeMarkets: {
    QB: ['player_pass_yds', 'player_pass_completions', 'player_pass_attempts', 'player_rush_yds'],
    RB: ['player_rush_yds', 'player_rush_attempts', 'player_receptions', 'player_reception_yds', 'player_rush_reception_yds'],
    WR: ['player_receptions', 'player_reception_yds'],
    TE: ['player_receptions', 'player_reception_yds'],
  },
  // Lines below these are too trivial to be offered or worth playing.
  minLine: {
    player_pass_yds: 149.5, player_pass_completions: 11.5, player_pass_attempts: 19.5, player_rush_yds: 19.5,
    player_rush_attempts: 7.5, player_receptions: 2.5, player_reception_yds: 19.5, player_rush_reception_yds: 29.5,
  },
  marketsFor: (r) => Object.keys(MARKETS).filter((k) => MARKETS[k].pos.includes(r.pos)),
};

const readJSON = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/** Remember the last line seen for each prop so line moves can be flagged. */
function withMovement(props, LS) {
  const last = readJSON(LS.lines, {});
  const next = { ...last };
  const out = props.map((p) => {
    const prev = p.prevLine ?? (last[p.id] != null && last[p.id] !== p.line ? last[p.id] : undefined);
    next[p.id] = p.line;
    return prev != null ? { ...p, prevLine: prev } : p;
  });
  writeJSON(LS.lines, next);
  return out;
}

export function usePropLines(sport) {
  const LS = lsKeys(sport);
  const marketsMap = SPORTS[sport].markets;
  const [snapshot, setSnapshot] = useState(null); // {generatedAt, props} | false
  const [live, setLive] = useState(() => readJSON(LS.live, null)); // {fetchedAt, props, remaining}
  const [manual, setManualState] = useState(() => readJSON(LS.manual, []));
  const [apiKey, setApiKeyState] = useState(() => { try { return localStorage.getItem(LS.key) || ''; } catch { return ''; } });
  const [interval, setIntervalPref] = usePersistentState('propsInterval', '15');
  const [marketsPref, setMarketsPref] = usePersistentState(sport === 'nba' ? 'nbaPropsMarkets' : 'propsMarkets', Object.keys(marketsMap).join(','));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const markets = marketsPref.split(',').filter((m) => marketsMap[m]);

  const setManual = (v) => { setManualState(v); writeJSON(LS.manual, v); };
  const setApiKey = (k) => {
    setApiKeyState(k);
    try { if (k) localStorage.setItem(LS.key, k); else localStorage.removeItem(LS.key); } catch { /* ignore */ }
  };

  // Two published line files: PrizePicks (props.json, needs an Odds API key in the
  // workflow) and free sportsbook lines from ESPN (lines.json). PrizePicks wins when both
  // have the same player and stat.
  useEffect(() => {
    const base = `${import.meta.env.BASE_URL}data/${sport === 'nba' ? 'nba/' : ''}`;
    const load = (f) => fetch(base + f, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([load('props.json'), load('lines.json')]).then(([pp, book]) => {
      const files = [pp && Array.isArray(pp.props) ? { ...pp, book: 'PrizePicks' } : null, book && Array.isArray(book.props) ? book : null].filter(Boolean);
      if (!files.length) { setSnapshot(false); return; }
      const byId = new Map();
      for (const f of files) {
        for (const p of f.props) {
          if (byId.has(p.id)) continue;
          byId.set(p.id, { ...p, book: p.book || f.book, prevLine: p.prevLine ?? p.openLine });
        }
      }
      setSnapshot({
        generatedAt: files.map((f) => f.generatedAt).sort().pop(),
        books: files.filter((f) => f.props.length).map((f) => f.book),
        props: withMovement([...byId.values()], LS),
      });
    });
  }, [sport]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    if (!apiKey) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchPrizePicksLines(apiKey, { sport, markets });
      const data = { fetchedAt: new Date().toISOString(), props: withMovement(res.props, LS), remaining: res.remaining, used: res.used, games: res.events };
      setLive(data);
      writeJSON(LS.live, data);
    } catch (e) {
      setErr(e.status === 401 ? 'That API key was rejected.' : e.code === 'OUT_OF_USAGE_CREDITS' ? 'Your Odds API credits are used up for this period.' : e.message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, sport, markets.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh while the page is open (credit-aware: user picks the interval).
  useEffect(() => {
    if (!apiKey || interval === '0') return undefined;
    const ms = Number(interval) * 60 * 1000;
    const stale = !live || Date.now() - new Date(live.fetchedAt).getTime() > ms;
    if (stale) refresh();
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [apiKey, interval, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = apiKey && live ? 'live' : snapshot ? 'snapshot' : null;
  const fetched = source === 'live' ? live.props : source === 'snapshot' ? snapshot.props : [];
  const asOf = source === 'live' ? live.fetchedAt : source === 'snapshot' ? snapshot.generatedAt : null;
  const manualRows = manual.map((m) => ({ ...m, id: `m:${normName(m.player)}|${m.market}`, manual: true }));
  const fetchedIds = new Set(fetched.map((p) => p.id));
  const lines = [...fetched, ...manualRows.filter((m) => !fetchedIds.has(m.id.slice(2)))];

  return {
    sport, marketsMap, lines, source, asOf, books: source === 'snapshot' ? snapshot.books : source === 'live' ? ['PrizePicks'] : null, snapshotLoaded: snapshot !== null, live, manual, setManual, apiKey, setApiKey,
    interval, setIntervalPref, markets, setMarkets: (arr) => setMarketsPref(arr.join(',')), refresh, busy, err,
  };
}

const GRADE_ORDER = { strong: 3, solid: 2, lean: 1, pass: 0 };

/**
 * Logs the model's open picks (graded PrizePicks lines + 75% highest-chance lines)
 * for the record, and grades finished ones. Runs wherever the prop model is loaded.
 */
export function usePickLogger(cfg, ctx, rows, evaluated) {
  const { season, liveById, gameByTeam } = useData();
  const safe = useMemo(() => (ctx && rows ? buildSafePicks(cfg, ctx, rows, 0.75, gameByTeam) : []), [cfg, ctx, rows, gameByTeam]);
  useEffect(() => {
    if (!ctx || !evaluated) return;
    logPicks(cfg.sport, { week: ctx.week, evaluated, safe, gameByTeam });
    gradePicks(cfg.sport, { markets: cfg.markets, season, liveById, gameByTeam });
  }, [ctx, evaluated, safe]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** NFL: projections, season logs and the team model feed the prop model. */
export function useNflContext() {
  const { core, season, ranks, liveById, gameByTeam, teams } = useData();
  const rows = useProjectionRows(core?.week);
  const outlook = useTeamOutlook();
  const ctx = useMemo(() => {
    if (!rows || !outlook) return null;
    return {
      lookups: buildLookups(rows, season, teams),
      season,
      ranks,
      outlookByTeam: Object.fromEntries(outlook.teams.map((t) => [t.abbr, t])),
      leagueAvg: outlook.leagueAvg,
      liveById,
      gameByTeam,
      week: core?.week,
    };
  }, [rows, outlook, season, ranks, liveById, gameByTeam, teams, core]);
  return { ctx, rows };
}

export default function Props() {
  return <PropsPage cfg={NFL_CFG} useSportContext={useNflContext} />;
}

export function PropsPage({ cfg, useSportContext }) {
  const { ctx, rows } = useSportContext();
  const P = usePropLines(cfg.sport);
  useNow(30000);
  return (
    <CfgCtx.Provider value={cfg}>
      <PropsBody ctx={ctx} rows={rows} P={P} />
    </CfgCtx.Provider>
  );
}

function PropsBody({ ctx, rows, P }) {
  const cfg = useCfg();

  const [market, setMarket] = useState('ALL');
  const [side, setSide] = useState('ALL');
  const [minGrade, setMinGrade] = useState('solid');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('prob');
  const [showSettings, setShowSettings] = useState(false);
  const [showStarted, setShowStarted] = useState(false);

  const evaluated = useMemo(() => (ctx ? P.lines.map((l) => cfg.evaluate(l, ctx)).filter(Boolean) : null), [ctx, P.lines, cfg]);
  usePickLogger(cfg, ctx, rows, evaluated);
  const saveCheck = (c) => {
    const exists = P.manual.some((m) => normName(m.player) === normName(c.player) && m.market === c.market);
    P.setManual([...P.manual.filter((m) => !(normName(m.player) === normName(c.player) && m.market === c.market)), { player: c.player, market: c.market, line: Number(c.line), added: Date.now() }]);
    return exists ? 'updated' : 'added';
  };

  const marketsPresent = useMemo(() => [...new Set((evaluated || []).map((e) => e.market))], [evaluated]);

  const filtered = useMemo(() => {
    if (!evaluated) return [];
    const needle = q.trim().toLowerCase();
    return evaluated
      .filter((e) => (market === 'ALL' || e.market === market)
        && (side === 'ALL' || e.side === side.toLowerCase())
        && GRADE_ORDER[e.grade.key] >= GRADE_ORDER[minGrade]
        && (showStarted || !e.started)
        && (!needle || e.player.toLowerCase().includes(needle) || (e.team || '').toLowerCase() === needle))
      .sort((a, b) => (sort === 'prob' ? b.prob - a.prob : sort === 'edge' ? Math.abs(b.mean - b.line) / b.line - Math.abs(a.mean - a.line) / a.line : new Date(a.commence || 0) - new Date(b.commence || 0)));
  }, [evaluated, market, side, minGrade, q, sort, showStarted]);

  const open = (evaluated || []).filter((e) => !e.started && !e.unmatched);
  const best = [...open].filter((e) => e.grade.key !== 'pass').sort((a, b) => b.prob - a.prob).slice(0, 6);
  const graded = (evaluated || []).filter((e) => e.result?.final && e.grade.key !== 'pass');
  const wins = graded.filter((e) => e.result.hit).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Player props</p>
          <h1>{cfg.title}</h1>
          {cfg.HeaderExtra && <cfg.HeaderExtra />}
          <p className="hero-sub">
            Each line is run through our model: projection, season and recent form, opponent matchup, game script and injuries. The result is a hit probability for the over and the under. Lines are real: DraftKings player props (free, via ESPN) plus PrizePicks when connected. Picks need to clear ~{Math.round(BREAKEVEN * 1000) / 10}% to count as an edge (PrizePicks’ per-leg break-even, about the same as a −118 bet at a sportsbook).
          </p>
        </div>
        <div className="props-status">
          <SourcePill P={P} />
          {P.apiKey && (
            <button type="button" className="icon-btn" onClick={P.refresh} title="Refresh lines now" aria-label="Refresh lines">
              <svg className={P.busy ? 'spin' : ''} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" /></svg>
            </button>
          )}
          <button type="button" className={`btn-ghost ${showSettings ? 'on' : ''}`} onClick={() => setShowSettings((s) => !s)}>
            Line sources
          </button>
        </div>
      </div>

      {P.err && <div className="banner error" role="alert"><span><strong>Couldn’t refresh lines.</strong> {P.err}</span><button type="button" className="btn" onClick={P.refresh}>Retry</button></div>}

      {showSettings && <SourceSettings P={P} rows={rows} />}

      {!evaluated || !P.snapshotLoaded ? (
        <Card><SkeletonRows n={6} h={64} /></Card>
      ) : (
        <>
          {P.lines.length > 0 && (
            <>
              {best.length > 0 && (
                <section>
                  <div className="section-head"><h2>Best plays</h2><span className="muted small">Highest model confidence among open lines</span></div>
                  <div className="best-grid">{best.map((e) => <BestCard key={e.id} e={e} />)}</div>
                </section>
              )}

              {best.length >= 2 && (
                <SlipBuilder
                  title="Safest slip from today’s lines"
                  subtitle="Highest-probability picks from the loaded lines, one per game"
                  picks={open.filter((e) => e.grade.key === 'strong' || e.grade.key === 'solid').map((e) => ({ key: e.id, sport: cfg.sport, playerId: e.playerId, player: e.player, pos: e.pos, team: e.team, opp: e.opp, game: e.team && e.opp ? [e.team, e.opp].sort().join('-') : e.id, side: e.side, line: e.line, market: e.market, stat: e.marketShort, prob: e.prob, gameTime: e.commence || ctx.gameByTeam[e.team]?.date, gameId: ctx.gameByTeam[e.team]?.id, week: ctx.week }))}
                />
              )}

              {graded.length > 0 && (
                <div className="record-bar">
                  <span>Model record this {cfg.period} (graded picks):</span>
                  <a className="link" href={`#/${cfg.sport === 'nba' ? 'nba/' : ''}record`}>Full record →</a>
                  <strong className={wins / graded.length >= BREAKEVEN ? 'pos-txt' : 'neg-txt'}>{wins}-{graded.length - wins}</strong>
                  <span className="muted">{Math.round((wins / graded.length) * 100)}% hit rate</span>
                </div>
              )}

              <div className="section-head"><h2>{P.source ? `${(P.books || ['PrizePicks']).join(' + ')} lines` : 'Your saved lines'}</h2><span className="muted small">{evaluated.length} line{evaluated.length === 1 ? '' : 's'}</span></div>
              <div className="toolbar">
                <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Stat type">
                  <option value="ALL">All stats</option>
                  {marketsPresent.map((m) => <option key={m} value={m}>{cfg.markets[m].label}</option>)}
                </select>
                <Segmented options={['ALL', 'OVER', 'UNDER']} value={side} onChange={setSide} label="Pick side" />
                <select value={minGrade} onChange={(e) => setMinGrade(e.target.value)} aria-label="Minimum confidence">
                  <option value="pass">All lines</option>
                  <option value="lean">Lean or better</option>
                  <option value="solid">Solid or better</option>
                  <option value="strong">Strong only</option>
                </select>
                <div className="search">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player or team" aria-label="Search lines" />
                </div>
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                  <option value="prob">Sort: confidence</option>
                  <option value="edge">Sort: gap vs line</option>
                  <option value="time">Sort: kickoff</option>
                </select>
                <label className="check"><input type="checkbox" checked={showStarted} onChange={(e) => setShowStarted(e.target.checked)} /> Include started games</label>
              </div>
              {filtered.length === 0 ? (
                <Card><Empty title="No lines match these filters">Try “All lines”, another stat, or include started games.</Empty></Card>
              ) : (
                <div className="props-list">{filtered.map((e) => <PropRow key={e.id} e={e} />)}</div>
              )}
            </>
          )}

          <HighChance ctx={ctx} rows={rows} onSave={saveCheck} />

          <PlayerBoard ctx={ctx} rows={rows} feed={evaluated} manual={P.manual} onSave={saveCheck} />

          {P.lines.length === 0 && <NoLines onSetup={() => setShowSettings(true)} />}
        </>
      )}

      <p className="disclaimer">
        Model estimates for research and entertainment only, with no guaranteed outcomes. Gridiron Edge is not affiliated with PrizePicks, DraftKings or ESPN. Sportsbook lines come from ESPN and PrizePicks lines from The Odds API; both can lag the apps, so always confirm the current line before entering. Play responsibly. 18+/21+ where legal. Help: 1-800-GAMBLER.
      </p>
    </div>
  );
}

function SourcePill({ P }) {
  if (P.source === 'live') {
    return (
      <span className="source-pill live" title={P.live?.remaining != null ? `${P.live.remaining} Odds API credits left` : ''}>
        <span className="live-dot" /> PrizePicks lines · {timeAgo(new Date(P.asOf).getTime())}
        {P.live?.remaining != null && <span className="muted"> · {P.live.remaining} credits</span>}
      </span>
    );
  }
  if (P.source === 'snapshot') return <span className="source-pill">{(P.books || ['PrizePicks']).join(' + ')} lines · updated {timeAgo(new Date(P.asOf).getTime())}</span>;
  if (P.manual.length) return <span className="source-pill">Manual lines</span>;
  return <span className="source-pill muted">No line source</span>;
}

function PickBadge({ e, size = 'md' }) {
  const pass = e.grade.key === 'pass';
  const label = e.unmatched ? 'N/A' : e.inactive ? 'AVOID' : pass ? 'PASS' : e.side === 'over' ? 'MORE' : 'LESS';
  const showProb = !e.unmatched && !e.inactive && e.prob != null;
  return (
    <span className={`pick pick-${size} ${pass ? 'pass' : e.side} ${e.inactive ? 'avoid' : ''}`} title={showProb ? `${Math.round(e.prob * 100)}% chance of ${e.side === 'over' ? 'more' : 'less'}` : undefined}>
      <span className="pick-side">{label}</span>
      <span className="pick-prob">{showProb ? `${Math.round(e.prob * 100)}%` : '—'}</span>
    </span>
  );
}

function LineValue({ e }) {
  const moved = e.prevLine != null && e.prevLine !== e.line;
  return (
    <span className="line-val">
      <strong>{e.line}</strong>
      {moved && (
        <span className={`line-move ${e.line > e.prevLine ? 'up' : 'down'}`} title={`Moved from ${e.prevLine}`}>
          {e.line > e.prevLine ? '▲' : '▼'} {e.prevLine}
        </span>
      )}
    </span>
  );
}

function HitDots({ recent, line }) {
  if (!recent.length) return <span className="muted small">No games</span>;
  return (
    <span className="hit-dots" aria-label="Recent games vs line">
      {recent.map((h) => (
        <span key={h.week} className={`hd ${h.push ? 'push' : h.over ? 'over' : 'under'}`} title={`${h.label || `Wk ${h.week} vs ${h.opp}`}: ${f1(h.val)} (${h.push ? 'push' : h.over ? 'over' : 'under'} ${line})`} />
      ))}
    </span>
  );
}

function BestCard({ e }) {
  const { openPlayer } = useUi();
  return (
    <button type="button" className={`best-card ${e.side}`} onClick={() => e.playerId && openPlayer(e.playerId)}>
      <div className="best-top">
        <Avatar player={{ id: e.playerId || '0', sport: e.sport, pos: e.pos, team: e.team, first: e.player.split(' ')[0], last: e.player.split(' ').slice(-1)[0] }} size={40} />
        <div className="best-name">
          <strong>{e.player}</strong>
          <span className="muted">{e.team} {e.opp ? `vs ${e.opp}` : ''}</span>
        </div>
        <PickBadge e={e} size="sm" />
      </div>
      <div className="best-line">
        <span className="best-market">{e.marketLabel}</span>
        <LineValue e={e} />
      </div>
      <div className="best-foot">
        <span>Model {f1(e.mean)}</span>
        <span className={`grade-txt g-${e.grade.key}`}>{e.grade.label}</span>
      </div>
    </button>
  );
}

function PropRow({ e }) {
  const [openRow, setOpen] = useState(false);
  const { openPlayer } = useUi();
  const { gameByTeam } = useData();
  const g = e.team ? gameByTeam[e.team] : null;
  const away = g && g.away.abbr === e.team;
  const playerish = { id: e.playerId || '0', sport: e.sport, pos: e.pos, team: e.team, first: e.player.split(' ')[0], last: e.player.split(' ').slice(-1)[0] };
  return (
    <article className={`prop ${openRow ? 'open' : ''} ${e.started ? 'started' : ''}`}>
      <button type="button" className="prop-main" onClick={() => setOpen((o) => !o)} aria-expanded={openRow}>
        <span className="prop-player">
          <Avatar player={playerish} size={40} />
          <span>
            <span className="cell-name">{e.player}<InjuryDot status={e.injury} /></span>
            <span className="cell-meta">
              {e.pos && <PosBadge pos={e.pos} />}
              {e.team && <><TeamLogo abbr={e.team} size={13} /> {e.team}</>}
              {e.opp && <span className="muted">{away ? '@' : 'vs'} {e.opp}</span>}
              {e.manual && <span className="tag tone-neutral">manual</span>}
              {e.book && !e.manual && <span className={`book-tag ${e.book === 'PrizePicks' ? 'pp' : 'dk'}`}>{e.book}</span>}
            </span>
          </span>
        </span>
        <span className="prop-market">
          <small>{e.marketLabel}</small>
          <LineValue e={e} />
        </span>
        <span className="prop-model hide-sm">
          <small>Model</small>
          <strong>{e.mean != null ? f1(e.mean) : '—'}</strong>
          {e.mean != null && <span className={`gap ${e.mean >= e.line ? 'pos-txt' : 'neg-txt'}`}>{e.mean >= e.line ? '+' : ''}{f1(e.mean - e.line)}</span>}
        </span>
        <span className="prop-hits hide-sm">
          <small>Last {e.recent?.length || 0} · {e.overs ?? 0} over</small>
          <HitDots recent={e.recent || []} line={e.line} />
        </span>
        <span className="prop-pick">
          {e.result ? (
            <span className={`result-chip ${e.result.final ? (e.result.hit ? 'hit' : 'miss') : 'live'}`}>
              {e.result.final ? (e.result.hit ? 'HIT' : 'MISS') : 'LIVE'} · {f1(e.result.actual)}
            </span>
          ) : null}
          <PickBadge e={e} />
          <span className={`grade-txt g-${e.grade.key}`}>{e.grade.label}</span>
        </span>
        <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {openRow && (
        <div className="prop-detail">
          <div className="prop-reasons">
            <h3>{e.unmatched ? 'No data' : e.inactive ? 'Why to avoid' : e.grade.key === 'pass' ? 'Why there’s no edge' : `Why ${e.side === 'over' ? 'MORE' : 'LESS'}`}</h3>
            <ul>
              {e.reasons.map((r, i) => <li key={i} className={`r-${r.tone}`}>{r.text}</li>)}
            </ul>
            <div className="prob-split">
              <div className="ps-bar">
                <div className="ps-over" style={{ width: `${(e.pOver || 0) * 100}%` }} />
                <div className="ps-be" style={{ left: `${BREAKEVEN * 100}%` }} title="Break-even" />
              </div>
              <div className="ps-labels">
                <span>More {Math.round((e.pOver || 0) * 100)}%</span>
                <span>Less {Math.round((e.pUnder || 0) * 100)}%</span>
              </div>
            </div>
            <div className="prop-meta-line muted">
              {e.commence ? kickoff(e.commence, { long: true }) : g ? kickoff(g.date, { long: true }) : ''}
              {e.updated ? ` · line updated ${timeAgo(new Date(e.updated).getTime())}` : ''}
              {e.playerId && <> · <button type="button" className="link" onClick={() => openPlayer(e.playerId)}>Player card →</button></>}
            </div>
          </div>
          <div className="prop-chart">
            <h3>{e.marketShort} by {e.sport === 'nba' ? 'game' : 'week'} vs line</h3>
            {e.recent?.length ? (
              <WeeklyBars
                height={150}
                maxWeek={Math.max(...e.recent.map((h) => h.week))}
                minWeek={e.sport === 'nba' ? Math.min(...e.recent.map((h) => h.week)) : 1}
                axisLabel={e.sport === 'nba' ? (w) => { const h = e.recent.find((x) => x.week === w); return h ? h.label.split(' ')[0] : ''; } : undefined}
                refLine={e.line}
                refLabel="line"
                data={e.recent.map((h) => ({ week: h.week, value: h.val, label: h.label || `vs ${h.opp}`, tone: h.over ? 'up' : 'down' }))}
              />
            ) : (
              <Empty title="No game history yet" />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function NoLines({ onSetup }) {
  const cfg = useCfg();
  return (
    <Card>
      <div className="nolines">
        <Empty title="Want every PrizePicks line graded automatically?">
          Use <strong>All player props</strong> above to check any player and stat. To load and grade the full PrizePicks board on its own, connect a free The Odds API key. PrizePicks has no public feed, and this source carries its lines.
        </Empty>
        <ol className="steps">
          <li><strong>Site-wide (recommended):</strong> add an <code>ODDS_API_KEY</code> repository secret. The scheduled GitHub Action then refreshes lines for everyone.</li>
          <li><strong>Just this browser:</strong> paste your own The Odds API key under <em>Line sources</em> to auto-refresh lines while this page is open.</li>
          <li><strong>Manual:</strong> paste lines straight from the PrizePicks app, like <code>{cfg.example.split('\n')[0]}</code>.</li>
        </ol>
        <button type="button" className="btn" onClick={onSetup}>Set up line sources</button>
      </div>
    </Card>
  );
}

function SourceSettings({ P, rows }) {
  const cfg = useCfg();
  const [keyInput, setKeyInput] = useState(P.apiKey);
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState(null);
  const [games, setGames] = useState(null);

  useEffect(() => {
    if (!P.apiKey) return;
    const horizon = cfg.sport === 'nba' ? 36 * 3600000 : 8 * 86400000;
    listEvents(P.apiKey, fetch, cfg.sport)
      .then((ev) => setGames(ev.filter((e) => { const t = new Date(e.commence_time).getTime(); return t > Date.now() && t - Date.now() < horizon; }).length))
      .catch(() => setGames(null));
  }, [P.apiKey, cfg.sport]);

  const addManual = () => {
    const { rows: parsed, errors } = cfg.parseManual(paste);
    const names = new Set((rows || []).map((r) => normName(r.name)));
    const unknown = parsed.filter((p) => !names.has(normName(p.player))).map((p) => p.player);
    const merged = [...P.manual.filter((m) => !parsed.some((p) => normName(p.player) === normName(m.player) && p.market === m.market)), ...parsed.map((p) => ({ ...p, added: Date.now() }))];
    P.setManual(merged);
    setPaste('');
    setMsg([
      `Added ${parsed.length} line${parsed.length === 1 ? '' : 's'}.`,
      ...errors,
      ...(unknown.length ? [`Not projected this ${cfg.period} (check spelling, or the player may be injured or not playing): ${unknown.join(', ')}`] : []),
    ]);
  };

  const toggleMarket = (m) => P.setMarkets(P.markets.includes(m) ? P.markets.filter((x) => x !== m) : [...P.markets, m]);

  return (
    <div className="grid-2">
      <Card title="Live PrizePicks lines" subtitle="Through The Odds API (bookmaker: PrizePicks)">
        <div className="form">
          <label className="field">
            <span>Your Odds API key</span>
            <div className="field-row">
              <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Paste key" autoComplete="off" spellCheck={false} />
              <button type="button" className="btn" onClick={() => P.setApiKey(keyInput.trim())}>Save</button>
              {P.apiKey && <button type="button" className="btn-ghost" onClick={() => { setKeyInput(''); P.setApiKey(''); }}>Remove</button>}
            </div>
            <small className="muted">Stored only in this browser. Free keys at the-odds-api.com.</small>
          </label>
          <label className="field">
            <span>Auto-refresh</span>
            <select value={P.interval} onChange={(e) => P.setIntervalPref(e.target.value)}>
              <option value="0">Off (manual only)</option>
              <option value="5">Every 5 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
            </select>
          </label>
          <div className="field">
            <span>Stat types</span>
            <div className="chips">
              {Object.entries(cfg.markets).map(([k, m]) => (
                <button type="button" key={k} className={`chip ${P.markets.includes(k) ? 'on' : ''}`} onClick={() => toggleMarket(k)}>{m.short}</button>
              ))}
            </div>
            <small className="muted">
              Each refresh costs about {P.markets.length} credit{P.markets.length === 1 ? '' : 's'} per upcoming game
              {games != null ? ` (≈${P.markets.length * games} credits for ${games} games)` : ''}. Pick fewer stat types to save credits.
            </small>
          </div>
        </div>
      </Card>
      <Card title="Add lines manually" subtitle="One per line: player, stat, line">
        <div className="form">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={cfg.example} />
          <div className="field-row">
            <button type="button" className="btn" onClick={addManual} disabled={!paste.trim()}>Add lines</button>
            {P.manual.length > 0 && <button type="button" className="btn-ghost" onClick={() => P.setManual([])}>Clear {P.manual.length} manual line{P.manual.length === 1 ? '' : 's'}</button>}
          </div>
          {msg && <ul className="form-msg">{msg.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          <small className="muted">
            Stats: pass yds, pass TDs, completions, attempts, INTs, pass+rush yds, rush yds, carries, receptions, rec yds, rush+rec yds.
          </small>
        </div>
      </Card>
    </div>
  );
}

// ---- All players board (works with no API key) ------------------------------

const BAD_STATUS = ['Out', 'IR', 'Doubtful', 'PUP', 'Sus'];
const PAGE = 40;
const clean = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function PlayerBoard({ ctx, rows, feed, manual, onSave }) {
  const cfg = useCfg();
  const { gameByTeam } = useData();
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [sort, setSort] = useState('proj');
  const [hideStarted, setHideStarted] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState(null);

  // PrizePicks / saved lines keyed by player, then market.
  const linesByPlayer = useMemo(() => {
    const m = {};
    for (const e of feed || []) ((m[normName(e.player)] ||= {})[e.market] = { line: e.line, source: e.manual ? 'saved' : 'prizepicks' });
    for (const x of manual || []) ((m[normName(x.player)] ||= {})[x.market] ||= { line: x.line, source: 'saved' });
    return m;
  }, [feed, manual]);

  const players = useMemo(() => (rows || []).filter((r) => cfg.groups.includes(cfg.groupOf(r)) && r.proj >= cfg.boardMinProj), [rows, cfg]);
  const teams = useMemo(() => [...new Set(players.map((r) => r.team))].sort(), [players]);
  const list = useMemo(() => {
    const tokens = clean(q).split(' ').filter(Boolean);
    const out = players.filter((r) => {
      if (pos !== 'ALL' && cfg.groupOf(r) !== pos) return false;
      if (team !== 'ALL' && r.team !== team) return false;
      if (hideStarted && gameByTeam[r.team] && gameByTeam[r.team].state !== 'pre') return false;
      if (!tokens.length) return true;
      const hay = `${clean(r.name)} ${r.team.toLowerCase()} ${r.pos.toLowerCase()}`;
      return tokens.every((t) => hay.includes(t));
    });
    const key = { proj: (r) => -r.proj, name: (r) => r.last, team: (r) => r.team + String(1000 - r.proj).padStart(6, '0') }[sort];
    return out.sort((a, b) => { const x = key(a); const y = key(b); return typeof x === 'string' ? x.localeCompare(y) : x - y; });
  }, [players, q, pos, team, sort, hideStarted, gameByTeam]);

  useEffect(() => setLimit(PAGE), [q, pos, team, sort, hideStarted]);
  // Opened from the floating search button: jump to and focus the player search.
  useEffect(() => {
    if (!ctx) return;
    let flag = null;
    try { flag = sessionStorage.getItem('ge:focusSearch'); sessionStorage.removeItem('ge:focusSearch'); } catch { /* ignore */ }
    if (flag) setTimeout(() => { const el = document.getElementById('pb-search'); el?.scrollIntoView({ block: 'center' }); el?.focus(); }, 300);
  }, [ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ctx) return null;

  return (
    <section className="pboard">
      <div className="pboard-head">
        <div>
          <h2 className="qc-title">All player props</h2>
          <p className="muted small">Every player with a projection this {cfg.period}. Search anyone, tap them, and type the PrizePicks line for any stat to get an instant More or Less.</p>
        </div>
        <span className="pboard-count">{list.length} <small>of {players.length} players</small></span>
      </div>
      <div className="pboard-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input id="pb-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={cfg.searchHint} autoComplete="off" spellCheck={false} />
        {q && <button type="button" className="pb-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}
      </div>
      <div className="toolbar">
        <Segmented options={['ALL', ...cfg.groups].map((g) => ({ value: g, label: g === 'ALL' ? 'ALL' : cfg.groupLabel(g) }))} value={pos} onChange={setPos} label="Position" />
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value="ALL">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort players">
          <option value="proj">Sort: projection</option>
          <option value="name">Sort: name</option>
          <option value="team">Sort: team</option>
        </select>
        <label className="check"><input type="checkbox" checked={hideStarted} onChange={(e) => setHideStarted(e.target.checked)} /> Upcoming games only</label>
      </div>
      {list.length === 0 ? (
        <Card><Empty title={`No players match “${q}”`}>Check the spelling, or clear the position and team filters. Players not playing this {cfg.period} have no projection.</Empty></Card>
      ) : (
        <div className="pb-list">
          {list.slice(0, limit).map((r) => (
            <PlayerPropRow key={r.id} r={r} ctx={ctx} lines={linesByPlayer[normName(r.name)] || {}} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} onSave={onSave} />
          ))}
          {list.length > limit && (
            <button type="button" className="more-btn card" onClick={() => setLimit((l) => l + PAGE)}>Show more players · {list.length - limit} remaining</button>
          )}
        </div>
      )}
    </section>
  );
}

function PlayerPropRow({ r, ctx, lines, open, onToggle, onSave }) {
  const cfg = useCfg();
  const { gameByTeam } = useData();
  const g = gameByTeam[r.team];
  const keys = cfg.keyMarkets[cfg.groupOf(r)] || [];
  const chips = useMemo(
    () => keys.map((m) => {
      const ln = lines[m]?.line;
      const e = cfg.evaluate({ id: `c:${r.id}|${m}`, player: r.name, market: m, line: ln ?? 0.5 }, ctx);
      return { m, e, ln };
    }),
    [r, ctx, lines], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const lineCount = Object.keys(lines).length;
  return (
    <article className={`pb-row ${open ? 'open' : ''}`}>
      <button type="button" className="pb-main" onClick={onToggle} aria-expanded={open}>
        <Avatar player={r} size={42} />
        <span className="pb-id">
          <span className="cell-name">{r.name}<InjuryDot status={r.injury} part={r.injuryPart} /></span>
          <span className="cell-meta">
            <PosBadge pos={r.pos} /> <TeamLogo abbr={r.team} size={13} /> {r.team}
            <span className="muted">{g && g.away.abbr === r.team ? '@' : 'vs'} {r.opp}</span>
            {g && <span className="pb-when">{g.state === 'pre' ? kickoff(g.date) : g.state === 'in' ? <span className="live-txt"><span className="live-dot" /> Live</span> : 'Final'}</span>}
          </span>
        </span>
        <span className="pb-chips">
          {chips.map(({ m, e, ln }) => (
            <span key={m} className={`pb-chip ${ln != null && e && e.grade.key !== 'pass' ? e.side : ''}`}>
              <small>{cfg.markets[m].short}</small>
              <strong>{e?.mean != null ? f1(e.mean) : '—'}</strong>
              {ln != null && e && <em>{e.grade.key === 'pass' ? `line ${ln}` : `${e.side === 'over' ? 'More' : 'Less'} ${ln} · ${Math.round(e.prob * 100)}%`}</em>}
            </span>
          ))}
        </span>
        {lineCount > 0 && <span className="pb-linecount" title="Lines entered or loaded for this player">{lineCount} line{lineCount === 1 ? '' : 's'}</span>}
        <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <PropSheet r={r} ctx={ctx} lines={lines} onSave={onSave} />}
    </article>
  );
}

/** Every stat market for one player: model number, recent games, and a line box. */
function PropSheet({ r, ctx, lines, onSave }) {
  const cfg = useCfg();
  const markets = cfg.marketsFor(r).map((k) => [k, cfg.markets[k]]);
  const [vals, setVals] = useState(() => Object.fromEntries(markets.map(([k]) => [k, lines[k]?.line != null ? String(lines[k].line) : ''])));
  const [saved, setSaved] = useState({});
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>Stat</span><span>Model</span><span className="hide-sm">Last 5 games</span><span>PrizePicks line</span><span>Pick</span>
      </div>
      {markets.map(([k, M]) => {
        const lineNum = parseFloat(vals[k]);
        const has = Number.isFinite(lineNum) && lineNum >= 0;
        const e = cfg.evaluate({ id: `s:${r.id}|${k}`, player: r.name, market: k, line: has ? lineNum : 0.5 }, ctx);
        if (!e || e.unmatched || e.mean == null) return null;
        const last5 = (e.recent || []).slice(-5);
        return (
          <div key={k} className="sheet-row">
            <span className="sheet-stat">{M.label}{lines[k]?.source === 'prizepicks' && <span className="tag tone-good">PP</span>}</span>
            <span className="sheet-model"><strong>{f1(e.mean)}</strong><small>{f1(Math.max(0, e.mean - (e.sd || Math.sqrt(e.mean))))}–{f1(e.mean + (e.sd || Math.sqrt(e.mean)))}</small></span>
            <span className="sheet-last hide-sm">
              {last5.length ? last5.map((h) => <span key={h.week} className={has ? (h.val > lineNum ? 'o' : h.val < lineNum ? 'u' : 'p') : ''} title={h.label || `Wk ${h.week} vs ${h.opp}`}>{Math.round(h.val * 10) / 10}</span>) : <span className="muted">—</span>}
            </span>
            <span className="sheet-input">
              <input
                type="number" inputMode="decimal" step="0.5" min="0" aria-label={`${M.label} line`}
                value={vals[k]} placeholder={(Math.round(e.mean * 2) / 2).toFixed(1)}
                onChange={(ev) => { setVals((v) => ({ ...v, [k]: ev.target.value })); setSaved((x) => ({ ...x, [k]: false })); }}
              />
            </span>
            <span className="sheet-pick">
              {has ? (
                <>
                  <PickBadge e={e} size="sm" />
                  <button type="button" className={`star ${saved[k] ? 'on' : ''}`} title="Save to your lines" aria-label="Save line" onClick={() => { onSave({ player: r.name, market: k, line: lineNum }); setSaved((x) => ({ ...x, [k]: true })); }}>
                    {saved[k] ? '★' : '☆'}
                  </button>
                </>
              ) : <span className="muted small">Enter line</span>}
            </span>
          </div>
        );
      })}
      <p className="muted small sheet-note">Model = projected stat this {cfg.period} (range covers about 2 of 3 outcomes). Enter the PrizePicks number to see More or Less with its probability. Tap ☆ to keep it in your saved lines.</p>
    </div>
  );
}

// ---- Highest-chance props ------------------------------------------------------
// For each player and stat, find the highest line that still clears a target
// probability, then keep only lines the player has also cleared consistently.

const Z_UPPER = { 0.7: 0.5244, 0.75: 0.6745, 0.8: 0.8416 };

// Backtests on this season's games showed raw spreads are too tight: lines the model
// rated 75% hit ~64%. Widening the spread by this factor brings hit rates back in line.
export const SAFE_SD_MULT = 1.5;

/**
 * Highest line with at least `target` chance to go over, using a calibrated spread.
 * Count stats (Poisson) use sqrt(mean) as their base spread. Returns { line, prob } or null.
 */
export function safeLine(M, mean, sd, target, mult = SAFE_SD_MULT) {
  if (!(mean > 0)) return null;
  const count = M.dist === 'poisson' || (M.poissonBelow && mean < M.poissonBelow);
  const s = mult * (count ? Math.sqrt(mean) : sd);
  if (!(s > 0)) return null;
  const line = Math.floor(mean - Z_UPPER[target] * s - 0.5) + 0.5;
  if (line < 0.5) return null;
  return { line, prob: probabilities('normal', mean, s, line).over };
}

/**
 * Highest-chance "More" picks: for each player and stat, the highest line that still
 * clears `target` model chance, kept when the player has cleared it in most recent games
 * and the line is realistic. One (best) stat per player, ranked by consistency.
 */
export function buildSafePicks(cfg, ctx, rows, target, gameByTeam = {}) {
  if (!ctx || !rows) return [];
  const out = [];
  for (const r of rows) {
    const safe = cfg.safeMarkets[cfg.groupOf(r)];
    if (!safe || r.injury || r.proj < cfg.safeMinProj) continue;
    for (const m of safe) {
      const base = cfg.evaluate({ id: `h0:${r.id}|${m}`, player: r.name, market: m, line: 0.5 }, ctx);
      if (!base || base.unmatched || !base.mean || base.games < 4) continue;
      const cal = safeLine(cfg.markets[m], base.mean, base.sd, target);
      const line = cal?.line;
      // Real PrizePicks lines sit near the projection; skip "safe" lines far below it.
      if (line == null || line < (cfg.minLine[m] ?? 0.5) || line / base.mean < 0.6) continue;
      const e = cfg.evaluate({ id: `h:${r.id}|${m}`, player: r.name, market: m, line }, ctx);
      if (!e || !e.recent?.length) continue;
      const hits = e.recent.filter((h) => h.over).length;
      const hitRate = hits / e.recent.length;
      if (hitRate < 0.6) continue;
      const g = gameByTeam[r.team];
      out.push({
        key: `${cfg.sport}:${e.id}`, playerId: r.id, player: r.name, first: r.first, last: r.last, pos: r.pos, group: cfg.groupOf(r), team: r.team, opp: r.opp,
        game: `${cfg.sport}:${g ? g.id : [r.team, r.opp].sort().join('-')}`, state: g?.state || 'pre', date: g?.date, gameTime: g?.date, gameId: g?.id, week: ctx.week,
        market: m, stat: cfg.markets[m].short, statLabel: cfg.markets[m].label, sport: cfg.sport, side: 'over', line, prob: cal.prob, rawProb: e.pOver, mean: e.mean,
        hits, n: e.recent.length, recent: e.recent, cushion: line / e.mean, actual: e.result?.actual, matchup: e.matchup, injury: e.injury,
        // Rank: consistency first, then how realistic (close to the projection) the line is, then model chance.
        score: 0.45 * hitRate + 0.35 * Math.min(1, line / e.mean) + 0.2 * cal.prob,
      });
    }
  }
  // Keep each player's single best stat so the list isn't one player repeated.
  const bestByPlayer = new Map();
  for (const p of out.sort((a, b) => b.score - a.score)) if (!bestByPlayer.has(p.playerId)) bestByPlayer.set(p.playerId, p);
  return [...bestByPlayer.values()];
}

function HighChance({ ctx, rows, onSave }) {
  const cfg = useCfg();
  const { gameByTeam } = useData();
  const { openPlayer } = useUi();
  const [target, setTarget] = useState(0.75);
  const [pos, setPos] = useState('ALL');
  const [upcoming, setUpcoming] = useState(true);
  const [limit, setLimit] = useState(12);
  const [saved, setSaved] = useState({});

  const picks = useMemo(() => buildSafePicks(cfg, ctx, rows, target, gameByTeam), [ctx, rows, target, gameByTeam, cfg]);

  const shown = picks.filter((p) => (pos === 'ALL' || p.group === pos) && (!upcoming || p.state === 'pre'));
  const upcomingCount = picks.filter((p) => p.state === 'pre').length;

  return (
    <section className="hc">
      <div className="pboard-head">
        <div>
          <h2 className="qc-title">Highest-chance props</h2>
          <p className="muted small">
            For every player and stat, the highest line that still has a {Math.round(target * 100)}%+ model chance to go <strong>More</strong>, kept only if the player has cleared it in most recent games. Injured and questionable players are left out.
            If PrizePicks shows a line <strong>at or below</strong> one of these numbers (Goblin lines often are), it’s a high-chance More.
          </p>
        </div>
        <span className="pboard-count">{shown.length} <small>picks</small></span>
      </div>
      <div className="toolbar">
        <Segmented options={[{ value: 0.7, label: '70%+' }, { value: 0.75, label: '75%+' }, { value: 0.8, label: '80%+' }]} value={target} onChange={setTarget} label="Minimum chance" />
        <Segmented options={['ALL', ...cfg.groups].map((g) => ({ value: g, label: g === 'ALL' ? 'ALL' : cfg.groupLabel(g) }))} value={pos} onChange={setPos} label="Position" />
        <label className="check"><input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} /> Upcoming games only</label>
      </div>
      {shown.length === 0 ? (
        <Empty title={upcoming && upcomingCount === 0 ? `No upcoming games left this ${cfg.period}` : 'No picks clear this bar'}>
          {upcoming && upcomingCount === 0 ? `Untick “Upcoming games only” to see how this ${cfg.period}’s picks did, or check back when the next projections post.` : 'Try 70%+ or another position.'}
        </Empty>
      ) : (
        <>
          <div className="hc-grid">
            {shown.slice(0, limit).map((p, i) => (
              <article key={p.key} className={`hc-card ${p.state !== 'pre' ? 'played' : ''}`}>
                <button type="button" className="hc-top" onClick={() => openPlayer(p.playerId)}>
                  <span className="hc-rank">{i + 1}</span>
                  <Avatar player={{ id: p.playerId, sport: p.sport, pos: p.pos, team: p.team, first: p.first, last: p.last }} size={40} />
                  <span className="hc-name"><strong>{p.player}</strong><small>{p.pos} · {p.team} vs {p.opp}{p.state === 'pre' && p.date ? ` · ${kickoff(p.date)}` : ''}</small></span>
                </button>
                <div className="hc-line">
                  <span className="hc-side">MORE</span>
                  <strong>{p.line}</strong>
                  <span className="hc-stat">{p.statLabel}</span>
                </div>
                <div className="hc-meter" title={`${Math.round(p.prob * 100)}% model chance`}><span style={{ width: `${p.prob * 100}%` }} /></div>
                <div className="hc-foot">
                  <span><strong>{Math.round(p.prob * 100)}%</strong> chance</span>
                  <span>Hit <strong>{p.hits}/{p.n}</strong> recent</span>
                  <span>Model <strong>{f1(p.mean)}</strong></span>
                </div>
                <div className="hc-bottom">
                  <HitDots recent={p.recent} line={p.line} />
                  {p.state !== 'pre' && p.actual != null ? (
                    <span className={`result-chip ${p.state === 'post' ? (p.actual > p.line ? 'hit' : 'miss') : 'live'}`}>{p.state === 'post' ? (p.actual > p.line ? 'HIT' : 'MISS') : 'LIVE'} · {f1(p.actual)}</span>
                  ) : (
                    <button type="button" className={`star ${saved[p.key] ? 'on' : ''}`} title="Save to your lines" aria-label="Save pick" onClick={() => { onSave({ player: p.player, market: p.market, line: p.line }); setSaved((x) => ({ ...x, [p.key]: true })); }}>{saved[p.key] ? '★' : '☆'}</button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {shown.length > limit && <button type="button" className="more-btn card" onClick={() => setLimit((l) => l + 12)}>Show more · {shown.length - limit} remaining</button>}
          <SlipBuilder
            title="Safest slip builder"
            subtitle="Stacks the highest-chance picks above, one per game, so a single game can’t sink the whole entry"
            picks={shown.map((p) => ({ ...p, stat: p.stat }))}
          />
        </>
      )}
    </section>
  );
}

/** Builds a 2–6 leg entry from the highest-probability picks, max one per game. */
function SlipBuilder({ title, subtitle, picks }) {
  const cfg = useCfg();
  const [size, setSize] = useState(3);
  const legs = [];
  const used = new Set();
  for (const p of [...picks].sort((a, b) => (b.score ?? b.prob) - (a.score ?? a.prob))) {
    if (legs.length >= size) break;
    if (used.has(p.game)) continue;
    used.add(p.game);
    legs.push(p);
  }
  if (picks.length < 2) return null;
  const combined = legs.reduce((a, p) => a * p.prob, 1);
  return (
    <div className="slip">
      <div className="slip-head">
        <div>
          <h3 className="slip-title">{title}</h3>
          <p className="muted small">{subtitle}</p>
        </div>
        <Segmented size="sm" options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} picks` }))} value={size} onChange={setSize} label="Slip size" />
      </div>
      <ol className="slip-legs">
        {legs.map((p) => (
          <li key={p.key}>
            <span className="slip-player"><strong>{p.player}</strong><small>{p.team} vs {p.opp}</small></span>
            <span className={`slip-pick ${p.side}`}>{p.side === 'over' ? 'More' : 'Less'} {p.line} {p.stat}</span>
            <span className="slip-prob">{Math.round(p.prob * 100)}%</span>
          </li>
        ))}
      </ol>
      <div className="slip-total">
        <span>All {legs.length} hit (model estimate)</span>
        <strong>{Math.round(combined * 100)}%</strong>
      </div>
      <SaveSlipButton legs={legs} title={`${legs.length}-pick ${cfg.sport.toUpperCase()} slip`} source="builder" />
      {legs.length < size && <p className="muted small">Only {legs.length} games have a qualifying pick right now.</p>}
      <p className="muted small slip-note">Each leg is a separate estimate. Real results vary, so play only what you can afford to lose.</p>
    </div>
  );
}
