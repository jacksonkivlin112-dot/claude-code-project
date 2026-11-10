import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TeamLogo } from '../components/ui.jsx';
import { runOcr } from './Scan.jsx';
import { parseSlipText, repairLine } from '../slipParse.js';
import { buildRoster, nextGame } from '../slipRoster.js';
import { buildSafePicks } from './Props.jsx';
import { normName } from '../oddsapi.js';
import { CFGS, SPORT_LABEL } from '../dualSport.jsx';
import { fmtVal, legGame, legInjury, liveChance, money, useSlipsHub } from '../slipsLive.jsx';
import { defaultMult, deleteSlip, saveSlip, setBet } from '../slips.js';
import { PAYOUTS } from '../slipMath.js';
import { LegBar } from '../components/Tracking.jsx';
import { Avatar, Card, Empty, kickoff, timeAgo, useNow } from '../components/ui.jsx';


const lastGame = (s) => Math.max(s.created || 0, ...s.legs.map((l) => new Date(l.gameTime || 0).getTime()));

export default function Slips({ params }) { return <SlipsPage params={params} />; }
export function NbaSlipsRoute({ params }) { return <SlipsPage params={params} />; }

function SlipsPage({ params }) {
  const { view, sports } = useSlipsHub();
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  useNow(30000);

  const ask = async () => { try { setPerm(await Notification.requestPermission()); } catch { /* ignore */ } };
  // A slip is finished once every leg is decided (a Flex slip can still pay after a miss).
  const active = view.filter((v) => v.st.open > 0);
  const settled = view.filter((v) => v.st.open === 0).sort((a, b) => lastGame(b.slip) - lastGame(a.slip));
  const [tab, setTab] = useState('open');
  const [openId, setOpenId] = useState(() => params?.get?.('entry') || null);
  const openView = view.find((v) => v.slip.id === openId) || null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Tracking</p>
          <h1>My slips</h1>
          <p className="hero-sub">Every slip you save from Props, the Parlay Builder or Slip Scan, followed leg by leg with live stats. Results stay here after the games end.</p>
        </div>
        <div className="props-status">
          {perm === 'granted' ? <span className="source-pill"><span className="live-dot" /> Alerts on</span>
            : perm === 'denied' ? <span className="source-pill muted" title="Turn notifications back on in your browser's site settings">Alerts blocked</span>
            : perm === 'unsupported' ? <span className="source-pill muted" title="On iPhone, add the app to your home screen first">Alerts need the installed app</span>
            : <button type="button" className="btn" onClick={ask}>🔔 Alert me when legs hit</button>}
        </div>
      </div>
      <nav className="ent-tabs">
        <button type="button" className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Open</button>
        <button type="button" className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Past</button>
      </nav>
      {tab === 'open' ? (
        <>
          <div className="ent-tiles">
            <div><b>{active.length}</b><span>{active.length === 1 ? 'Entry' : 'Entries'} open</span></div>
            <div><b>{money(active.reduce((a, v) => a + (toWin(v.slip) || 0), 0))}</b><span>Potential winnings</span></div>
          </div>
          <PickOfDay sports={sports} />
          <Bankroll view={view} />
          <UploadSlip sports={sports} />
          {active.length === 0 ? (
            <Card><Empty title="No open entries">Upload a slip screenshot above, or tap <strong>☆ Save slip & track live</strong> on a slip in Props or the Parlay Builder.</Empty></Card>
          ) : (
            <>
              {[['Live', active.filter((v) => v.sts.some((x) => x.state === 'live') || v.st.hit || v.st.miss)], ['Upcoming', active.filter((v) => !(v.sts.some((x) => x.state === 'live') || v.st.hit || v.st.miss))]].map(([label, list]) => list.length > 0 && (
                <section key={label} className="ent-sec">
                  <h3>{label}</h3>
                  {list.map((v) => <EntryCard key={v.slip.id} v={v} sports={sports} onOpen={() => setOpenId(v.slip.id)} />)}
                </section>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          {settled.length > 0 ? <BetRecord settled={settled} openCount={active.length} /> : <Card><Empty title="No finished entries yet">Entries move here once every pick is decided.</Empty></Card>}
          {settled.length > 0 && <BetInsights settled={settled} />}
          {settled.length > 0 && <Bankroll view={view} />}
          <section className="ent-sec">{settled.map((v) => <EntryCard key={v.slip.id} v={v} onOpen={() => setOpenId(v.slip.id)} />)}</section>
        </>
      )}
      {openView && <EntrySheet v={openView} sports={sports} onClose={() => setOpenId(null)} />}
      <p className="disclaimer">Slips are stored on this device. Live stats refresh about every minute while games are on. Alerts fire while the app is open (or running in the background where your phone allows it).</p>
    </div>
  );
}

function SlipCard({ v }) {
  const { slip, sts, st } = v;
  const [confirm, setConfirm] = useState(false);
  const probs = slip.legs.map((l) => l.prob).filter((p) => p != null);
  const chance = probs.length === slip.legs.length ? probs.reduce((a, b) => a * b, 1) : null;
  return (
    <article className={`slipc ${st.key}`}>
      <header className="slipc-head">
        <div>
          <strong>{slip.title}</strong>
          <small>Saved {timeAgo(slip.created)}{chance != null ? ` · model chance ${Math.round(chance * 100)}%` : ''}</small>
        </div>
        <span className={`slipc-state ${st.key}`}>{st.key === 'live' && <span className="live-dot" />}{st.label}</span>
      </header>
      <ol className="slipc-legs">
        {slip.legs.map((l, i) => {
          const s = sts[i];
          const name = l.player.split(' ');
          return (
            <li key={i} className={`slipc-leg ${s.state === 'final' ? (s.push ? 'push' : s.hit ? 'hit' : 'miss') : s.state}`}>
              <span className="slipc-av">
                <Avatar player={{ id: l.playerId, sport: l.sport, team: l.team, first: name[0], last: name.slice(-1)[0] }} size={44} />
                {s.state === 'final' && <span className={`lf-oc ${s.push ? 'to' : s.hit ? 'made' : 'miss'}`}>{s.push ? '–' : s.hit ? '✓' : '✕'}</span>}
              </span>
              <span className="slipc-main">
                <strong>{l.player} <small>{SPORT_LABEL[l.sport]} · {l.team}{l.opp ? ` vs ${l.opp}` : ''}</small></strong>
                <span className={`slipc-pick ${l.side}`}>{l.side === 'over' ? 'More' : 'Less'} {l.line} {l.stat}</span>
                <LegBar leg={l} st={s} />
              </span>
              <span className="slipc-val">
                {s.state === 'pending' || s.state === 'loading' ? <small>{l.gameTime ? kickoff(l.gameTime) : s.state === 'loading' ? 'Loading…' : 'Upcoming'}</small>
                  : s.state === 'void' ? <small>Void · didn’t play</small>
                  : <><b>{fmtVal(s.actual)}</b><small>{s.state === 'live' ? 'live' : 'final'}</small></>}
              </span>
            </li>
          );
        })}
      </ol>
      <BetLine v={v} />
      <footer className="slipc-foot">
        {confirm ? (
          <>
            <span className="muted small">Delete this slip?</span>
            <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Keep</button>
            <button type="button" className="btn-ghost danger" onClick={() => deleteSlip(slip.id)}>Delete</button>
          </>
        ) : <button type="button" className="link small" onClick={() => setConfirm(true)}>Delete</button>}
      </footer>
    </article>
  );
}

/** Upload a slip screenshot: read it on the device, check the legs, then track it here. */
function UploadSlip({ sports }) {
  const inputRef = useRef();
  const [status, setStatus] = useState(null); // {phase, progress, done, ok}
  const [drafts, setDrafts] = useState(null); // what was read, editable
  const [preview, setPreview] = useState(null);
  const ready = !!sports.nfl.ctx || !!sports.nba.ctx;

  const roster = useMemo(() => buildRoster(sports), [sports.nfl.rows, sports.nba.rows, sports.nfl.ctx, sports.nba.ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const bySport = (sp) => sports[sp];

  const rosterOf = (sp, name) => roster.find((x) => x.sport === sp && normName(x.name) === normName(name));
  const expectFor = (sp, name, market) => { const r = rosterOf(sp, name); const M = CFGS[sp]?.markets[market]; return r?.s && M ? M.get(r.s) : null; };
  // When the stat couldn't be read, suggest the stat whose usual value best fits the line.
  const COMMON = {
    nba: ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists', 'player_rebounds_assists'],
    nfl: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_rush_reception_yds', 'player_pass_completions', 'player_rush_attempts'],
  };
  const guessMarket = (sp, name, line) => {
    let best = null;
    for (const m of COMMON[sp] || []) {
      const ex = expectFor(sp, name, m);
      if (!(ex > 0)) continue;
      const sc = Math.abs(Math.log(line / ex));
      if (!best || sc < best.sc) best = { m, sc };
    }
    return best && best.sc < 0.5 ? best.m : null;
  };
  const prepare = (found) => found.map((l) => {
    const sp = l.sport || roster.find((r) => normName(r.name) === normName(l.player))?.sport;
    if (!l.market && sp && l.line != null) {
      const g = guessMarket(sp, l.player, Number(l.line) % 1 ? Number(l.line) : Number(l.line) + 0.5);
      // With the stat known, the decimal repair can run (24 -> 24.5).
      if (g) return { ...l, sport: sp, market: g, guessed: true, line: Number(l.line) % 1 ? Number(l.line) : repairLine(Number(l.line), false, g, rosterOf(sp, l.player)) };
    }
    return { ...l, sport: sp };
  });
  const legs = useMemo(() => (drafts ? resolve(drafts) : null), [drafts, sports]); // eslint-disable-line react-hooks/exhaustive-deps

  // Turn parsed legs into trackable legs using each league's model (player id, team, game time, chance).
  function resolve(found) { return found.map((l, i) => {
    const sp = l.sport || roster.find((r) => normName(r.name) === normName(l.player))?.sport;
    const S = sp && bySport(sp);
    const cfg = sp && CFGS[sp];
    if (!S?.ctx || !cfg || !l.market || l.line == null) return { ...l, sport: sp, problem: !l.market ? 'stat not read' : l.line == null ? 'line not read' : 'player not found' };
    const e = cfg.evaluate({ id: `up:${i}`, player: l.player, market: l.market, line: Number(l.line) }, S.ctx);
    if (!e || e.unmatched || !e.playerId) {
      // Not on the loaded slate (e.g. a game tomorrow): track from the season roster and schedule.
      const r = roster.find((x) => x.sport === sp && normName(x.name) === normName(l.player));
      if (!r) return { ...l, sport: sp, problem: 'player not found' };
      const g2 = nextGame(S.ctx, r.team);
      return {
        sport: sp, playerId: r.id, player: r.name, team: r.team, opp: g2 ? (g2.home.abbr === r.team ? g2.away.abbr : g2.home.abbr) : null,
        market: l.market, stat: cfg.markets[l.market].short, line: Number(l.line), side: l.side || 'over', prob: null,
        gameTime: g2?.date || null, gameId: g2?.id || null, week: S.ctx.week ?? null,
      };
    }
    const g = S.ctx.gameByTeam?.[e.team] || nextGame(S.ctx, e.team);
    return {
      sport: sp, playerId: e.playerId, player: e.player, team: e.team, opp: e.opp, market: l.market, stat: cfg.markets[l.market].short,
      line: Number(l.line), side: l.side || 'over', prob: (l.side || 'over') === 'under' ? e.pUnder : e.pOver,
      gameTime: e.commence || g?.date || null, gameId: g?.id || null, week: S.ctx.week ?? null,
    };
  }).map((x, i) => {
    // Flag readings that don't fit the player (e.g. 99.5 points + assists for a 30-a-game scorer).
    const ex = x.problem ? null : expectFor(x.sport, x.player, x.market);
    // Small-count stats (TDs, steals) sit at 0.5 no matter the average, so also need a real gap.
    const odd = ex > 0 && x.line > 0.5 && Math.abs(x.line - ex) >= 1.5 && (x.line / ex > 2.2 || x.line / ex < 0.4);
    return { ...x, guessed: found[i].guessed, odd, expected: ex };
  }); }

  const onFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPreview(URL.createObjectURL(file));
    setDrafts(null);
    setStatus({ phase: 'Reading your slip…', progress: 0 });
    try {
      const text = await runOcr(file, (pr) => setStatus({ phase: 'Reading your slip…', progress: pr }));
      const found = parseSlipText(text, roster, (pl) => CFGS[pl.sport]?.aliases);
      window.__geScan = { text, found }; // last scan, for debugging and tests
      const prepared = prepare(found);
      setDrafts(prepared);
      const out = resolve(prepared);
      const good = out.filter((l) => !l.problem).length;
      setStatus({ phase: good ? `Found ${good} pick${good === 1 ? '' : 's'}${out.length > good ? ` (${out.length - good} couldn’t be matched)` : ''}` : 'Couldn’t find any picks in that image.', done: true, ok: good > 0 });
    } catch (e) {
      setStatus({ phase: `Couldn’t read the image (${e.message}).`, done: true, ok: false });
    }
  };

  const good = (legs || []).filter((l) => !l.problem);
  const [stake, setStake] = useState('');
  const [mode, setMode] = useState('power');
  const track = () => {
    saveSlip({ title: `${good.length}-pick slip (uploaded)`, source: 'upload', legs: good, bet: Number(stake) > 0 ? { stake, mode, mult: mode === 'power' ? defaultMult(good.length) : null } : null });
    setDrafts(null); setStatus({ phase: `Tracking ${good.length} picks ✓`, done: true, ok: true }); setPreview(null);
  };
  const toScan = () => {
    try { localStorage.setItem('ge:scan:prefill', JSON.stringify((legs || []).map((l) => ({ sport: l.sport, player: l.player, market: l.market, line: l.line, side: l.side || 'over' })))); } catch { /* ignore */ }
    window.location.hash = `/${legs?.[0]?.sport === 'nba' ? 'nba/' : ''}scan`;
  };

  return (
    <section className={`up-slip ${legs ? 'open' : ''}`}>
      <div className="up-row">
        {preview ? <img className="up-thumb" src={preview} alt="Your slip" /> : <span className="up-ico" aria-hidden>📷</span>}
        <div className="up-text">
          <strong>Upload a slip to track it</strong>
          <small>{status ? status.phase : 'Screenshot from PrizePicks or any app. It’s read on your phone and never uploaded anywhere.'}</small>
          {status && !status.done && <span className="lbar pace"><span className="lbar-fill" style={{ width: `${Math.round((status.progress || 0) * 100)}%` }} /></span>}
        </div>
        <button type="button" className="btn" disabled={!ready || (status && !status.done)} onClick={() => inputRef.current?.click()}>{ready ? (legs ? 'Another' : 'Upload') : 'Loading…'}</button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {legs && legs.length > 0 && (
        <>
          <p className="muted small up-hint">Check each pick against your slip. Tap a line or stat to fix it.</p>
          <ol className="up-legs">
            {legs.map((l, i) => {
              const cfg = CFGS[l.sport];
              const set = (patch) => setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, ...patch, guessed: patch.market ? false : d.guessed } : d)));
              return (
                <li key={i} className={`${l.problem && l.problem !== 'stat not read' ? 'bad' : ''} ${l.odd ? 'odd' : ''}`}>
                  <div className="up-leg-top">
                    <b>{l.player}</b>
                    <span className="muted small">{SPORT_LABEL[l.sport] || ''}{l.team ? ` · ${l.team}` : ''}{l.opp ? ` vs ${l.opp}` : ''}</span>
                    <button type="button" className="up-x" onClick={() => setDrafts((ds) => ds.filter((_, k) => k !== i))} aria-label={`Remove ${l.player}`}>✕</button>
                  </div>
                  {cfg ? (
                    <div className="up-leg-edit">
                      <div className="seg up-side">
                        <button type="button" className={l.side !== 'under' ? 'on' : ''} onClick={() => set({ side: 'over' })}>More</button>
                        <button type="button" className={l.side === 'under' ? 'on' : ''} onClick={() => set({ side: 'under' })}>Less</button>
                      </div>
                      <input className="up-line" type="number" inputMode="decimal" step="0.5" value={l.line ?? ''} placeholder="Line" onChange={(e) => set({ line: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Line" />
                      <select className="up-stat" value={l.market || ''} onChange={(e) => set({ market: e.target.value || null })} aria-label="Stat">
                        <option value="">Pick stat…</option>
                        {Object.entries(cfg.markets).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                      </select>
                      <em>{l.prob != null ? `${Math.round(l.prob * 100)}%` : ''}</em>
                    </div>
                  ) : <small className="muted">Skipped: {l.problem}</small>}
                  {l.problem && cfg && <small className="up-warn">{l.problem === 'stat not read' ? 'Pick the stat to include this one' : `Skipped: ${l.problem}`}</small>}
                  {l.guessed && !l.problem && <small className="up-warn">Stat wasn’t readable, so this is a guess from the line. Check it.</small>}
                  {l.odd && <small className="up-warn">⚠ {l.line} looks off for {l.player.replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '').split(' ').slice(-1)[0]} (usually about {Math.round(l.expected * 10) / 10}). Check this one.</small>}
                </li>
              );
            })}
          </ol>
          <div className="up-bet">
            <label><span>Bet amount (optional)</span><input type="number" inputMode="decimal" min="0" placeholder="$10" value={stake} onChange={(e) => setStake(e.target.value)} /></label>
            <div className="seg">
              <button type="button" className={mode === 'power' ? 'on' : ''} onClick={() => setMode('power')}>Power{defaultMult(good.length) ? ` ${defaultMult(good.length)}x` : ''}</button>
              {PAYOUTS.flex[good.length] && <button type="button" className={mode === 'flex' ? 'on' : ''} onClick={() => setMode('flex')}>Flex</button>}
            </div>
          </div>
          <div className="up-actions">
            <button type="button" className="btn" disabled={!good.length} onClick={track}>Track {good.length} pick{good.length === 1 ? '' : 's'}</button>
            <button type="button" className="btn-ghost" onClick={toScan}>Fix in Slip Scan</button>
            <button type="button" className="link small" onClick={() => { setDrafts(null); setStatus(null); setPreview(null); }}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}

/** Career betting record across finished slips that have a bet amount. */
function BetRecord({ settled, openCount }) {
  const bets = settled.filter((v) => v.settled).slice().reverse(); // oldest first
  const noBet = settled.filter((v) => !v.settled).length;
  const wins = bets.filter((v) => v.settled.profit > 0).length;
  const losses = bets.filter((v) => v.settled.profit < 0).length;
  const pushes = bets.length - wins - losses;
  const wagered = bets.reduce((a, v) => a + v.slip.bet.stake, 0);
  const net = Math.round(bets.reduce((a, v) => a + v.settled.profit, 0) * 100) / 100;
  const best = bets.reduce((m, v) => Math.max(m, v.settled.profit), 0);
  let streak = 0; let kind = null;
  for (const v of [...bets].reverse()) {
    const k = v.settled.profit > 0 ? 'W' : v.settled.profit < 0 ? 'L' : null;
    if (!k) continue;
    if (!kind) kind = k;
    if (k !== kind) break;
    streak += 1;
  }
  // Cumulative profit line.
  let run = 0;
  const pts = [0, ...bets.map((v) => (run += v.settled.profit))];
  const lo = Math.min(...pts); const hi = Math.max(...pts); const span = hi - lo || 1;
  const path = pts.map((y, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${40 - ((y - lo) / span) * 36 - 2}`).join(' ');
  const zeroY = 40 - ((0 - lo) / span) * 36 - 2;
  const slipsWon = settled.filter((v) => v.st.key === 'won').length;
  return (
    <section className={`betrec ${net > 0 ? 'up' : net < 0 ? 'down' : ''}`}>
      <div className="betrec-top">
        <div>
          <span className="betrec-lbl">My betting record</span>
          <strong className="betrec-net">{bets.length ? money(net, true) : `${slipsWon}-${settled.length - slipsWon}`}</strong>
          <small>{bets.length ? `${net >= 0 ? 'profit' : 'loss'} on ${money(wagered)} wagered · ROI ${wagered ? `${net >= 0 ? '+' : ''}${((net / wagered) * 100).toFixed(1)}%` : '—'}` : 'Add a bet amount to your slips to track profit'}</small>
        </div>
        {bets.length > 1 && (
          <svg className="betrec-chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Profit over time">
            <line x1="0" x2="100" y1={zeroY} y2={zeroY} className="zero" />
            <polyline points={path} />
          </svg>
        )}
      </div>
      <div className="betrec-grid">
        <div><b className="pos-txt">{bets.length ? wins : slipsWon}</b><small>Wins</small></div>
        <div><b className="neg-txt">{bets.length ? losses : settled.length - slipsWon}</b><small>Losses</small></div>
        <div><b>{bets.length ? `${Math.round((wins / Math.max(1, wins + losses)) * 100)}%` : `${Math.round((slipsWon / settled.length) * 100)}%`}</b><small>Win rate</small></div>
        <div><b>{bets.length ? money(best, true) : '—'}</b><small>Best win</small></div>
        <div><b>{streak ? `${kind}${streak}` : '—'}</b><small>Streak</small></div>
        <div><b>{openCount}</b><small>Open slips</small></div>
      </div>
      {(noBet > 0 || pushes > 0) && <p className="muted small">{noBet > 0 ? `${noBet} finished slip${noBet === 1 ? ' has' : 's have'} no bet amount, so ${noBet === 1 ? 'it’s' : 'they’re'} not in the profit. ` : ''}{pushes > 0 ? `${pushes} refunded (voided legs).` : ''}</p>}
    </section>
  );
}

/** Bet amount and payout for one slip, with the result once it's finished. */
function BetLine({ v }) {
  const { slip, settled } = v;
  const n = slip.legs.length;
  const [edit, setEdit] = useState(false);
  const [stake, setStake] = useState(slip.bet?.stake ?? '');
  const [mode, setMode] = useState(slip.bet?.mode || 'power');
  const [mult, setMult] = useState(slip.bet?.mult ?? defaultMult(n, 'power') ?? '');
  const flexOk = !!PAYOUTS.flex[n];
  const b = slip.bet;
  if (edit) {
    return (
      <div className="betline edit">
        <label><span>Bet</span><input type="number" inputMode="decimal" min="0" step="1" value={stake} placeholder="10" onChange={(e) => setStake(e.target.value)} /></label>
        <div className="seg">
          <button type="button" className={mode === 'power' ? 'on' : ''} onClick={() => setMode('power')}>Power</button>
          {flexOk && <button type="button" className={mode === 'flex' ? 'on' : ''} onClick={() => setMode('flex')}>Flex</button>}
        </div>
        {mode === 'power' ? <label><span>Pays</span><input type="number" inputMode="decimal" min="1" step="0.1" value={mult} onChange={(e) => setMult(e.target.value)} />x</label>
          : <small className="muted">Pays {Object.entries(PAYOUTS.flex[n]).sort((a, c) => c[0] - a[0]).map(([k, x]) => `${k}/${n}: ${x}x`).join(' · ')}</small>}
        <button type="button" className="btn" onClick={() => { setBet(slip.id, { stake, mode, mult: mode === 'power' ? mult : null }); setEdit(false); }} disabled={!(Number(stake) > 0)}>Save</button>
        {b && <button type="button" className="link small" onClick={() => { setBet(slip.id, null); setEdit(false); }}>Remove</button>}
      </div>
    );
  }
  if (!b) return <div className="betline"><button type="button" className="link" onClick={() => setEdit(true)}>＋ Add bet amount</button><small className="muted">to count it in your profit</small></div>;
  const toWin = b.mode === 'power' ? b.stake * (b.mult || defaultMult(n) || 0) : null;
  return (
    <div className="betline">
      <span>{money(b.stake)} · {b.mode === 'power' ? `Power ${b.mult || defaultMult(n)}x` : 'Flex'}{toWin ? <span className="muted"> · pays {money(toWin)}</span> : null}</span>
      {settled ? <strong className={settled.profit > 0 ? 'pos-txt' : settled.profit < 0 ? 'neg-txt' : ''}>{settled.refunded ? 'Refunded' : money(settled.profit, true)}</strong> : <small className="muted">pending</small>}
      <button type="button" className="link small" onClick={() => setEdit(true)}>Edit</button>
    </div>
  );
}

// ---- Entries (list + detail) ----------------------------------------------------

const playText = (slip) => `${slip.legs.length}-Pick ${slip.bet?.mode === 'flex' ? 'Flex' : 'Power'} Play`;
/** What the entry pays if it all hits (Power) or the top Flex payout. */
function toWin(slip) {
  const b = slip.bet;
  if (!b) return null;
  const n = slip.legs.length;
  const mult = b.mode === 'flex' ? PAYOUTS.flex[n]?.[n] : (b.mult || defaultMult(n));
  return mult ? Math.round(b.stake * mult * 100) / 100 : null;
}
const legTone = (s) => (s.state === 'final' ? (s.push ? 'push' : s.hit ? 'hit' : 'miss') : s.state === 'void' ? 'push' : s.state);
const shortName = (n) => { const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };

function EntryCard({ v, onOpen, sports }) {
  const { slip, sts, st, settled } = v;
  const injured = sports ? slip.legs.filter((l, i) => sts[i].state === 'pending' && legInjury(l, sports)).length : 0;
  const live = sts.some((x) => x.state === 'live');
  const win = toWin(slip);
  return (
    <button type="button" className={`ent-card ${st.key}`} onClick={onOpen}>
      <div className="ent-top">
        <div>
          <strong>{slip.bet ? `${money(slip.bet.stake)} to win ${money(win || 0)}` : slip.title}</strong>
          <small>{slip.bet ? playText(slip) : `${slip.legs.length} picks · add a bet amount to track profit`}</small>
        </div>
        {settled ? <b className={`ent-result ${settled.profit > 0 ? 'pos-txt' : settled.profit < 0 ? 'neg-txt' : ''}`}>{settled.refunded ? 'Refunded' : money(settled.profit, true)}</b>
          : st.open === 0 ? <b className={`ent-result ${st.key === 'won' ? 'pos-txt' : 'neg-txt'}`}>{st.key === 'won' ? 'Won' : 'Lost'}</b> : null}
      </div>
      <div className="ent-mid">
        <span className="ent-faces">
          {slip.legs.map((l, i) => {
            const nm = l.player.split(' ');
            return (
              <span key={i} className={`ent-face ${legTone(sts[i])}`}>
                <Avatar player={{ id: l.playerId, sport: l.sport, team: l.team, first: nm[0], last: nm.slice(-1)[0] }} size={46} />
                {sts[i].state === 'final' && <i>{sts[i].push ? '–' : sts[i].hit ? '✓' : '✕'}</i>}
              </span>
            );
          })}
        </span>
        <span className="ent-status">{live ? <><span className="live-dot" /> Live</> : st.open === 0 ? (st.key === 'won' ? '✓ Won' : '✕ Lost') : (() => { const t = Math.min(...slip.legs.filter((l, i) => sts[i].state !== 'final' && sts[i].state !== 'void').map((l) => new Date(l.gameTime || 8.64e15).getTime())); return t < 8e15 ? kickoff(new Date(t).toISOString()) : 'Upcoming'; })()}</span>
      </div>
      <small className="ent-names">{slip.legs.map((l) => shortName(l.player)).join(', ')}</small>
      {injured > 0 && <em className="ent-inj">⚠ {injured} player{injured > 1 ? 's' : ''} on the injury report</em>}
    </button>
  );
}

function EntrySheet({ v, sports, onClose }) {
  const { slip, sts, st, settled } = v;
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    window.history.pushState({ geEntry: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('popstate', onPop);
      document.body.classList.remove('no-scroll');
      if (window.history.state?.geEntry) window.history.back();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const win = toWin(slip);
  return createPortal(
    <div className="ent-sheet" role="dialog" aria-modal="true">
      <div className="ent-sheet-scroll">
        <header className="ent-sheet-head">
          <button type="button" className="pp-round" onClick={onClose} aria-label="Back">‹</button>
          <div>
            <strong>{slip.bet ? `${money(slip.bet.stake)} to win ${money(win || 0)}` : slip.title}</strong>
            <small>{slip.bet ? playText(slip) : `${slip.legs.length}-pick slip`}{settled ? ` · ${settled.refunded ? 'Refunded' : money(settled.profit, true)}` : st.open === 0 ? ` · ${st.key === 'won' ? 'Won' : 'Lost'}` : ''}</small>
          </div>
        </header>
        {slip.legs.map((l, i) => {
          const s = sts[i];
          const g = legGame(l, sports);
          const S = sports[l.sport];
          const sp = S?.ctx?.season?.players?.get(l.playerId);
          const pos = sp?.pos || null;
          const nm = l.player.split(' ');
          const actual = s.actual ?? (s.state === 'final' ? 0 : null);
          const fill = actual == null ? 0 : Math.max(0, Math.min(1, actual / Math.max(l.line, 0.5)));
          const tone = legTone(s);
          const inj = s.state === 'pending' || s.state === 'live' ? legInjury(l, sports) : null;
          const ch = s.state === 'live' || s.state === 'pending' ? liveChance(l, s, sports) : null;
          return (
            <article key={i} className={`ent-leg ${tone}`}>
              <div className="ent-leg-head">
                <span className="ent-lg">{SPORT_LABEL[l.sport] || l.sport.toUpperCase()}</span>
                <span className="ent-match">{g ? <>{g.away.abbr} {g.state !== 'pre' ? <b>{g.away.score}</b> : null} <i>vs</i> {g.home.abbr} {g.state !== 'pre' ? <b>{g.home.score}</b> : null}</> : <>{l.team}{l.opp ? <> <i>vs</i> {l.opp}</> : null}</>}</span>
                <span className="ent-clock">{g?.state === 'in' ? <><span className="live-dot" /> {g.detail}</> : g?.state === 'post' || s.state === 'final' ? 'Final' : s.state === 'void' ? 'Void' : l.gameTime ? kickoff(l.gameTime) : ''}</span>
              </div>
              <div className="ent-leg-body">
                <span className={`ent-face big ${tone}`}>
                  <Avatar player={{ id: l.playerId, sport: l.sport, team: l.team, first: nm[0], last: nm.slice(-1)[0] }} size={64} />
                  {s.state === 'final' && <i>{s.push ? '–' : s.hit ? '✓' : '✕'}</i>}
                </span>
                <span className="ent-who">
                  <b>{l.player}</b>
                  <small><TeamLogo abbr={l.team} size={16} /> {[l.team, pos].filter(Boolean).join(' • ')}</small>
                  {inj && <em className={`ent-inj ${inj.status === 'Questionable' ? 'q' : ''}`}>⚠ {inj.status}{inj.part ? ` · ${inj.part}` : ''}</em>}
                </span>
                <span className="ent-line">
                  <b>{l.side === 'under' ? '↓' : '↑'} {l.line}</b>
                  <small>{l.stat}</small>
                </span>
              </div>
              <div className="ent-bar">
                <span className="ent-bar-fill" style={{ width: `${fill * 100}%` }} />
                {actual != null && <span className="ent-bubble" style={{ left: `clamp(22px, ${fill * 100}%, calc(100% - 22px))` }}>{fmtVal(actual)}</span>}
              </div>
              {ch && (
                <div className="ent-chance">
                  <span className={`ent-pct ${ch.chance >= 0.6 ? 'good' : ch.chance < 0.35 ? 'bad' : ''}`}>{Math.round(ch.chance * 100)}% to hit</span>
                  <small>{s.state === 'live'
                    ? `${ch.pace != null ? `On pace for ${fmtVal(Math.round(ch.pace * 10) / 10)}` : 'Just started'}${l.side !== 'under' && ch.need > 0 ? ` · needs ${fmtVal(Math.round((Number.isInteger(l.line) ? ch.need + 1 : ch.need + 0.5) * 10) / 10)} more` : ''}`
                    : 'Model chance before the game'}</small>
                </div>
              )}
            </article>
          );
        })}
        {st.open === 0 && <EntryRecap v={v} />}
        <div className="ent-sheet-foot">
          <button type="button" className="btn ent-share" onClick={() => shareEntry(v)}>📤 Share {st.key === 'won' ? 'this win' : 'entry'}</button>
          <BetLine v={v} />
          {confirm ? (
            <div className="ent-del">
              <span className="muted small">Delete this entry?</span>
              <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Keep</button>
              <button type="button" className="btn-ghost danger" onClick={() => { deleteSlip(slip.id); onClose(); }}>Delete</button>
            </div>
          ) : <button type="button" className="link small" onClick={() => setConfirm(true)}>Delete entry</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}


/** AI recap of a finished entry: instant summary, upgraded by Claude when a key is saved. */
function EntryRecap({ v }) {
  const { slip, sts, st, settled } = v;
  const local = useMemo(() => {
    const rows = slip.legs.map((l, i) => ({ l, s: sts[i], m: (sts[i].actual ?? 0) - l.line }));
    const hits = rows.filter((r) => r.s.hit);
    const miss = rows.filter((r) => r.s.state === 'final' && !r.s.hit && !r.s.push);
    const best = hits.sort((a, b) => (b.l.side === 'under' ? -b.m : b.m) - (a.l.side === 'under' ? -a.m : a.m))[0];
    const close = miss.sort((a, b) => Math.abs(a.m) - Math.abs(b.m))[0];
    const parts = [];
    parts.push(st.key === 'won' ? `Cashed ${st.hit}/${slip.legs.length}${settled && !settled.refunded ? ` for ${money(settled.profit, true)}` : ''} 🔥` : `${st.hit}/${slip.legs.length} hit${settled ? ` (${money(settled.profit, true)})` : ''}.`);
    if (best) parts.push(`MVP: ${best.l.player} with ${fmtVal(best.s.actual)} ${best.l.stat} on a ${best.l.line} line.`);
    if (close) parts.push(`${close.l.player} ${Math.abs(close.m) <= Math.max(1, close.l.line * 0.1) ? 'missed by a hair' : 'was the one that sank it'} — ${fmtVal(close.s.actual)} on ${close.l.line}.`);
    if (st.key !== 'won' && miss.length === 1) parts.push('One leg away. The reads were close — keep stakes steady, no chasing.');
    return parts.join(' ');
  }, [slip, sts, st, settled]);
  const [ai, setAi] = useState(null);
  useEffect(() => {
    let key = '';
    try { key = localStorage.getItem('ge:ai:key') || ''; } catch { /* ignore */ }
    if (!key) return;
    const cacheKey = `ge:recap:${slip.id}`;
    try { const c = localStorage.getItem(cacheKey); if (c) { setAi(c); return; } } catch { /* ignore */ }
    const legs = slip.legs.map((l, i) => `${l.player} ${l.side === 'under' ? 'Less' : 'More'} ${l.line} ${l.stat}: ${fmtVal(sts[i].actual)} (${sts[i].push ? 'push' : sts[i].hit ? 'hit' : 'miss'})`).join('; ');
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 200, system: 'You recap a finished player-prop entry for the bettor in 2-3 short sentences, casual and friendly. Name the best performer and the leg that decided it. If it lost, be supportive and never encourage chasing losses. No headings.', messages: [{ role: 'user', content: `${st.key === 'won' ? 'Won' : 'Lost'}${settled ? `, profit ${money(settled.profit, true)}` : ''}. Legs: ${legs}` }] }),
    }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const t = j?.content?.find((c) => c.type === 'text')?.text?.trim();
      if (t) { setAi(t); try { localStorage.setItem(cacheKey, t); } catch { /* ignore */ } }
    }).catch(() => {});
  }, [slip.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ent-recap">
      <span className="hype-ai">✦ AI recap</span>
      <p>{ai || local}</p>
    </div>
  );
}

/** Draws the entry as a share image and opens the share sheet (or downloads it). */
async function shareEntry(v) {
  const { slip, sts, st, settled } = v;
  const W = 1080; const rowH = 150; const H = 270 + slip.legs.length * rowH + 140;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, st.key === 'won' ? '#064e3b' : '#111114'); grad.addColorStop(1, '#000');
  x.fillStyle = grad; x.fillRect(0, 0, W, H);
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  x.fillStyle = '#fff'; x.font = font(900, 64);
  const win = toWin(slip);
  x.fillText(slip.bet ? `${money(slip.bet.stake)} to win ${money(win || 0)}` : slip.title, 64, 130);
  x.font = font(600, 36); x.fillStyle = '#a1a1aa';
  x.fillText(`${slip.bet ? playText(slip) : `${slip.legs.length}-pick slip`}`, 64, 190);
  if (st.open === 0) {
    x.font = font(900, 56); x.fillStyle = st.key === 'won' ? '#22c55e' : '#ef4444';
    const t = st.key === 'won' ? (settled && !settled.refunded ? `WON ${money(settled.profit, true)}` : 'WON') : 'LOST';
    x.fillText(t, W - 64 - x.measureText(t).width, 130);
  }
  slip.legs.forEach((l, i) => {
    const y = 250 + i * rowH; const s = sts[i];
    x.fillStyle = 'rgba(255,255,255,0.06)'; x.beginPath(); x.roundRect(48, y, W - 96, rowH - 20, 28); x.fill();
    const tone = s.state === 'final' ? (s.push ? '#9ca3af' : s.hit ? '#22c55e' : '#ef4444') : '#fff';
    x.fillStyle = tone; x.beginPath(); x.arc(118, y + 65, 34, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#000'; x.font = font(900, 36); const mk = s.state === 'final' ? (s.push ? '–' : s.hit ? '✓' : '✕') : '•';
    x.fillText(mk, 118 - x.measureText(mk).width / 2, y + 78);
    x.fillStyle = '#fff'; x.font = font(800, 40); x.fillText(l.player, 180, y + 58);
    x.fillStyle = '#a1a1aa'; x.font = font(600, 30); x.fillText(`${l.side === 'under' ? '↓ Less' : '↑ More'} ${l.line} ${l.stat}`, 180, y + 102);
    if (s.actual != null) { x.fillStyle = tone; x.font = font(900, 52); const a = fmtVal(s.actual); x.fillText(a, W - 90 - x.measureText(a).width, y + 84); }
  });
  x.fillStyle = '#71717a'; x.font = font(700, 30); x.fillText('Tracked with Gridiron Edge', 64, H - 60);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'entry.png', { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'My entry' }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'entry.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- Insights, bankroll, pick of the day ---------------------------------------

/** Which kinds of picks actually win for you (leg level, all finished entries). */
function BetInsights({ settled }) {
  const legs = [];
  for (const v of settled) v.slip.legs.forEach((l, i) => { const s = v.sts[i]; if (s.state === 'final' && !s.push) legs.push({ l, hit: !!s.hit }); });
  if (legs.length < 3) return null;
  const group = (key) => {
    const m = new Map();
    for (const x of legs) { const k = key(x.l); if (!k) continue; const g = m.get(k) || { k, n: 0, h: 0 }; g.n += 1; g.h += x.hit ? 1 : 0; m.set(k, g); }
    return [...m.values()].filter((g) => g.n >= 2).sort((a, b) => b.h / b.n - a.h / a.n || b.n - a.n);
  };
  const all = legs.filter((x) => x.hit).length / legs.length;
  const stats = group((l) => `${SPORT_LABEL[l.sport] || l.sport} ${l.stat}`);
  const sides = group((l) => (l.side === 'under' ? 'Less' : 'More'));
  const sportsG = group((l) => SPORT_LABEL[l.sport] || l.sport);
  const players = group((l) => l.player);
  const row = (g) => (
    <li key={g.k}>
      <span>{g.k}</span>
      <span className="ins-bar"><i style={{ width: `${(g.h / g.n) * 100}%` }} className={g.h / g.n >= 0.6 ? 'good' : g.h / g.n < 0.45 ? 'bad' : ''} /></span>
      <b>{Math.round((g.h / g.n) * 100)}%</b><small>{g.h}/{g.n}</small>
    </li>
  );
  const best = stats[0]; const worst = stats.length > 1 ? stats[stats.length - 1] : null;
  return (
    <section className="ins">
      <h3>Your betting insights</h3>
      <p className="muted small">{legs.length} graded picks · {Math.round(all * 100)}% hit overall{best && best.h / best.n > all ? ` · best at ${best.k} (${Math.round((best.h / best.n) * 100)}%)` : ''}{worst && worst.h / worst.n < all ? ` · fade ${worst.k} (${Math.round((worst.h / worst.n) * 100)}%)` : ''}</p>
      {stats.length > 0 && <><h4>By stat</h4><ul>{stats.slice(0, 6).map(row)}</ul></>}
      <div className="ins-2">
        {sides.length > 0 && <div><h4>More vs Less</h4><ul>{sides.map(row)}</ul></div>}
        {sportsG.length > 0 && <div><h4>By sport</h4><ul>{sportsG.map(row)}</ul></div>}
      </div>
      {players.length > 0 && (
        <div className="ins-2">
          <div><h4>Most reliable</h4><ul>{players.slice(0, 3).map(row)}</ul></div>
          {players.length > 3 && <div><h4>Burned you</h4><ul>{players.slice(-3).reverse().map(row)}</ul></div>}
        </div>
      )}
    </section>
  );
}

const BANK = 'ge:bankroll';
/** Bankroll mode: starting bankroll + unit size, current balance, stake suggestion and a cool-off warning. */
function Bankroll({ view }) {
  const [cfg, setCfg] = useState(() => { try { return JSON.parse(localStorage.getItem(BANK)) || null; } catch { return null; } });
  const [edit, setEdit] = useState(false);
  const [start, setStart] = useState(cfg?.start ?? '');
  const [unitPct, setUnitPct] = useState(cfg?.unitPct ?? 2);
  const save = () => {
    const n = Number(start);
    if (!(n > 0)) return;
    const next = { start: n, unitPct: Number(unitPct) || 2, since: cfg?.since || Date.now() };
    setCfg(next); setEdit(false);
    try { localStorage.setItem(BANK, JSON.stringify(next)); } catch { /* ignore */ }
  };
  if (!cfg && !edit) {
    return (
      <button type="button" className="bank bank-cta" onClick={() => setEdit(true)}>
        <span>💰</span><span><b>Set up bankroll mode</b><small>Track your balance, get stake sizes and a heads-up after a rough day</small></span><span>›</span>
      </button>
    );
  }
  if (edit) {
    return (
      <div className="bank">
        <b>Bankroll mode</b>
        <label>Starting bankroll <input inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} placeholder="$200" /></label>
        <label>Unit size <select value={unitPct} onChange={(e) => setUnitPct(e.target.value)}>{[1, 2, 3, 5].map((p) => <option key={p} value={p}>{p}% of bankroll</option>)}</select></label>
        <div className="bank-row">
          <button type="button" className="btn" onClick={save}>Save</button>
          <button type="button" className="btn-ghost" onClick={() => setEdit(false)}>Cancel</button>
          {cfg && <button type="button" className="btn-ghost danger" onClick={() => { setCfg(null); setEdit(false); try { localStorage.removeItem(BANK); } catch { /* ignore */ } }}>Turn off</button>}
        </div>
      </div>
    );
  }
  const bets = view.filter((v) => v.settled && lastGame(v.slip) >= cfg.since);
  const net = bets.reduce((a, v) => a + v.settled.profit, 0);
  const atRisk = view.filter((v) => !v.settled && v.slip.bet && v.st.open > 0).reduce((a, v) => a + v.slip.bet.stake, 0);
  const bal = Math.round((cfg.start + net) * 100) / 100;
  const unit = Math.max(1, Math.round(bal * cfg.unitPct) / 100);
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const today = bets.filter((v) => lastGame(v.slip) >= day.getTime()).reduce((a, v) => a + v.settled.profit, 0);
  let streak = 0;
  for (const v of [...bets].sort((a, b) => lastGame(b.slip) - lastGame(a.slip))) { if (v.settled.profit < 0) streak += 1; else break; }
  const tilt = today <= -3 * unit || streak >= 3;
  return (
    <div className={`bank ${bal >= cfg.start ? 'up' : 'down'}`}>
      <div className="bank-row">
        <div><small>Bankroll</small><b>{money(bal)}</b><small className={bal >= cfg.start ? 'pos-txt' : 'neg-txt'}>{money(bal - cfg.start, true)} since start</small></div>
        <div><small>1 unit</small><b>{money(unit)}</b><small>{cfg.unitPct}% of bankroll</small></div>
        <div><small>In play</small><b>{money(atRisk)}</b><small>{atRisk ? `${(atRisk / unit).toFixed(1)} units` : 'nothing open'}</small></div>
      </div>
      {tilt && <p className="bank-warn">🧊 {streak >= 3 ? `${streak} losing entries in a row` : `Down ${money(-today)} today`}. Good time to take a break — no need to win it back tonight.</p>}
      {atRisk > 5 * unit && <p className="bank-warn">⚠ You have {(atRisk / unit).toFixed(1)} units in play — more than the usual 5.</p>}
      <button type="button" className="link small" onClick={() => setEdit(true)}>Edit bankroll</button>
    </div>
  );
}

/** The model's single best pick for today, fixed for the day once chosen. */
function PickOfDay({ sports }) {
  const dayKey = `ge:potd:${new Date().toDateString()}`;
  const [saved, setSaved] = useState(false);
  const pick = useMemo(() => {
    try { const c = JSON.parse(localStorage.getItem(dayKey)); if (c) return c; } catch { /* ignore */ }
    const all = [];
    for (const sp of ['nba', 'nfl']) {
      const S = sports[sp];
      if (!S?.ctx || !S.rows) continue;
      try { all.push(...buildSafePicks(CFGS[sp], S.ctx, S.rows, 0.75, S.ctx.gameByTeam).filter((p) => p.state === 'pre' && new Date(p.gameTime || 0) - Date.now() < 36 * 3600e3)); } catch { /* ignore */ }
    }
    if (!all.length) return null;
    const p = all.sort((a, b) => b.score - a.score)[0];
    const out = { sport: p.sport, playerId: p.playerId, player: p.player, team: p.team, opp: p.opp, market: p.market, stat: p.stat, statLabel: p.statLabel, line: p.line, side: 'over', prob: p.prob, gameTime: p.gameTime, gameId: p.gameId, period: p.sport === 'nba' ? (p.gameTime ? new Date(p.gameTime).toLocaleDateString('en-CA') : undefined) : (p.week ? `W${p.week}` : undefined), hits: p.hits, n: p.n, mean: p.mean };
    try { localStorage.setItem(dayKey, JSON.stringify(out)); } catch { /* ignore */ }
    return out;
  }, [sports, dayKey]);
  if (!pick) return null;
  const nm = pick.player.split(' ');
  return (
    <div className="potd">
      <div className="potd-head"><span className="hype-ai">✦ AI pick of the day</span><small>{SPORT_LABEL[pick.sport]} · {pick.gameTime ? kickoff(pick.gameTime) : ''}</small></div>
      <div className="potd-body">
        <Avatar player={{ id: pick.playerId, sport: pick.sport, team: pick.team, first: nm[0], last: nm.slice(-1)[0] }} size={52} />
        <div><b>{pick.player}</b><small>{pick.team}{pick.opp ? ` vs ${pick.opp}` : ''}</small></div>
        <span className="ent-line"><b>↑ {pick.line}</b><small>{pick.stat}</small></span>
      </div>
      <p className="potd-why">Cleared this in {pick.hits} of the last {pick.n} games and projects for {fmtVal(Math.round(pick.mean * 10) / 10)}. The model gives it about {Math.round(pick.prob * 100)}% — the safest line on the board today, not a lock.</p>
      <button type="button" className="btn-ghost" disabled={saved} onClick={() => { saveSlip({ title: `Pick of the day · ${pick.player}`, source: 'potd', legs: [pick] }); setSaved(true); }}>{saved ? 'Tracking ✓' : '☆ Track this pick'}</button>
    </div>
  );
}
