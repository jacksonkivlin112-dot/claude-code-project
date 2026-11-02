import { useEffect, useMemo, useState } from 'react';
import { CFGS, OWN_HOOK, SPORT_LABEL, useDualSports } from '../dualSport.jsx';
import { deleteSlip, loadSlips, onSlipsChange, storeResults } from '../slips.js';
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
