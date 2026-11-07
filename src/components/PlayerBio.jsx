import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Player bio from ESPN: age, size, hometown, college, draft, contract and news.
// NFL/NBA players are matched to ESPN by name; CFB and tennis already use ESPN ids.
const PATH = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', atp: 'tennis/atp', wta: 'tennis/wta' };
const SLUG = { nfl: 'nfl', cfb: 'college-football', nba: 'nba', atp: 'atp', wta: 'wta' };
const WEB = 'https://site.web.api.espn.com/apis/common/v3';
const CORE = 'https://sports.core.api.espn.com/v2/sports';
const cache = new Map();
const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function loadBio(league, name, espnId) {
  const key = `${league}:${espnId || norm(name)}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    let id = espnId;
    if (!id) {
      const s = await getJSON(`${WEB}/search?query=${encodeURIComponent(name)}&limit=8&type=player`);
      const items = (s.items || []).filter((i) => i.defaultLeagueSlug === SLUG[league] || i.league === SLUG[league]);
      id = (items.find((i) => norm(i.displayName) === norm(name)) || items[0])?.id;
      if (!id) throw new Error('not found');
    }
    const [ath, ov] = await Promise.all([
      getJSON(`${WEB}/sports/${PATH[league]}/athletes/${id}`),
      getJSON(`${WEB}/sports/${PATH[league]}/athletes/${id}/overview`).catch(() => ({})),
    ]);
    let contract = null;
    if (league === 'nfl' || league === 'nba') {
      try {
        const list = await getJSON(`${CORE}/${PATH[league].replace('/', '/leagues/')}/athletes/${id}/contracts`);
        const refs = (list.items || []).map((x) => x.$ref).filter(Boolean);
        const year = (u) => Number(u.match(/contracts\/(\d{4})/)?.[1] || 0);
        // This season's contract year: NFL seasons are named by start year, NBA seasons by end year.
        const now = new Date();
        const target = league === 'nba' ? now.getFullYear() + (now.getMonth() >= 7 ? 1 : 0) : now.getFullYear() - (now.getMonth() < 2 ? 1 : 0);
        const years = refs.map(year);
        const pickYear = years.includes(target) ? target : Math.max(...years.filter((y) => y <= target), -1) > 0 ? Math.max(...years.filter((y) => y <= target)) : Math.min(...years);
        const latest = refs.find((u) => year(u) === pickYear);
        if (latest) contract = { ...(await getJSON(latest.replace('http://', 'https://'))), year: pickYear, nba: league === 'nba' };
      } catch { /* no contract data */ }
    }
    return { id, a: ath.athlete || {}, news: ov.news || [], note: ov.rotowire || null, contract };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

const money = (n) => (n == null ? null : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`);
const ago = (iso) => {
  const d = (Date.now() - new Date(iso).getTime()) / 864e5;
  return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : d < 30 ? `${Math.floor(d)} days ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/** "Bio" button for a player sheet header; opens the bio over the sheet. */
export default function PlayerBio({ league, name, espnId }) {
  const [open, setOpen] = useState(false);
  if (!PATH[league]) return null;
  return (
    <>
      <button type="button" className="bio-btn" onClick={() => setOpen(true)}>Bio</button>
      {open && createPortal(<BioSheet league={league} name={name} espnId={espnId} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export function BioSheet({ league, name, espnId, onClose }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    loadBio(league, name, espnId).then((d) => alive && setState({ d })).catch(() => alive && setState({ error: true }));
    return () => { alive = false; };
  }, [league, name, espnId]);
  useEffect(() => {
    const on = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [onClose]);
  const d = state.d;
  const a = d?.a || {};
  const c = d?.contract;
  const facts = d ? [
    ['Age', a.age ? `${a.age}${a.displayDOB ? ` · born ${new Date(a.dateOfBirth || a.displayDOB.split('/').reverse().join('-')).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}` : null],
    ['Height', a.displayHeight], ['Weight', a.displayWeight], ['Hometown', a.displayBirthPlace],
    ['College', league !== 'cfb' ? a.college?.name : null], ['Class', league === 'cfb' ? a.displayExperience : null],
    ['Draft', a.displayDraft], ['Experience', league !== 'cfb' ? a.displayExperience : null],
    ['Position', a.position?.displayName], ['Jersey', a.displayJersey || (a.jersey ? `#${a.jersey}` : null)], ['Status', a.status?.name],
  ].filter(([, v]) => v) : [];

  return (
    <div className="bio-sheet" role="dialog" aria-modal="true" aria-label={`${name} bio`}>
      <header className="bio-head">
        <button type="button" className="bio-back" onClick={onClose} aria-label="Back">‹</button>
        <div>
          <strong>{a.displayName || name}</strong>
          <small>{[a.position?.abbreviation, a.team?.displayName || a.collegeTeam?.displayName].filter(Boolean).join(' · ')}</small>
        </div>
      </header>
      <div className="bio-body">
        {state.loading && <p className="muted">Loading bio…</p>}
        {state.error && <p className="muted">Couldn’t load a bio for {name} right now.</p>}
        {d && (
          <>
            <section>
              <h3>Bio</h3>
              <div className="bio-facts">{facts.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
            </section>

            {(league === 'nfl' || league === 'nba') && (
              <section>
                <h3>Contract</h3>
                {c ? (
                  <div className="bio-facts">
                    {c.salary != null && <div><small>{c.nba ? `${c.year - 1}-${String(c.year).slice(2)}` : c.year} salary</small><b>{money(c.salary)}</b></div>}
                    {c.salaryRemaining != null && <div><small>Remaining</small><b>{money(c.salaryRemaining)}</b></div>}
                    {c.yearsRemaining != null && <div><small>Years left</small><b>{c.yearsRemaining}</b></div>}
                    {c.signedThrough != null && <div><small>Signed through</small><b>{c.signedThrough}</b></div>}
                    {c.bonus ? <div><small>Bonus</small><b>{money(c.bonus)}</b></div> : null}
                    {c.salary == null && c.incomingTradeValue != null && <div><small>{c.year} cap value</small><b>{money(c.incomingTradeValue)}</b></div>}
                  </div>
                ) : <p className="muted small">No contract details on file.</p>}
              </section>
            )}
            {league === 'cfb' && <p className="muted small">College players don’t have public contracts (NIL deals aren’t disclosed).</p>}

            {d.note?.headline && (
              <section>
                <h3>Latest update</h3>
                <div className="bio-note">
                  <b>{d.note.headline}</b>
                  {d.note.story && <p>{d.note.story}</p>}
                  {d.note.published && <small className="muted">{ago(d.note.published)}</small>}
                </div>
              </section>
            )}

            <section>
              <h3>News</h3>
              {d.news.length === 0 ? <p className="muted small">No recent news.</p> : (
                <ol className="bio-news">
                  {d.news.slice(0, 10).map((n) => (
                    <li key={n.id || n.headline}>
                      <a href={n.links?.web?.href || n.links?.mobile?.href || '#'} target="_blank" rel="noreferrer">
                        {n.images?.[0]?.url && <img src={n.images[0].url} alt="" loading="lazy" />}
                        <span><b>{n.headline}</b><small>{n.lastModified || n.published ? ago(n.lastModified || n.published) : ''}{n.description ? ` · ${n.description}` : ''}</small></span>
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <p className="muted small">Bio, contract and news from ESPN.</p>
          </>
        )}
      </div>
    </div>
  );
}
