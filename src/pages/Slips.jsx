import { useEffect, useMemo, useRef, useState } from 'react';
import { runOcr } from './Scan.jsx';
import { parseSlipText } from '../slipParse.js';
import { normName } from '../oddsapi.js';
import { CFGS, OWN_HOOK, SPORT_LABEL, useDualSports } from '../dualSport.jsx';
import { deleteSlip, loadSlips, onSlipsChange, saveSlip, storeResults } from '../slips.js';
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

function slipState(sts) {
  const hit = sts.filter((s) => s.state === 'final' && s.hit).length;
  const miss = sts.filter((s) => s.state === 'final' && !s.hit && !s.push).length;
  const voids = sts.filter((s) => s.state === 'void' || s.push).length;
  const open = sts.length - hit - miss - voids;
  const live = sts.some((s) => s.state === 'live');
  if (miss) return { key: 'lost', label: open ? `Lost · ${miss} miss${miss > 1 ? 'es' : ''}` : `Lost · ${hit} of ${sts.length} hit`, hit, miss, open };
  if (!open) return { key: 'won', label: voids ? `Won · ${hit} hit, ${voids} void` : `Won · all ${hit} hit`, hit, miss, open };
  if (live || hit) return { key: 'live', label: `Live · ${hit} of ${sts.length} hit so far`, hit, miss, open };
  return { key: 'pending', label: 'Upcoming', hit, miss, open };
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
    return { slip: s, sts, st: slipState(sts) };
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
  const active = view.filter((v) => v.st.key === 'live' || v.st.key === 'pending');
  const settled = view.filter((v) => v.st.key === 'won' || v.st.key === 'lost');
  const won = settled.filter((v) => v.st.key === 'won').length;

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
      <UploadSlip sports={sports} />
      {settled.length > 0 && (
        <div className="record-bar"><span>Your saved slips:</span><strong className={won ? 'pos-txt' : ''}>{won}-{settled.length - won}</strong><span className="muted">{active.length} still open</span></div>
      )}
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
  const [legs, setLegs] = useState(null);
  const [preview, setPreview] = useState(null);
  const ready = !!sports.nfl.ctx || !!sports.nba.ctx;

  const roster = useMemo(() => [
    ...(sports.nfl.rows || []).filter((r) => r.pos !== 'K' && r.pos !== 'DEF').map((r) => ({ ...r, sport: 'nfl' })),
    ...(sports.nba.rows || []).map((r) => ({ ...r, sport: 'nba' })),
  ], [sports.nfl.rows, sports.nba.rows]);
  const bySport = (sp) => sports[sp];

  // Turn parsed legs into trackable legs using each league's model (player id, team, game time, chance).
  const resolve = (found) => found.map((l, i) => {
    const sp = l.sport || roster.find((r) => normName(r.name) === normName(l.player))?.sport;
    const S = sp && bySport(sp);
    const cfg = sp && CFGS[sp];
    if (!S?.ctx || !cfg || !l.market || l.line == null) return { ...l, sport: sp, problem: !l.market ? 'stat not read' : l.line == null ? 'line not read' : 'player not found' };
    const e = cfg.evaluate({ id: `up:${i}`, player: l.player, market: l.market, line: Number(l.line) }, S.ctx);
    if (!e || e.unmatched) return { ...l, sport: sp, problem: 'player not found' };
    const g = S.ctx.gameByTeam?.[e.team];
    return {
      sport: sp, playerId: e.playerId, player: e.player, team: e.team, opp: e.opp, market: l.market, stat: cfg.markets[l.market].short,
      line: Number(l.line), side: l.side || 'over', prob: (l.side || 'over') === 'under' ? e.pUnder : e.pOver,
      gameTime: e.commence || g?.date || null, gameId: g?.id || null, week: S.ctx.week ?? null,
    };
  });

  const onFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPreview(URL.createObjectURL(file));
    setLegs(null);
    setStatus({ phase: 'Reading your slip…', progress: 0 });
    try {
      const text = await runOcr(file, (pr) => setStatus({ phase: 'Reading your slip…', progress: pr }));
      const found = parseSlipText(text, roster, (pl) => CFGS[pl.sport]?.aliases);
      const out = resolve(found);
      setLegs(out);
      const good = out.filter((l) => !l.problem).length;
      setStatus({ phase: good ? `Found ${good} pick${good === 1 ? '' : 's'}${out.length > good ? ` (${out.length - good} couldn’t be matched)` : ''}` : 'Couldn’t find any picks in that image.', done: true, ok: good > 0 });
    } catch (e) {
      setStatus({ phase: `Couldn’t read the image (${e.message}).`, done: true, ok: false });
    }
  };

  const good = (legs || []).filter((l) => !l.problem);
  const track = () => {
    saveSlip({ title: `${good.length}-pick slip (uploaded)`, source: 'upload', legs: good });
    setLegs(null); setStatus({ phase: `Tracking ${good.length} picks ✓`, done: true, ok: true }); setPreview(null);
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
          <ol className="up-legs">
            {legs.map((l, i) => (
              <li key={i} className={l.problem ? 'bad' : ''}>
                <span><b>{l.player}</b><small>{l.problem ? `Skipped: ${l.problem}` : `${l.side === 'under' ? 'Less' : 'More'} ${l.line} ${l.stat} · ${SPORT_LABEL[l.sport]} · ${l.team}${l.opp ? ` vs ${l.opp}` : ''}`}</small></span>
                {!l.problem && <em>{Math.round(l.prob * 100)}%</em>}
                <button type="button" className="up-x" onClick={() => setLegs((xs) => xs.filter((_, k) => k !== i))} aria-label={`Remove ${l.player}`}>✕</button>
              </li>
            ))}
          </ol>
          <div className="up-actions">
            <button type="button" className="btn" disabled={!good.length} onClick={track}>Track {good.length} pick{good.length === 1 ? '' : 's'}</button>
            <button type="button" className="btn-ghost" onClick={toScan}>Fix in Slip Scan</button>
            <button type="button" className="link small" onClick={() => { setLegs(null); setStatus(null); setPreview(null); }}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}
