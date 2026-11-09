import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../data.jsx';
import { Avatar, TeamLogo, useUi } from './ui.jsx';
import { Face } from '../tennis/components.jsx';

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Full-screen search for players (and teams) in the current sport. */
export default function SearchSheet({ sport, onClose }) {
  const data = useData() || {};
  const { openPlayer, openTeam } = useUi();
  const [q, setQ] = useState('');
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
    window.history.pushState({ geSearch: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('popstate', onPop);
      document.body.classList.remove('no-scroll');
      if (window.history.state?.geSearch) window.history.back();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tennis = sport === 'tennis';
  const players = useMemo(() => {
    if (tennis) {
      const d = data.data;
      if (!d) return [];
      const rank = new Map((d.rankings || []).map((r) => [r.id, r.rank]));
      return Object.values(d.players || {}).filter((p) => p.name).map((p) => ({ id: p.id, name: p.name, sub: rank.has(p.id) ? `#${rank.get(p.id)} in the world` : p.country || '', raw: p, rank: rank.get(p.id) ?? 9999 }));
    }
    const out = [];
    for (const p of data.season?.players?.values() || []) {
      if (!p.name || p.pos === 'DEF') continue;
      out.push({ id: p.id, name: p.name, sub: [p.pos, p.team].filter(Boolean).join(' · '), raw: p, rank: -(p.log?.length || p.gp || 0) });
    }
    return out;
  }, [data.data, data.season, tennis]);
  const teams = useMemo(() => (tennis ? [] : Object.entries(data.teams || {}).map(([abbr, t]) => ({ abbr, name: t?.name || abbr }))), [data.teams, tennis]);

  const n = norm(q.trim());
  const hits = n.length < 2 ? [] : players
    .map((p) => { const nm = norm(p.name); const i = nm.indexOf(n); const last = nm.split(' ').slice(-1)[0]; return i < 0 ? null : { p, score: (i === 0 || last.startsWith(n) ? 0 : 1) * 1e5 + p.rank }; })
    .filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 30).map((x) => x.p);
  const teamHits = n.length < 2 ? [] : teams.filter((t) => norm(t.name).includes(n) || norm(t.abbr) === n).slice(0, 6);
  const pick = (fn) => { onClose(); setTimeout(fn, 60); };

  return createPortal(
    <div className="srch" role="dialog" aria-modal="true" aria-label="Search">
      <div className="srch-bar">
        <span className="srch-field">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" /></svg>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tennis ? 'Search any player' : 'Search players or teams'} aria-label="Search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) pick(() => openPlayer(hits[0].id)); if (e.key === 'Escape') onClose(); }} />
          {q && <button type="button" className="srch-clear" onClick={() => { setQ(''); input.current?.focus(); }} aria-label="Clear">✕</button>}
        </span>
        <button type="button" className="srch-cancel" onClick={onClose}>Cancel</button>
      </div>
      <div className="srch-list">
        {n.length < 2 ? (
          <p className="srch-hint">{players.length ? `Type a name — ${players.length.toLocaleString()} ${tennis ? 'players' : 'players and every team'} loaded.` : 'Loading players…'}</p>
        ) : hits.length + teamHits.length === 0 ? (
          <p className="srch-hint">No match for “{q}”.</p>
        ) : (
          <>
            {teamHits.map((t) => (
              <button key={`t-${t.abbr}`} type="button" className="srch-row" onClick={() => pick(() => openTeam(t.abbr))}>
                <TeamLogo abbr={t.abbr} size={40} />
                <span><b>{t.name}</b><small>Team</small></span>
                <span className="srch-go">›</span>
              </button>
            ))}
            {hits.map((p) => (
              <button key={p.id} type="button" className="srch-row" onClick={() => pick(() => openPlayer(p.id))}>
                {tennis ? <Face p={p.raw} size={40} /> : <Avatar player={{ ...p.raw, sport, first: p.raw.first || p.name.split(' ')[0], last: p.raw.last || p.name.split(' ').slice(-1)[0] }} size={40} />}
                <span><b>{p.name}</b><small>{p.sub}</small></span>
                <span className="srch-go">›</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
