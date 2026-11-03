import { useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { Card, SkeletonRows, useUi } from '../../components/ui.jsx';
import { Face, TourTabs } from '../components.jsx';

export default function TennisRankings() {
  const { data } = useData();
  const { openPlayer } = useUi();
  const [q, setQ] = useState('');
  const [by, setBy] = useState('rank');
  const rows = useMemo(() => {
    if (!data) return [];
    const ranked = data.rankings.map((r) => ({ ...r, ...(data.players[r.id] || { id: r.id, name: r.name }), rank: r.rank, prev: r.prev, points: r.points }));
    const ids = new Set(ranked.map((r) => r.id));
    const others = Object.values(data.players).filter((p) => !ids.has(p.id) && p.n >= 10);
    let list = by === 'elo' ? [...ranked, ...others].filter((p) => p.elo).sort((a, b) => b.elo - a.elo) : ranked;
    const n = q.trim().toLowerCase();
    if (n) list = [...ranked, ...others].filter((p) => p.name?.toLowerCase().includes(n));
    return list;
  }, [data, q, by]);
  if (!data) return <div className="page"><Card><SkeletonRows n={10} h={48} /></Card></div>;
  return (
    <div className="page">
      <TourTabs />
      <div className="toolbar">
        <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any player" aria-label="Search players" autoFocus={(() => { try { const f = sessionStorage.getItem('ge:focusSearch'); sessionStorage.removeItem('ge:focusSearch'); return !!f; } catch { return false; } })()} /></div>
        <div className="seg">
          <button type="button" className={by === 'rank' ? 'on' : ''} onClick={() => setBy('rank')}>Official ranking</button>
          <button type="button" className={by === 'elo' ? 'on' : ''} onClick={() => setBy('elo')}>Model rating</button>
        </div>
      </div>
      <ol className="t-rank">
        {rows.slice(0, 200).map((p, i) => {
          const form = (p.recent || []).slice(0, 5);
          const move = p.prev && p.rank ? p.prev - p.rank : 0;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => openPlayer(p.id)}>
                <span className="t-rank-n">{by === 'elo' && !q ? i + 1 : p.rank || '–'}{move ? <small className={move > 0 ? 'pos-txt' : 'neg-txt'}>{move > 0 ? '▲' : '▼'}{Math.abs(move)}</small> : null}</span>
                <Face p={p} size={40} />
                <span className="t-rank-main"><b>{p.name}</b><small>{p.points ? `${p.points.toLocaleString()} pts · ` : ''}{p.w + p.l ? `${p.w}-${p.l} this season` : 'no results this season'}</small></span>
                <span className="t-form-dots">{form.map((r) => <span key={r.id} className={r.win ? 'w' : 'l'} />)}</span>
                <span className="t-rank-elo"><b>{p.elo ?? '–'}</b><small>rating</small></span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
