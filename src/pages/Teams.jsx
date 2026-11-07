import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { useTeamOutlook } from '../components/players.jsx';
import { Card, Empty, Meter, Segmented, SkeletonRows, TeamLogo, f1, pct, useUi } from '../components/ui.jsx';

export default function Teams() {
  const { core, standings, sport } = useData();
  const outlook = useTeamOutlook();
  const { openTeam } = useUi();
  const [conf, setConf] = useState('AFC');

  const divisions = useMemo(() => {
    const m = {};
    for (const s of standings.filter((x) => x.conf === conf)) (m[s.div] ||= []).push(s);
    for (const k of Object.keys(m)) m[k].sort((a, b) => b.pct - a.pct || b.diff - a.diff);
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [standings, conf]);

  const seeds = useMemo(
    () => standings.filter((s) => s.conf === conf && s.seed && s.seed <= 7).sort((a, b) => a.seed - b.seed),
    [standings, conf],
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Team outlook</p>
          <h1>Week {core?.week} Team Rankings</h1>
          <p className="hero-sub">
            Projected points blend {sport === 'cfb' ? 'DraftKings-implied team totals' : 'Sleeper’s implied team totals'} (65%) with a ratings model built from points scored and allowed per game (35%), with home field included. The outlook score ranks projected points and fantasy volume.
          </p>
        </div>
      </div>

      <Card pad={false}>
        {!outlook ? (
          <div className="card-body"><SkeletonRows n={10} /></div>
        ) : outlook.teams.length === 0 ? (
          <Empty title="No games scheduled this week" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Team</th>
                  <th>Opponent</th>
                  <th className="num">Proj</th>
                  <th className="num hide-sm">Spread</th>
                  <th className="hide-sm">Win prob</th>
                  <th className="num hide-md" title="Points scored per game">Off PPG</th>
                  <th className="num hide-md" title="Points allowed per game">Def PPG</th>
                  <th className="num hide-sm" title="Sum of projected fantasy points for the team's skill players">Fantasy</th>
                  <th className="num">Outlook</th>
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
                          <div className="cell-name">{t.abbr}</div>
                          <div className="cell-meta">{t.record}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="cell-opp"><span className="muted">{t.home ? 'vs' : '@'}</span> <TeamLogo abbr={t.opp} size={18} /> {t.opp}</span></td>
                    <td className="num"><strong>{f1(t.projPts)}</strong></td>
                    <td className="num hide-sm">{t.margin > 0 ? `-${f1(t.margin)}` : `+${f1(-t.margin)}`}</td>
                    <td className="hide-sm">
                      <div className="wp-cell">
                        <Meter value={t.winProb * 100} tone={t.winProb >= 0.6 ? 'great' : t.winProb >= 0.45 ? 'good' : 'bad'} />
                        <span>{pct(t.winProb)}</span>
                      </div>
                    </td>
                    <td className="num hide-md">{f1(t.offPpg)}</td>
                    <td className="num hide-md">{f1(t.defPpg)}</td>
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
        <Segmented options={['AFC', 'NFC']} value={conf} onChange={setConf} label="Conference" />
      </div>
      {standings.length === 0 ? (
        <Card><Empty title="Standings unavailable right now" /></Card>
      ) : (
        <div className="grid-standings">
          <div className="grid-2">
            {divisions.map(([name, rows]) => (
              <Card key={name} title={name} pad={false}>
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th className="num">W</th>
                      <th className="num">L</th>
                      <th className="num hide-sm">PF</th>
                      <th className="num hide-sm">PA</th>
                      <th className="num">Diff</th>
                      <th className="num">Strk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.abbr} onClick={() => openTeam(s.abbr)}>
                        <td>
                          <span className="cell-opp">
                            <TeamLogo abbr={s.abbr} size={20} /> <strong>{s.abbr}</strong>
                            {s.seed && s.seed <= 7 && <span className="seed" title={`Current #${s.seed} seed`}>{s.seed}</span>}
                          </span>
                        </td>
                        <td className="num">{s.wins}</td>
                        <td className="num">{s.losses}{s.ties ? `-${s.ties}` : ''}</td>
                        <td className="num hide-sm">{s.pf}</td>
                        <td className="num hide-sm">{s.pa}</td>
                        <td className={`num ${s.diff > 0 ? 'pos-txt' : s.diff < 0 ? 'neg-txt' : ''}`}>{s.diff > 0 ? `+${s.diff}` : s.diff}</td>
                        <td className={`num ${s.streak.startsWith('W') ? 'pos-txt' : s.streak.startsWith('L') ? 'neg-txt' : ''}`}>{s.streak}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
          <Card title="Playoff picture" subtitle={`${conf} seeds if the season ended today`}>
            <ol className="seeds">
              {seeds.map((s) => (
                <li key={s.abbr} className={s.seed === 1 ? 'bye' : ''} onClick={() => openTeam(s.abbr)}>
                  <span className="seed-n">{s.seed}</span>
                  <TeamLogo abbr={s.abbr} size={22} />
                  <strong>{s.abbr}</strong>
                  <span className="muted">{s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ''}</span>
                  {s.seed === 1 && <span className="tag tone-good">Bye</span>}
                  {s.seed === 7 && <span className="cutline" aria-hidden />}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}
