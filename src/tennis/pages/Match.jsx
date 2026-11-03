import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import GameTabs from '../../components/GameTabs.jsx';
import { Card, Empty, SkeletonRows, useNow, useUi } from '../../components/ui.jsx';
import { Face, PlayerStats, Results, WinBar, matchHref } from '../components.jsx';
import { etDay, matchModel, scoreState } from '../data.jsx';
import { americanOdds, overProb } from '../model.js';

const pct = (p, d = 0) => `${(p * 100).toFixed(d)}%`;
const last = (name) => name.split(' ').slice(-1)[0];

export default function TennisMatch({ params }) {
  const { tours, tour: curTour, setTour } = useData();
  const tour = params.get('tour') || curTour;
  const d = tours?.[tour];
  const m = d?.matches.find((x) => x.id === params.get('id'));
  const [tab, setTab] = useState('preview');
  useNow(15000);
  useEffect(() => { if (tour !== curTour) setTour(tour); }, [tour]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="page"><Card><SkeletonRows n={6} h={44} /></Card></div>;
  if (!m) return <div className="page"><Card><Empty title="Match not found">It may be from an earlier week. <a className="link" href="#/tennis/home">Back to today</a></Empty></Card></div>;
  const model = matchModel(m, d);

  return (
    <div className="page game-page t-matchpage">
      <div className="game-dock">
        <Switcher m={m} d={d} tour={tour} />
        <Board m={m} model={model} />
        <GameTabs value={tab} onChange={setTab} tabs={[{ value: 'preview', label: 'Odds' }, { value: 'form', label: 'Form' }, { value: 'h2h', label: 'Head to head' }]} />
      </div>
      {tab === 'preview' && <Preview m={m} model={model} />}
      {tab === 'form' && <Form m={m} model={model} />}
      {tab === 'h2h' && <H2H m={m} d={d} />}
    </div>
  );
}

function Switcher({ m, d, tour }) {
  const day = etDay(m.date);
  const ORDER = { in: 0, pre: 1, post: 2 };
  const list = d.matches.filter((x) => etDay(x.date) === day).sort((a, b) => ORDER[a.state] - ORDER[b.state] || new Date(a.date) - new Date(b.date));
  return (
    <div className="gsw">
      <a className="gsw-back" href="#/tennis/home" aria-label="Back">‹</a>
      <div className="gsw-strip">
        {list.map((x) => (
          <a key={x.id} href={matchHref(x, tour)} className={`gsw-item ${x.id === m.id ? 'on' : ''}`}>
            <small>{x.state === 'in' && <span className="live-dot" />}{x.state === 'pre' ? new Date(x.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : x.state === 'in' ? x.detail : 'Final'}</small>
            <span>{last(x.a.name)} v {last(x.b.name)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Board({ m, model }) {
  const { openPlayer } = useUi();
  const p = model.liveP ?? model.p;
  return (
    <div className="t-board">
      <div className="t-board-meta">
        <span>{m.event} · {m.round}</span>
        {m.state === 'in' ? <b className="t-live"><span className="live-dot" /> {m.detail || 'Live'}</b> : m.state === 'pre' ? <b>{new Date(m.date).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</b> : <b>{/RETIRED|WALKOVER/.test(m.status) ? m.detail : 'Final'}</b>}
      </div>
      {[['a', m.a], ['b', m.b]].map(([k, pl]) => (
        <button key={k} type="button" className={`t-board-row ${m.winner && m.winner !== k ? 'lost' : ''}`} onClick={() => openPlayer(pl.id)}>
          <Face p={pl} size={48} />
          <span className="t-board-name"><b>{pl.name}</b><small>{[pl.seed && `Seed ${pl.seed}`, (model[k === 'a' ? 'pa' : 'pb']?.rank) && `#${model[k === 'a' ? 'pa' : 'pb'].rank}`].filter(Boolean).join(' · ')}</small></span>
          <span className="t-board-sets">
            {m.sets.map((s, i) => {
              const mine = k === 'a' ? s[0] : s[1];
              const other = k === 'a' ? s[1] : s[0];
              return <span key={i} className={`t-set ${s.includes('open') ? 'open' : mine > other ? 'w' : ''}`}>{mine}{typeof s[2] === 'number' && mine < other ? <sup>{s[2]}</sup> : null}</span>;
            })}
          </span>
          {m.state !== 'post' && <span className={`t-board-pct ${(k === 'a' ? p : 1 - p) >= 0.5 ? 'fav' : ''}`}>{pct(k === 'a' ? p : 1 - p)}</span>}
        </button>
      ))}
    </div>
  );
}

function Preview({ m, model }) {
  const { outlook: o, bestOf } = model;
  const A = last(m.a.name);
  const B = last(m.b.name);
  const lines = bestOf === 5 ? [32.5, 34.5, 36.5, 38.5, 40.5] : [18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5];
  const dist = [...o.totalGames.entries()].sort((x, y) => x[0] - y[0]);
  const maxP = Math.max(...dist.map((x) => x[1]));
  const st = m.state === 'in' ? scoreState(m) : null;
  const pre = m.state === 'pre' ? '' : 'Before the match · ';
  return (
    <div className="t-preview">
      {m.state === 'post' && <p className="muted small">Final. Before the match the model gave {m.a.name} {pct(model.p)} to win.</p>}
      <Card title={m.state === 'in' ? 'Live win chance' : 'Win chance'} subtitle={m.state === 'in' ? `From ${st.a}-${st.b} in sets and ${st.x}-${st.y} in the current set · was ${pct(model.p)} / ${pct(1 - model.p)} before the match` : `Best of ${bestOf} sets · fair odds ${americanOdds(model.p)} / ${americanOdds(1 - model.p)}`}>
        <WinBar p={model.liveP ?? model.p} a={A} b={B} />
        {model.thin && <p className="muted small">One of these players has fewer than 10 rated matches, so treat this one with extra caution.</p>}
      </Card>
      <div className="t-grid">
        <Card title="Set score" subtitle={`${pre}Chance of each final score`}>
          <table className="rec-table">
            <tbody>
              {o.setScores.map((s) => (
                <tr key={`${s.a}-${s.b}`}><td>{s.a > s.b ? A : B} {Math.max(s.a, s.b)}-{Math.min(s.a, s.b)}</td><td>{pct(s.p)}</td><td className="muted">{americanOdds(s.p)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{A} in straight sets {pct(o.straightSetsA)} · {B} in straight sets {pct(o.straightSetsB)} · goes the distance {pct(o.goesDistance)}</p>
        </Card>
        <Card title="Total games" subtitle={`${pre}Model average ${o.meanGames.toFixed(1)} games`}>
          <div className="t-dist" aria-hidden>
            {dist.filter(([, v]) => v > 0.004).map(([g, v]) => <span key={g} title={`${g} games: ${pct(v, 1)}`} style={{ height: `${(v / maxP) * 100}%` }}><small>{g % 2 === 0 ? g : ''}</small></span>)}
          </div>
          <table className="rec-table">
            <thead><tr><th>Line</th><th>Over</th><th>Under</th><th>Fair (O/U)</th></tr></thead>
            <tbody>
              {lines.map((l) => { const ov = overProb(o, l); return <tr key={l}><td>{l}</td><td className={ov >= 0.5 ? 'pos-txt' : ''}>{pct(ov)}</td><td className={ov < 0.5 ? 'pos-txt' : ''}>{pct(1 - ov)}</td><td className="muted">{americanOdds(ov)} / {americanOdds(1 - ov)}</td></tr>; })}
            </tbody>
          </table>
          <p className="muted small">Compare a sportsbook’s total-games line to this table. Total games are noisy: the model’s average miss is about {bestOf === 5 ? 6 : 5} games.</p>
        </Card>
        <Card title="Each to win a set" subtitle={pre ? 'Before the match' : undefined}>
          <table className="rec-table">
            <tbody>
              <tr><td>{A} wins a set</td><td>{pct(1 - o.straightSetsB)}</td><td className="muted">{americanOdds(1 - o.straightSetsB)}</td></tr>
              <tr><td>{B} wins a set</td><td>{pct(1 - o.straightSetsA)}</td><td className="muted">{americanOdds(1 - o.straightSetsA)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function Form({ m, model }) {
  return (
    <div className="t-form">
      {[[m.a, model.pa], [m.b, model.pb]].map(([pl, p]) => (
        <Card key={pl.id} title={pl.name} subtitle={p?.rank ? `World #${p.rank}` : 'Unranked'}>
          {p ? <><PlayerStats p={p} /><Results list={p.recent} /></> : <p className="muted small">No results on file for this player yet.</p>}
        </Card>
      ))}
    </div>
  );
}

function H2H({ m, d }) {
  const key = [m.a.id, m.b.id].sort().join('|');
  const list = useMemo(() => [...(d.h2h?.[key] || [])].sort((a, b) => new Date(b.date) - new Date(a.date)), [d, key]);
  const aw = list.filter((x) => x.winner === m.a.id).length;
  return (
    <Card title="Head to head" subtitle="Since the start of last season">
      {list.length === 0 ? <p className="muted">These two haven’t met since the start of last season.</p> : (
        <>
          <p className="t-h2h-sum"><b>{last(m.a.name)} {aw}</b> – <b>{list.length - aw} {last(m.b.name)}</b></p>
          <ol className="t-results">
            {list.map((x) => (
              <li key={x.date}>
                <span className={`t-wl ${x.winner === m.a.id ? 'w' : 'l'}`}>{x.winner === m.a.id ? last(m.a.name)[0] : last(m.b.name)[0]}</span>
                <span className="t-res-main"><b>{x.winner === m.a.id ? m.a.name : m.b.name}</b><small>{x.event} · {x.round} · {new Date(x.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</small></span>
                <span className="t-res-score">{x.aId === (x.winner) ? x.score : x.score.split(' ').map((s) => s.split('-').reverse().join('-')).join(' ')}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
