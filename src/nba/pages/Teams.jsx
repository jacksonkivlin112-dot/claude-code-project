import { useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { Card, Empty, Meter, Segmented, SkeletonRows, TeamLogo, f1, pct, useUi } from '../../components/ui.jsx';
import { DateNav, useNbaOutlook } from '../components.jsx';

export default function NbaTeams() {
  const { standings, isToday } = useData();
  const outlook = useNbaOutlook();
  const { openTeam } = useUi();
  const [conf, setConf] = useState('East');

  const rows = useMemo(() => standings.filter((s) => s.conf === conf).sort((a, b) => (a.seed || 99) - (b.seed || 99) || b.pct - a.pct), [standings, conf]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Team outlook</p>
          <h1>{isToday ? 'Tonight’s' : 'Slate'} Team Rankings</h1>
          <p className="hero-sub">Projected points blend the sum of every player’s projected points (55%) with a ratings model from points scored and allowed per game (45%), adjusted for home court and back-to-backs. Outlook ranks projected points (60%) and fantasy volume (40%).</p>
        </div>
        <DateNav />
      </div>

      <Card pad={false}>
        {!outlook ? <div className="card-body"><SkeletonRows n={10} /></div> : outlook.teams.length === 0 ? <Empty title="No games on this date" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th><th>Team</th><th>Opponent</th><th className="num">Proj</th><th className="num hide-sm">Spread</th>
                  <th className="hide-sm">Win prob</th><th className="num hide-md">Total</th><th className="num hide-md">PPG</th><th className="num hide-md">Opp PPG</th>
                  <th className="num hide-sm">Fantasy</th><th className="num">Outlook</th>
                </tr>
              </thead>
              <tbody>
                {outlook.teams.map((t, i) => (
                  <tr key={t.abbr} onClick={() => openTeam(t.abbr)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTeam(t.abbr)}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <div className="cell-player">
                        <TeamLogo abbr={t.abbr} size={28} />
                        <div>
                          <div className="cell-name">{t.abbr}{t.b2b && <span className="tag tone-warn" title="Second night of a back-to-back">B2B</span>}</div>
                          <div className="cell-meta">{t.record}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="cell-opp"><span className="muted">{t.home ? 'vs' : '@'}</span> <TeamLogo abbr={t.opp} size={18} /> {t.opp}</span></td>
                    <td className="num"><strong>{f1(t.projPts)}</strong></td>
                    <td className="num hide-sm">{t.margin > 0 ? `-${f1(t.margin)}` : `+${f1(-t.margin)}`}</td>
                    <td className="hide-sm"><div className="wp-cell"><Meter value={t.winProb * 100} tone={t.winProb >= 0.6 ? 'great' : t.winProb >= 0.45 ? 'good' : 'bad'} /><span>{pct(t.winProb)}</span></div></td>
                    <td className="num hide-md">{f1(t.total)}</td>
                    <td className="num hide-md">{t.offPpg ? f1(t.offPpg) : '—'}</td>
                    <td className="num hide-md">{t.defPpg ? f1(t.defPpg) : '—'}</td>
                    <td className="num hide-sm">{f1(t.fantasy)}</td>
                    <td className="num"><span className={`score-pill ${t.outlook >= 75 ? 'great' : t.outlook >= 50 ? 'good' : t.outlook >= 25 ? 'neutral' : 'bad'}`}>{t.outlook}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="section-head">
        <h2>Standings</h2>
        <Segmented options={[{ value: 'East', label: 'East' }, { value: 'West', label: 'West' }]} value={conf} onChange={setConf} label="Conference" />
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="Standings unavailable right now" /> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr><th className="num">Seed</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">Pct</th><th className="num">GB</th><th className="num hide-sm">Home</th><th className="num hide-sm">Road</th><th className="num hide-md">L10</th><th className="num hide-sm">PPG</th><th className="num hide-sm">Opp</th><th className="num">Diff</th><th className="num">Strk</th></tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const gp = s.wins + s.losses;
                  const zone = s.seed <= 6 ? 'playoff' : s.seed <= 10 ? 'playin' : '';
                  return (
                    <tr key={s.abbr} className={`seed-${zone}`} onClick={() => openTeam(s.abbr)}>
                      <td className="num"><span className={`seed-badge ${zone}`}>{s.seed || '—'}</span></td>
                      <td><span className="cell-opp"><TeamLogo abbr={s.abbr} size={20} /> <strong>{s.abbr}</strong></span></td>
                      <td className="num">{s.wins}</td>
                      <td className="num">{s.losses}</td>
                      <td className="num">{s.pct.toFixed(3).replace(/^0/, '')}</td>
                      <td className="num">{s.gb}</td>
                      <td className="num hide-sm">{s.home}</td>
                      <td className="num hide-sm">{s.road}</td>
                      <td className="num hide-md">{s.last10}</td>
                      <td className="num hide-sm">{s.ppg ? f1(s.ppg) : '—'}</td>
                      <td className="num hide-sm">{s.oppg ? f1(s.oppg) : '—'}</td>
                      <td className={`num ${s.diff > 0 ? 'pos-txt' : s.diff < 0 ? 'neg-txt' : ''}`}>{gp ? `${s.diff > 0 ? '+' : ''}${f1(s.diff / gp)}` : '—'}</td>
                      <td className={`num ${s.streak.startsWith('W') ? 'pos-txt' : s.streak.startsWith('L') ? 'neg-txt' : ''}`}>{s.streak}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="legend"><span className="seed-badge playoff">1–6</span><span>Playoffs</span><span className="seed-badge playin">7–10</span><span>Play-In</span><span className="muted">· Diff = point differential per game</span></div>
    </div>
  );
}
