import { useEffect, useMemo, useRef, useState } from 'react';
import { runOcr } from './Scan.jsx';
import { parseSlipText, repairLine } from '../slipParse.js';
import { buildRoster, nextGame } from '../slipRoster.js';
import { normName } from '../oddsapi.js';
import { CFGS, OWN_HOOK, SPORT_LABEL, useDualSports } from '../dualSport.jsx';
import { defaultMult, deleteSlip, loadSlips, onSlipsChange, saveSlip, setBet, settleBet, storeResults } from '../slips.js';
import { PAYOUTS } from '../slipMath.js';
import { legStatus } from '../tracker.js';
import { LegBar, useSlipAlerts } from '../components/Tracking.jsx';
import { Avatar, Card, Empty, kickoff, timeAgo, useNow } from '../components/ui.jsx';

const fmtVal = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));

function statusOf(leg, sports) {
  if (leg.result) return { state: 'final', ...leg.result };
  const ctx = sports[leg.sport]?.ctx;
  if (!ctx) return { state: 'loading' };
  return legStatus(leg, { markets: CFGS[leg.sport].markets, season: ctx.season, liveById: ctx.liveById, gameByTeam: ctx.gameByTeam });
}

const lastGame = (s) => Math.max(s.created || 0, ...s.legs.map((l) => new Date(l.gameTime || 0).getTime()));
const money = (n, sign = false) => `${sign && n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function slipState(sts) {
  const hit = sts.filter((s) => s.state === 'final' && s.hit).length;
  const miss = sts.filter((s) => s.state === 'final' && !s.hit && !s.push).length;
  const voids = sts.filter((s) => s.state === 'void' || s.push).length;
  const open = sts.length - hit - miss - voids;
  const live = sts.some((s) => s.state === 'live');
  if (miss) return { key: 'lost', label: open ? `Lost · ${miss} miss${miss > 1 ? 'es' : ''}` : `Lost · ${hit} of ${sts.length} hit`, hit, miss, open, voids };
  if (!open) return { key: 'won', label: voids ? `Won · ${hit} hit, ${voids} void` : `Won · all ${hit} hit`, hit, miss, open, voids };
  if (live || hit) return { key: 'live', label: `Live · ${hit} of ${sts.length} hit so far`, hit, miss, open, voids };
  return { key: 'pending', label: 'Upcoming', hit, miss, open, voids };
}

export default function Slips() { return <SlipsPage home="nfl" own={OWN_HOOK.nfl()} />; }
export function NbaSlipsRoute() { return <SlipsPage home="nba" own={OWN_HOOK.nba()} />; }

function SlipsPage({ home, own }) {
  const [sports, bridge] = useDualSports(home, own);
  const [slips, setSlips] = useState(loadSlips);
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  useEffect(() => onSlipsChange(setSlips), []);
  useNow(30000);

  const view = useMemo(() => slips.map((s) => {
    const sts = s.legs.map((l) => statusOf(l, sports));
    const st = slipState(sts);
    const settled = st.open === 0 ? settleBet(s.bet, s.legs.length, st.hit, st.miss, st.voids) : null;
    return { slip: s, sts, st, settled };
  }), [slips, sports]);

  // Keep final results with the slip.
  useEffect(() => {
    const ups = [];
    for (const v of view) v.sts.forEach((st, i) => { if (st.state === 'final' && !v.slip.legs[i].result) ups.push({ id: v.slip.id, i, result: { actual: st.actual, hit: st.hit, push: !!st.push } }); });
    if (ups.length) storeResults(ups);
  }, [view]);

  const events = useMemo(() => {
    const out = [];
    for (const v of view) {
      v.slip.legs.forEach((l, i) => {
        const st = v.sts[i];
        if (st.state !== 'final') return;
        const when = new Date(l.gameTime || v.slip.created).getTime();
        out.push({ key: `${v.slip.id}|${i}`, when, title: `${st.hit ? '✅' : st.push ? '➖' : '❌'} ${l.player} ${st.hit ? 'hit' : st.push ? 'pushed' : 'missed'}`, body: `${l.side === 'over' ? 'More' : 'Less'} ${l.line} ${l.stat}: ${fmtVal(st.actual)} · ${v.slip.title}` });
      });
      if (v.st.key === 'won' || v.st.key === 'lost') {
        const when = Math.max(...v.slip.legs.map((l) => new Date(l.gameTime || 0).getTime()));
        out.push({ key: `${v.slip.id}|done`, when, title: v.st.key === 'won' ? `🏆 ${v.slip.title} won!` : `${v.slip.title} lost`, body: v.st.label });
      }
    }
    return out;
  }, [view]);
  useSlipAlerts(perm === 'granted' ? events : []);

  const ask = async () => { try { setPerm(await Notification.requestPermission()); } catch { /* ignore */ } };
  // A slip is finished once every leg is decided (a Flex slip can still pay after a miss).
  const active = view.filter((v) => v.st.open > 0);
  const settled = view.filter((v) => v.st.open === 0).sort((a, b) => lastGame(b.slip) - lastGame(a.slip));

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
      {bridge}
      {settled.length > 0 && <BetRecord settled={settled} openCount={active.length} />}
      <UploadSlip sports={sports} />
      {view.length === 0 ? (
        <Card>
          <Empty title="No saved slips yet">
            Tap <strong>☆ Save slip & track live</strong> on a slip in Props, the Parlay Builder or Slip Scan. It shows up here with each leg’s live stats as the games play.
          </Empty>
        </Card>
      ) : (
        <div className="slips">
          {[...active, ...settled].map((v) => <SlipCard key={v.slip.id} v={v} />)}
        </div>
      )}
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
    const odd = ex > 0 && (x.line / ex > 2.2 || x.line / ex < 0.4);
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
                  {l.odd && <small className="up-warn">⚠ {l.line} looks off for {l.player.split(' ').slice(-1)[0]} (usually about {Math.round(l.expected * 10) / 10}). Check this one.</small>}
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
