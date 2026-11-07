import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { headshot } from '../api.js';
import { useData } from '../data.jsx';
import { FORMATS, pts } from '../model.js';
import { useNbaRows } from '../nba/components.jsx';
import { BioSheet } from './PlayerBio.jsx';
import { useProjectionRows } from './players.jsx';
import { TeamLogo, f1 } from './ui.jsx';

// Full-screen player page: header, league ranks, season stats with ranks, splits,
// recent performances and a game-by-game feed. Football (NFL/CFB) and NBA.

const GROUP = { G: 'Guard', F: 'Forward', C: 'Center' };
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n.toLocaleString()}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const sum = (log, k) => log.reduce((a, l) => a + (Number(l.s?.[k]) || 0), 0);
const per = (log, k) => (log.length ? sum(log, k) / log.length : 0);
const ratio = (a, b) => (b ? a / b : null);

// Stat columns: [label, value(log), { lowerBetter, rate, minGames }]
const FOOT = {
  QB: [['G', (l) => l.length], ['PASS YDS', (l) => sum(l, 'pass_yd')], ['YDS/G', (l) => per(l, 'pass_yd'), { rate: 1 }], ['PASS TD', (l) => sum(l, 'pass_td')], ['INT', (l) => sum(l, 'pass_int'), { lowerBetter: 1 }],
    ['CMP%', (l) => ratio(sum(l, 'pass_cmp'), sum(l, 'pass_att')) * 100, { rate: 1, pct: 1 }], ['ATT', (l) => sum(l, 'pass_att')], ['YDS/ATT', (l) => ratio(sum(l, 'pass_yd'), sum(l, 'pass_att')), { rate: 1 }],
    ['RUSH YDS', (l) => sum(l, 'rush_yd')], ['RUSH TD', (l) => sum(l, 'rush_td')], ['FL', (l) => sum(l, 'fum_lost'), { lowerBetter: 1 }]],
  RB: [['G', (l) => l.length], ['RUSH YDS', (l) => sum(l, 'rush_yd')], ['YDS/G', (l) => per(l, 'rush_yd'), { rate: 1 }], ['TD', (l) => sum(l, 'rush_td') + sum(l, 'rec_td')], ['YDS/CAR', (l) => ratio(sum(l, 'rush_yd'), sum(l, 'rush_att')), { rate: 1 }],
    ['CAR', (l) => sum(l, 'rush_att')], ['CAR/G', (l) => per(l, 'rush_att'), { rate: 1 }], ['REC', (l) => sum(l, 'rec')], ['REC/G', (l) => per(l, 'rec'), { rate: 1 }], ['REC YDS', (l) => sum(l, 'rec_yd')],
    ['TGT', (l) => sum(l, 'rec_tgt'), { optional: 1 }], ['FL', (l) => sum(l, 'fum_lost'), { lowerBetter: 1 }]],
  WR: [['G', (l) => l.length], ['REC', (l) => sum(l, 'rec')], ['REC/G', (l) => per(l, 'rec'), { rate: 1 }], ['REC YDS', (l) => sum(l, 'rec_yd')], ['YDS/G', (l) => per(l, 'rec_yd'), { rate: 1 }], ['REC TD', (l) => sum(l, 'rec_td')],
    ['YDS/REC', (l) => ratio(sum(l, 'rec_yd'), sum(l, 'rec')), { rate: 1 }], ['TGT', (l) => sum(l, 'rec_tgt'), { optional: 1 }], ['CATCH%', (l) => ratio(sum(l, 'rec'), sum(l, 'rec_tgt')) * 100, { rate: 1, pct: 1, optional: 1 }],
    ['RUSH YDS', (l) => sum(l, 'rush_yd')], ['FL', (l) => sum(l, 'fum_lost'), { lowerBetter: 1 }]],
};
FOOT.TE = FOOT.WR;
const NBA = [['G', (l) => l.length], ['PTS', (l) => per(l, 'pts'), { rate: 1 }], ['REB', (l) => per(l, 'reb'), { rate: 1 }], ['AST', (l) => per(l, 'ast'), { rate: 1 }], ['3PM', (l) => per(l, 'tpm'), { rate: 1 }],
  ['STL', (l) => per(l, 'stl'), { rate: 1 }], ['BLK', (l) => per(l, 'blk'), { rate: 1 }], ['TO', (l) => per(l, 'to'), { rate: 1, lowerBetter: 1 }], ['MIN', (l) => per(l, 'min'), { rate: 1 }],
  ['FG%', (l) => ratio(sum(l, 'fgm'), sum(l, 'fga')) * 100, { rate: 1, pct: 1, optional: 1 }], ['PRA', (l) => per(l, 'pts') + per(l, 'reb') + per(l, 'ast'), { rate: 1 }]];

const fmtVal = (v, o = {}) => (v == null || Number.isNaN(v) ? '—' : o.pct ? `${f1(v)}` : o.rate || !Number.isInteger(Math.round(v * 10) / 10) ? f1(v) : Math.round(v).toLocaleString());

/** Big three numbers for a game card. */
function headline(sport, pos, s) {
  const n = (k) => Math.round(Number(s?.[k]) || 0);
  if (sport === 'nba') return [[n('pts'), 'pts'], [n('reb'), 'reb'], [n('ast'), 'ast']];
  if (pos === 'QB') return [[n('pass_yd'), 'pass yds'], [n('pass_td') + n('rush_td'), 'td'], [n('rush_yd'), 'rush yds']];
  if (pos === 'RB') return [[n('rush_yd') + n('rec_yd'), 'yds'], [n('rush_td') + n('rec_td'), 'td'], [n('rec'), 'rec']];
  return [[n('rec_yd'), 'yds'], [n('rec_td'), 'td'], [n('rec'), 'rec']];
}
function detailLine(sport, pos, s) {
  const n = (k) => Math.round(Number(s?.[k]) || 0);
  if (sport === 'nba') return `${n('min')} min · ${n('fgm')}/${n('fga')} FG · ${n('tpm')} 3PM · ${n('stl')} stl · ${n('blk')} blk`;
  if (pos === 'QB') return `${n('pass_cmp')}/${n('pass_att')}, ${n('pass_td')} pass TD, ${n('pass_int')} INT · ${n('rush_att')} car${n('rush_td') ? `, ${n('rush_td')} rush TD` : ''}`;
  if (pos === 'RB') return `${n('rush_att')} car, ${n('rush_yd')} yds · ${n('rec')} rec, ${n('rec_yd')} yds`;
  return `${n('rec')}${s?.rec_tgt ? `/${n('rec_tgt')}` : ''} rec · ${n('rush_yd') ? `${n('rush_yd')} rush yds` : 'no rushes'}`;
}

export default function PlayerPage({ id, onClose }) {
  const data = useData();
  const { season, teams, core, fmt = 'ppr', sport = 'nfl', gameByTeam } = data;
  const nba = sport === 'nba';
  const nflRows = useProjectionRows(nba ? null : core?.week);
  const nbaRows = useNbaRows();
  const rows = nba ? nbaRows : nflRows;
  const r = rows?.find((x) => x.id === id);
  const p = season?.players?.get(id);
  const base = r || p;
  const [tab, setTab] = useState('feed');
  const [bio, setBio] = useState(false);
  const [metric, setMetric] = useState('fpts');
  const [favs, setFavs] = useState(() => { try { return JSON.parse(localStorage.getItem('ge:favPlayers')) || []; } catch { return []; } });
  useEffect(() => { document.querySelector('.ppage-scroll')?.scrollTo(0, 0); }, [id]);

  const fp = (l) => (nba ? (l.fp ?? 0) : pts(l.s, fmt));
  const log = useMemo(() => (p?.log || []).map((l) => ({ ...l, fp: fp(l) })), [p, fmt]); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = nba ? (base?.group || base?.pos) : (base?.pos === 'TE' ? 'TE' : base?.pos);
  const cols = nba ? NBA : (FOOT[pos] || FOOT.WR);

  // League ranks: everyone with games, same sport; position rank among same position.
  const ranks = useMemo(() => {
    if (!season?.players || !p) return null;
    const all = [...season.players.values()].filter((x) => x.log?.length).map((x) => ({ x, log: x.log.map((l) => ({ ...l, fp: nba ? (l.fp ?? 0) : pts(l.s, fmt) })) }));
    const lastKey = (l) => (nba ? l.date : l.week);
    const rankBy = (list, val, me) => { const v = val(me); if (v == null) return null; return 1 + list.filter((o) => o !== me && (val(o) ?? -Infinity) > v).length; };
    const meEntry = all.find((e) => e.x.id === p.id);
    if (!meEntry) return null;
    // Last game: the player's most recent game, ranked against everyone who played that week/day.
    const myLast = lastKey(meEntry.log[meEntry.log.length - 1]);
    const lastGame = (e) => e.log.find((l) => lastKey(l) === myLast)?.fp ?? null;
    const last3 = (e) => (e.log.length ? e.log.slice(-3).reduce((a, l) => a + l.fp, 0) / Math.min(3, e.log.length) : null);
    const seasonAvg = (e) => (e.log.length >= 2 ? e.log.reduce((a, l) => a + l.fp, 0) / e.log.length : null);
    const samePos = all.filter((e) => (nba ? e.x.group : e.x.pos) === (nba ? p.group : p.pos));
    const statRanks = cols.map(([label, fn, o = {}]) => {
      if (label === 'G' || (o.optional && !fn(meEntry.log))) return null;
      // Ranked within the player's position; rate stats need a reasonable sample.
      const minG = Math.max(2, Math.floor(Math.max(...samePos.map((e) => e.log.length)) * 0.4));
      const pool = o.rate ? samePos.filter((e) => e.log.length >= minG) : samePos;
      const val = (e) => { const v = fn(e.log); return v == null || Number.isNaN(v) ? null : o.lowerBetter ? -v : v; };
      return pool.includes(meEntry) ? rankBy(pool, val, meEntry) : null;
    });
    return {
      strip: [
        ['Last game', rankBy(all, lastGame, meEntry)],
        ['Last 3', rankBy(all, last3, meEntry)],
        ['Season', rankBy(all, seasonAvg, meEntry)],
        [`${nba ? GROUP[p.group] || 'Pos' : p.pos} rank`, rankBy(samePos, seasonAvg, meEntry)],
      ],
      statRanks,
    };
  }, [season, p, fmt, nba]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!base) {
    return (
      <div className="ppage-scroll">
        <TopBar sport={sport} onClose={onClose} />
        <p className="muted center" style={{ padding: 40 }}>No stats for this player yet.</p>
      </div>
    );
  }
  const t = teams?.[base.team];
  const g = gameByTeam?.[base.team];
  const isFav = favs.includes(id);
  const toggleFav = () => { const next = isFav ? favs.filter((x) => x !== id) : [...favs, id]; setFavs(next); try { localStorage.setItem('ge:favPlayers', JSON.stringify(next)); } catch { /* ignore */ } };
  const league = sport === 'cfb' ? 'cfb' : nba ? 'nba' : 'nfl';
  const share = async () => {
    const line = log.length ? `${log.length} games · ${f1(log.reduce((a, l) => a + l.fp, 0) / log.length)} fantasy pts/g` : '';
    const text = `${base.name} (${base.team} ${pos}) ${line}`;
    try { if (navigator.share) await navigator.share({ title: base.name, text, url: window.location.href }); else await navigator.clipboard.writeText(text); } catch { /* cancelled */ }
  };
  const seasonLabel = nba ? data.core?.label || '' : `${core?.season || ''} season`;
  const chart = log.slice(-10);
  const chartVal = (l) => (metric === 'fpts' ? l.fp : headline(sport, pos, l.s)[0][0]);
  const max = Math.max(1, ...chart.map(chartVal));
  const last3 = log.slice(-3);
  const splitRows = cols.filter(([lab]) => lab !== 'G').slice(0, 5);
  const color = t?.color || 'var(--accent)';

  return (
    <div className="ppage-scroll" style={{ '--pc': color }}>
      <TopBar sport={sport} onClose={onClose} onShare={share} />
      <div className="pp-actions">
        <span className="pp-season">{seasonLabel}</span>
        <button type="button" onClick={() => setBio(true)} aria-label="Bio">🪪 Bio</button>
        <button type="button" className={isFav ? 'on' : ''} onClick={toggleFav} aria-label={isFav ? 'Unfavorite' : 'Favorite'}>{isFav ? '★' : '☆'}</button>
      </div>

      <header className="pp-head">
        <span className="pp-photo"><img src={headshot({ ...base, sport: league === 'cfb' ? 'cfb' : nba ? 'nba' : 'nfl' })} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /></span>
        <div className="pp-id">
          <h2>{base.name}</h2>
          <span className="pp-team"><TeamLogo abbr={base.team} size={22} /> <b>{t?.short || t?.name || base.team}</b> · {pos}{base.injury ? <span className="pp-inj"> · {base.injury}</span> : null}</span>
          <button type="button" className="pp-biolink" onClick={() => setBio(true)}>👤 View bio</button>
        </div>
      </header>

      {ranks && (
        <div className="pp-ranks">
          {ranks.strip.map(([k, v]) => <div key={k}><b>{v ? ordinal(v) : '—'}</b><small>{k}</small></div>)}
        </div>
      )}

      <nav className="pp-tabs">
        <button type="button" className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>Feed</button>
        <button type="button" className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Game log</button>
      </nav>

      {tab === 'feed' ? (
        <>
          <section className="pp-sec">
            <div className="pp-sec-head"><h3>{seasonLabel}</h3><span className="muted small">rank among {nba ? `${(GROUP[base.group] || 'player').toLowerCase()}s` : `${pos}s`}</span></div>
            <div className="pp-grid">
              {cols.map(([label, fn, o = {}], i) => {
                const v = log.length ? fn(log) : null;
                if (o.optional && !v) return null;
                const rk = ranks?.statRanks?.[i];
                return (
                  <div key={label} className="pp-stat">
                    <small>{label}</small>
                    <b>{fmtVal(v, o)}</b>
                    {rk ? <span className={rk === 1 ? 'top' : ''}>{rk === 1 ? '🏆 ' : ''}{ordinal(rk)}</span> : <span>&nbsp;</span>}
                  </div>
                );
              })}
            </div>
          </section>

          {log.length >= 3 && (
            <section className="pp-sec">
              <div className="pp-splits-title">⚡ Splits</div>
              <table className="pp-splits">
                <thead><tr><th /> {splitRows.map(([l]) => <th key={l}>{l}</th>)}</tr></thead>
                <tbody>
                  <tr><td>Season</td>{splitRows.map(([l, fn, o = {}]) => <td key={l}>{fmtVal(fn(log), o)}</td>)}</tr>
                  <tr><td>Last 3</td>{splitRows.map(([l, fn, o = {}]) => { const a = fn(last3); const s = fn(log); const per3 = o.rate || o.pct ? a : a / 3 * log.length; return <td key={l} className={per3 > s * 1.1 ? 'up' : per3 < s * 0.9 ? 'down' : ''}>{fmtVal(a, o)}</td>; })}</tr>
                  {r && <tr><td>{nba ? 'Tonight' : `Wk ${core?.week}`} proj</td>{splitRows.map(([l, fn, o = {}]) => <td key={l}>{fmtVal(fn([{ s: r.s, fp: 0 }]), o)}</td>)}</tr>}
                </tbody>
              </table>
              {r && <p className="muted small">{nba ? 'Tonight' : 'This week'}: {g && g.home.abbr === base.team ? 'vs' : '@'} {r.opp} · projected {f1(r.proj)} fantasy pts</p>}
            </section>
          )}

          {chart.length > 0 && (
            <section className="pp-sec">
              <div className="pp-sec-head">
                <h3>Recent performances</h3>
                <div className="seg">
                  <button type="button" className={metric === 'fpts' ? 'on' : ''} onClick={() => setMetric('fpts')}>Fantasy</button>
                  <button type="button" className={metric === 'main' ? 'on' : ''} onClick={() => setMetric('main')}>{headline(sport, pos, {})[0][1].toUpperCase()}</button>
                </div>
              </div>
              <div className="pp-bars">
                {chart.map((l, i) => {
                  const v = chartVal(l);
                  return (
                    <div key={i} className="pp-bar">
                      <small>{metric === 'fpts' ? f1(v) : v}</small>
                      <span style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
                      <em>{l.opp}</em>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="pp-feed">
            {[...log].reverse().map((l, i) => {
              const h = headline(sport, pos, l.s);
              return (
                <article key={i} className="pp-card">
                  <span className="pp-card-face"><img src={headshot({ ...base, sport: league })} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /><span className="pp-card-badge"><TeamLogo abbr={base.team} size={16} /></span></span>
                  <div>
                    <span className="pp-card-meta">{base.first ? `${base.first[0]}. ${base.last}` : base.name} · {f1(l.fp)} fpts · {nba ? new Date(`${l.date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : `Wk ${l.week}`} vs {l.opp}</span>
                    <span className="pp-card-big">{h.map(([v, u]) => <span key={u}><b>{v}</b><small>{u}</small></span>)}</span>
                    <span className="pp-card-sub">{detailLine(sport, pos, l.s)}</span>
                  </div>
                </article>
              );
            })}
            {!log.length && <p className="muted center">No games played yet this season.</p>}
          </section>
        </>
      ) : (
        <section className="pp-sec">
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>{nba ? 'Date' : 'Wk'}</th><th>Opp</th>{cols.filter(([lab]) => lab !== 'G').slice(0, 6).map(([lab]) => <th key={lab} className="num">{lab}</th>)}<th className="num">FPTS</th></tr></thead>
              <tbody>
                {[...log].reverse().map((l, i) => (
                  <tr key={i} className="static">
                    <td>{nba ? l.date.slice(5) : l.week}</td>
                    <td><span className="cell-opp"><TeamLogo abbr={l.opp} size={16} /> {l.opp}</span></td>
                    {cols.filter(([lab]) => lab !== 'G').slice(0, 6).map(([lab, fn, o = {}]) => <td key={lab} className="num">{fmtVal(fn([l]), o)}</td>)}
                    <td className="num"><strong>{f1(l.fp)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Fantasy points use {FORMATS[fmt]?.label || 'PPR'} scoring{nba ? ' (PrizePicks-style for NBA)' : ''}.</p>
        </section>
      )}
      {bio && createPortal(<BioSheet league={league} name={base.name} espnId={league === 'cfb' ? base.id : null} onClose={() => setBio(false)} />, document.body)}
    </div>
  );
}

function TopBar({ sport, onClose, onShare }) {
  return (
    <div className="pp-top">
      <button type="button" className="pp-round" onClick={onClose} aria-label="Back">‹</button>
      <div className="pp-title"><small>{sport.toUpperCase()}</small><b>Player</b></div>
      {onShare ? <button type="button" className="pp-round" onClick={onShare} aria-label="Share">➤</button> : <span className="pp-round ghost" />}
    </div>
  );
}
