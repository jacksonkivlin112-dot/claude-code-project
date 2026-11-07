import { useState } from 'react';
import { useData } from '../data.jsx';
import { useUi } from '../components/ui.jsx';
import PlayerBio from '../components/PlayerBio.jsx';
import { TOURS, flagUrl, headshot, matchModel } from './data.jsx';

const initials = (name = '') => name.split(' ').map((w) => w[0]).slice(0, 2).join('');

export function Flag({ code, size = 16 }) {
  const u = flagUrl(code);
  if (!u) return null;
  return <img className="t-flag" src={u} alt={code?.toUpperCase()} width={size} height={size} loading="lazy" />;
}

/** Headshot with a flag badge; initials when there's no photo. */
export function Face({ p, size = 44 }) {
  const [err, setErr] = useState(false);
  return (
    <span className="t-face" style={{ width: size, height: size }}>
      {err ? <span className="t-init" style={{ fontSize: size * 0.36 }}>{initials(p?.name)}</span> : <img src={headshot(p?.id)} alt="" loading="lazy" onError={() => setErr(true)} />}
      {p?.flag && <span className="t-face-flag"><Flag code={p.flag} size={Math.round(size * 0.38)} /></span>}
    </span>
  );
}

export function TourTabs() {
  const { tour, setTour } = useData();
  return (
    <div className="t-tours" role="tablist" aria-label="Tour">
      {Object.entries(TOURS).map(([k, v]) => (
        <button key={k} type="button" role="tab" aria-selected={tour === k} className={tour === k ? 'on' : ''} onClick={() => setTour(k)}>{v}</button>
      ))}
    </div>
  );
}

const pct = (p) => `${Math.round(p * 100)}%`;
const timeOf = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const matchHref = (m, tour) => `#/tennis/match?id=${m.id}&tour=${tour}`;

/** Row for one match: players, set scores, win chance. */
export function MatchRow({ m, d }) {
  const { tour } = useData();
  const model = matchModel(m, d);
  const p = model.liveP ?? model.p;
  const sides = [['a', m.a, p], ['b', m.b, 1 - p]];
  return (
    <a className={`t-match ${m.state}`} href={matchHref(m, d?.tour || tour)}>
      <span className="t-mhead">
        {m.state === 'in' ? <b className="t-live"><span className="live-dot" /> {m.detail || 'Live'}</b> : m.state === 'pre' ? <b>{timeOf(m.date)}</b> : <b>{/RETIRED|WALKOVER/.test(m.status) ? m.detail : 'Final'}</b>}
        <span>{m.round}{m.court ? ` · ${m.court}` : ''}</span>
      </span>
      {sides.map(([k, pl, pw]) => {
        const lost = m.state === 'post' && m.winner && m.winner !== k;
        return (
          <span key={k} className={`t-side ${lost ? 'lost' : ''} ${m.winner === k ? 'won' : ''}`}>
            <Face p={pl} size={30} />
            <span className="t-name">
              {pl.name}
              {pl.seed ? <small> ({pl.seed})</small> : null}
            </span>
            <span className="t-sets">
              {m.sets.map((s, i) => {
                const mine = k === 'a' ? s[0] : s[1];
                const other = k === 'a' ? s[1] : s[0];
                const open = s.includes('open');
                return <span key={i} className={`t-set ${open ? 'open' : mine > other ? 'w' : ''}`}>{mine}{typeof s[2] === 'number' && mine < other ? <sup>{s[2]}</sup> : null}</span>;
              })}
            </span>
            {m.state !== 'post' && <span className={`t-pct ${pw >= 0.5 ? 'fav' : ''}`}>{pct(pw)}</span>}
          </span>
        );
      })}
    </a>
  );
}

export function WinBar({ p, a, b }) {
  return (
    <div className="t-winbar">
      <div className="t-winbar-lbl"><span><b>{pct(p)}</b> {a}</span><span>{b} <b>{pct(1 - p)}</b></span></div>
      <div className="t-winbar-track"><span style={{ width: `${p * 100}%` }} /></div>
    </div>
  );
}

export function TennisPlayerPanel({ id }) {
  const { tours, tour } = useData();
  const d = tours?.[tour]?.players?.[id] ? tours[tour] : Object.values(tours || {}).find((t) => t.players?.[id]);
  const p = d?.players?.[id];
  if (!p) return <div className="t-panel"><p className="muted">No data for this player yet.</p></div>;
  const games = p.gw + p.gl ? p.gw / (p.gw + p.gl) : null;
  return (
    <div className="t-panel">
      <div className="t-panel-head">
        <Face p={p} size={72} />
        <div>
          <h2>{p.name}</h2>
          <p className="muted">{p.rank ? `World #${p.rank} · ${p.points?.toLocaleString()} pts` : 'Unranked'} · Elo {p.elo}</p>
          <PlayerBio league={d.tour} name={p.name} espnId={p.id} />
        </div>
      </div>
      <PlayerStats p={p} />
      <h3 className="gp-h">Recent results</h3>
      <Results list={p.recent} />
      {games != null && <p className="muted small">This season: won {pct(games)} of games played.</p>}
    </div>
  );
}

export function PlayerStats({ p }) {
  const rec = (w, l) => (w + l ? `${w}-${l}` : '—');
  const rate = (w, l) => (w + l ? pct(w / (w + l)) : '—');
  const items = [
    ['Season', rec(p.w, p.l), rate(p.w, p.l)],
    ['Sets', rec(p.sw, p.sl), rate(p.sw, p.sl)],
    ['Games won', p.gw + p.gl ? pct(p.gw / (p.gw + p.gl)) : '—', `${p.gw + p.gl} played`],
    ['Tiebreaks', rec(p.tbw, p.tbl), rate(p.tbw, p.tbl)],
    ['Deciding sets', rec(p.dw, p.dl), rate(p.dw, p.dl)],
    ['Rating', String(p.elo), p.n < 10 ? 'few matches' : `${p.n} rated matches`],
  ];
  return (
    <div className="t-stats">
      {items.map(([k, v, s]) => <div key={k} className="t-stat"><small>{k}</small><b>{v}</b><span>{s}</span></div>)}
    </div>
  );
}

export function Results({ list = [] }) {
  const { openPlayer } = useUi();
  if (!list.length) return <p className="muted small">No results this season.</p>;
  return (
    <ol className="t-results">
      {list.map((r) => (
        <li key={r.id}>
          <span className={`t-wl ${r.win ? 'w' : 'l'}`}>{r.win ? 'W' : 'L'}</span>
          <span className="t-res-main">
            <button type="button" className="link-plain" onClick={() => openPlayer(r.oppId)}>{r.opp}</button>
            <small>{r.event} · {r.round}</small>
          </span>
          <span className="t-res-score">{r.score}{r.ret ? ' ret.' : ''}</span>
        </li>
      ))}
    </ol>
  );
}
