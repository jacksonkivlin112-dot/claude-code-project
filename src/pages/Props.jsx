import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData, usePersistentState } from '../data.jsx';
import { DEFAULT_MARKETS, MARKETS, fetchPrizePicksLines, listEvents, normName } from '../oddsapi.js';
import { BREAKEVEN, buildLookups, evaluateProp, parseManual } from '../propsModel.js';
import { useProjectionRows, useTeamOutlook } from '../components/players.jsx';
import { Avatar, Card, Empty, InjuryDot, PosBadge, Segmented, SkeletonRows, TeamLogo, WeeklyBars, f1, kickoff, timeAgo, useNow, useUi } from '../components/ui.jsx';

const LS = {
  key: 'ge:pref:oddsKey',
  manual: 'ge:props:manual',
  lines: 'ge:props:lastLines',
  live: 'ge:props:live',
};
const readJSON = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/** Remember the last line seen for each prop so line moves can be flagged. */
function withMovement(props) {
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

function usePropLines() {
  const [snapshot, setSnapshot] = useState(null); // {generatedAt, props} | false
  const [live, setLive] = useState(() => readJSON(LS.live, null)); // {fetchedAt, props, remaining}
  const [manual, setManualState] = useState(() => readJSON(LS.manual, []));
  const [apiKey, setApiKeyState] = useState(() => { try { return localStorage.getItem(LS.key) || ''; } catch { return ''; } });
  const [interval, setIntervalPref] = usePersistentState('propsInterval', '15');
  const [marketsPref, setMarketsPref] = usePersistentState('propsMarkets', DEFAULT_MARKETS.join(','));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const markets = marketsPref.split(',').filter((m) => MARKETS[m]);

  const setManual = (v) => { setManualState(v); writeJSON(LS.manual, v); };
  const setApiKey = (k) => {
    setApiKeyState(k);
    try { if (k) localStorage.setItem(LS.key, k); else localStorage.removeItem(LS.key); } catch { /* ignore */ }
  };

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/props.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : false))
      .then((j) => setSnapshot(j && Array.isArray(j.props) ? { ...j, props: withMovement(j.props) } : false))
      .catch(() => setSnapshot(false));
  }, []);

  const refresh = useCallback(async () => {
    if (!apiKey) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchPrizePicksLines(apiKey, { markets });
      const data = { fetchedAt: new Date().toISOString(), props: withMovement(res.props), remaining: res.remaining, used: res.used, games: res.events };
      setLive(data);
      writeJSON(LS.live, data);
    } catch (e) {
      setErr(e.status === 401 ? 'That API key was rejected.' : e.code === 'OUT_OF_USAGE_CREDITS' ? 'Your Odds API credits are used up for this period.' : e.message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, markets.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

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
    lines, source, asOf, snapshotLoaded: snapshot !== null, live, manual, setManual, apiKey, setApiKey,
    interval, setIntervalPref, markets, setMarkets: (arr) => setMarketsPref(arr.join(',')), refresh, busy, err,
  };
}

const GRADE_ORDER = { strong: 3, solid: 2, lean: 1, pass: 0 };

export default function Props() {
  const { core, season, ranks, liveById, gameByTeam, teams } = useData();
  const rows = useProjectionRows(core?.week);
  const outlook = useTeamOutlook();
  const P = usePropLines();
  useNow(30000);

  const [market, setMarket] = useState('ALL');
  const [side, setSide] = useState('ALL');
  const [minGrade, setMinGrade] = useState('lean');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('prob');
  const [showSettings, setShowSettings] = useState(false);
  const [showStarted, setShowStarted] = useState(false);

  const evaluated = useMemo(() => {
    if (!rows || !outlook) return null;
    const ctx = {
      lookups: buildLookups(rows, season, teams),
      season,
      ranks,
      outlookByTeam: Object.fromEntries(outlook.teams.map((t) => [t.abbr, t])),
      leagueAvg: outlook.leagueAvg,
      liveById,
      gameByTeam,
    };
    return P.lines.map((l) => evaluateProp(l, ctx)).filter(Boolean);
  }, [rows, outlook, P.lines, season, ranks, liveById, gameByTeam, teams]);

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
          <h1>PrizePicks Over / Under</h1>
          <p className="hero-sub">
            Each line is run through our model: projection, season and recent form, opponent matchup, game script and injuries. The result is a hit probability for the over and the under. Picks need to clear PrizePicks’ ~{Math.round(BREAKEVEN * 1000) / 10}% per-leg break-even to count as an edge.
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
      ) : P.lines.length === 0 ? (
        <NoLines onSetup={() => setShowSettings(true)} />
      ) : (
        <>
          {best.length > 0 && (
            <section>
              <div className="section-head"><h2>Best plays</h2><span className="muted small">Highest model confidence among open lines</span></div>
              <div className="best-grid">{best.map((e) => <BestCard key={e.id} e={e} />)}</div>
            </section>
          )}

          {graded.length > 0 && (
            <div className="record-bar">
              <span>Model record this week (graded picks):</span>
              <strong className={wins / graded.length >= BREAKEVEN ? 'pos-txt' : 'neg-txt'}>{wins}-{graded.length - wins}</strong>
              <span className="muted">{Math.round((wins / graded.length) * 100)}% hit rate</span>
            </div>
          )}

          <div className="toolbar">
            <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Stat type">
              <option value="ALL">All stats</option>
              {marketsPresent.map((m) => <option key={m} value={m}>{MARKETS[m].label}</option>)}
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
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player or team" aria-label="Search props" />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="prob">Sort: confidence</option>
              <option value="edge">Sort: gap vs line</option>
              <option value="time">Sort: kickoff</option>
            </select>
            <label className="check"><input type="checkbox" checked={showStarted} onChange={(e) => setShowStarted(e.target.checked)} /> Include started games</label>
          </div>

          {filtered.length === 0 ? (
            <Card><Empty title="No props match these filters">Try “All lines” or another stat type.</Empty></Card>
          ) : (
            <div className="props-list">{filtered.map((e) => <PropRow key={e.id} e={e} />)}</div>
          )}
        </>
      )}

      <p className="disclaimer">
        Model estimates for research and entertainment only, with no guaranteed outcomes. Gridiron Edge is not affiliated with PrizePicks. Lines come from The Odds API and can lag the app. Always confirm on PrizePicks before entering. Play responsibly. 18+/21+ where legal. Help: 1-800-GAMBLER.
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
  if (P.source === 'snapshot') return <span className="source-pill">PrizePicks lines · updated {timeAgo(new Date(P.asOf).getTime())}</span>;
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
        <span key={h.week} className={`hd ${h.push ? 'push' : h.over ? 'over' : 'under'}`} title={`Wk ${h.week} vs ${h.opp}: ${f1(h.val)} (${h.push ? 'push' : h.over ? 'over' : 'under'} ${line})`} />
      ))}
    </span>
  );
}

function BestCard({ e }) {
  const { openPlayer } = useUi();
  return (
    <button type="button" className={`best-card ${e.side}`} onClick={() => e.playerId && openPlayer(e.playerId)}>
      <div className="best-top">
        <Avatar player={{ id: e.playerId || '0', pos: e.pos, team: e.team, first: e.player.split(' ')[0], last: e.player.split(' ').slice(-1)[0] }} size={40} />
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
  const playerish = { id: e.playerId || '0', pos: e.pos, team: e.team, first: e.player.split(' ')[0], last: e.player.split(' ').slice(-1)[0] };
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
            <h3>{e.marketShort} by week vs line</h3>
            {e.recent?.length ? (
              <WeeklyBars
                height={150}
                maxWeek={Math.max(...e.recent.map((h) => h.week))}
                refLine={e.line}
                refLabel="line"
                data={e.recent.map((h) => ({ week: h.week, value: h.val, label: `vs ${h.opp}`, tone: h.over ? 'up' : 'down' }))}
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
  return (
    <Card>
      <div className="nolines">
        <Empty title="No PrizePicks lines loaded yet">
          PrizePicks has no public API and blocks automated requests. Lines come from The Odds API, which carries PrizePicks player props, or you can add them yourself.
        </Empty>
        <ol className="steps">
          <li><strong>Site-wide (recommended):</strong> add an <code>ODDS_API_KEY</code> repository secret. The scheduled GitHub Action then refreshes lines for everyone.</li>
          <li><strong>Just this browser:</strong> paste your own The Odds API key under <em>Line sources</em> to auto-refresh lines while this page is open.</li>
          <li><strong>Manual:</strong> paste lines straight from the PrizePicks app, like <code>Josh Allen, Pass Yards, 245.5</code>.</li>
        </ol>
        <button type="button" className="btn" onClick={onSetup}>Set up line sources</button>
      </div>
    </Card>
  );
}

function SourceSettings({ P, rows }) {
  const [keyInput, setKeyInput] = useState(P.apiKey);
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState(null);
  const [games, setGames] = useState(null);

  useEffect(() => {
    if (!P.apiKey) return;
    listEvents(P.apiKey)
      .then((ev) => setGames(ev.filter((e) => { const t = new Date(e.commence_time).getTime(); return t > Date.now() && t - Date.now() < 8 * 86400000; }).length))
      .catch(() => setGames(null));
  }, [P.apiKey]);

  const addManual = () => {
    const { rows: parsed, errors } = parseManual(paste);
    const names = new Set((rows || []).map((r) => normName(r.name)));
    const unknown = parsed.filter((p) => !names.has(normName(p.player))).map((p) => p.player);
    const merged = [...P.manual.filter((m) => !parsed.some((p) => normName(p.player) === normName(m.player) && p.market === m.market)), ...parsed.map((p) => ({ ...p, added: Date.now() }))];
    P.setManual(merged);
    setPaste('');
    setMsg([
      `Added ${parsed.length} line${parsed.length === 1 ? '' : 's'}.`,
      ...errors,
      ...(unknown.length ? [`Not projected this week (check spelling, or the player may be injured or on bye): ${unknown.join(', ')}`] : []),
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
              {Object.entries(MARKETS).map(([k, m]) => (
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
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={'Josh Allen, Pass Yards, 245.5\nBijan Robinson Rush Yds 82.5\nPuka Nacua, Receptions, 6.5'} />
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
