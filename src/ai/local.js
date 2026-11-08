// Free mode: answers common questions without an API key by recognizing what's being asked
// and running the same tools the Claude assistant uses. Replies are short and formatted like the AI's.
import { normName } from '../oddsapi.js';
import { loadSlips, settleBet } from '../slips.js';
import { findMarket, runTool } from './tools.js';

const pct = (p) => (p == null ? '—' : `${Math.round(p)}%`);

function detectSport(q, tab) {
  if (/\b(tennis|atp|wta|set|sets)\b/.test(q)) return 'tennis';
  if (/\b(cfb|college|ncaa|ncaaf)\b/.test(q)) return 'cfb';
  if (/\b(nba|basketball|rebounds?|assists?|threes|3pm|pra)\b/.test(q)) return 'nba';
  if (/\b(nfl|football|touchdowns?|rushing|receiving|passing|receptions?)\b/.test(q)) return tab === 'cfb' ? 'cfb' : 'nfl';
  return tab;
}

/** Find a player named in the question (full name first, then a unique last name). */
function findPlayer(q, sink, sport) {
  const nq = ` ${q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')} `;
  const leagues = sport && sink[sport] ? [sport, ...['nfl', 'nba', 'cfb'].filter((s) => s !== sport)] : ['nfl', 'nba', 'cfb'];
  let lastHits = [];
  for (const lg of leagues) {
    const S = sink[lg];
    if (!S?.ctx) continue;
    const pool = [...(S.rows || []), ...(S.ctx.season?.players?.values() || [])];
    for (const p of pool) {
      if (p.pos === 'DEF' || p.pos === 'K') continue; // team defenses are teams, not players
      const full = (p.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (full && nq.includes(` ${full} `)) return { name: p.name, sport: lg };
      const last = full.split(' ').slice(-1)[0];
      if (last && last.length >= 4 && nq.includes(` ${last} `) && !lastHits.some((h) => h.name === p.name)) lastHits.push({ name: p.name, sport: lg });
    }
    if (lastHits.length === 1) return lastHits[0];
  }
  return lastHits.length === 1 ? lastHits[0] : null;
}

function findTeam(q, sink, sport) {
  const S = sink[sport];
  const teams = S?.data?.teams || {};
  const up = ` ${q.toUpperCase().replace(/[^A-Z ]/g, ' ')} `;
  for (const [abbr, t] of Object.entries(teams)) {
    if (up.includes(` ${abbr} `)) return abbr;
    for (const n of [t.name, t.short, t.location].filter(Boolean)) if (n.length >= 4 && up.includes(` ${n.toUpperCase()} `)) return abbr;
  }
  return null;
}

export async function localAnswer(question, sink, tab) {
  const q = question.toLowerCase();
  const sport = detectSport(q, tab);
  const tools = [];
  const run = async (name, input) => { tools.push(name); return runTool(name, input, sink); };

  // My slips / betting record
  if (/\b(my slips?|my record|my bets?|profit|betting record|how am i doing|my parlays?)\b/.test(q)) {
    const slips = loadSlips();
    if (!slips.length) return { text: 'You don’t have any saved slips yet. Upload a screenshot on **My Slips** or tap **Save slip & track live** on a slip to start tracking.', tools };
    const r = await run('get_my_slips', {});
    let net = 0; let wagered = 0; let w = 0; let l = 0;
    for (const s of slips) {
      const legs = s.legs.map((x) => x.result).filter(Boolean);
      if (!s.bet || legs.length < s.legs.length) continue;
      const hits = legs.filter((x) => x.hit).length; const pushes = legs.filter((x) => x.push).length;
      const st = settleBet(s.bet, s.legs.length, hits, legs.length - hits - pushes, pushes);
      if (!st) continue;
      wagered += s.bet.stake; net += st.profit; if (st.profit > 0) w += 1; else if (st.profit < 0) l += 1;
    }
    const lines = (r.slips || []).slice(0, 4).map((s) => `- **${s.title}**: ${s.legs.map((x) => `${x.player} ${x.status === 'final' ? (x.hit ? '✓' : '✕') : x.current != null ? `(${x.current})` : '…'}`).join(', ')}`);
    return { text: `${wagered ? `Your record: **${w}-${l}**, **${net >= 0 ? '+' : '−'}$${Math.abs(net).toFixed(2)}** on $${wagered.toFixed(2)} wagered.\n\n` : ''}${lines.join('\n')}`, tools };
  }

  // Tennis
  if (sport === 'tennis') {
    const tour = /\bwta\b|women/.test(q) ? 'wta' : 'atp';
    const name = q.match(/(?:how (?:is|was)|about|stats? for|preview)\s+([a-z .'-]{3,})\??$/)?.[1];
    const r = await run('get_tennis_matches', { tour, state: 'default' });
    const ms = (r.matches || []).filter((m) => m.state === 'pre' || m.state === 'in');
    if (name) {
      const pl = await run('get_tennis_player', { name: name.trim(), tour });
      if (!pl.error) return { text: `**${pl.name}**: ${pl.rank ? `world #${pl.rank}, ` : ''}${pl.season} this season, wins ${pct(pl.games_won_pct)} of games, tiebreaks ${pl.tiebreaks}.\n\n${pl.last_results.slice(0, 4).map((x) => `- ${x}`).join('\n')}`, tools };
    }
    if (!ms.length) return { text: `No upcoming ${tour.toUpperCase()} matches right now.`, tools };
    const top = ms.filter((m) => Object.keys(m.win_chance_pct || {}).length === 2 && !/TBD/i.test(m.players)).map((m) => { const [a, b] = Object.entries(m.win_chance_pct); return a[1] >= b[1] ? { pick: a[0], opp: b[0], p: a[1], m } : { pick: b[0], opp: a[0], p: b[1], m }; }).sort((x, y) => y.p - x.p);
    const legs = top.slice(0, /parlay/.test(q) ? 3 : 5);
    const all = legs.reduce((a, x) => a * (x.p / 100), 1);
    return { text: `Safest ${tour.toUpperCase()} picks:\n\n${legs.map((x) => `- **${x.pick}** over ${x.opp}: **${pct(x.p)}** (${x.m.event})`).join('\n')}${/parlay/.test(q) ? `\n\nAll ${legs.length} win: **${pct(all * 100)}** (model estimate).` : ''}`, tools };
  }

  const player = findPlayer(question, sink, sport);
  const lg = player?.sport || (sport === 'tennis' ? 'nba' : sport);
  const S = sink[lg];
  if (!S?.ctx) return { text: `The ${lg.toUpperCase()} data is still loading. Try again in a few seconds.`, tools };

  // Prop check: player + number (+ stat)
  const num = q.match(/(\d+(?:\.\d+)?)/);
  if (player && num) {
    const statText = q.replace(/(\d+(?:\.\d+)?)/, ' ').replace(new RegExp(player.name.split(' ').slice(-1)[0], 'i'), ' ');
    const words = statText.split(/[^a-z+0-9-]+/).filter(Boolean);
    let market = null;
    for (let n = 3; n >= 1 && !market; n--) for (let i = 0; i + n <= words.length && !market; i++) market = findMarket(S.cfg, words.slice(i, i + n).join(' '));
    if (market) {
      const e = await run('evaluate_prop', { sport: lg, player: player.name, stat: S.cfg.markets[market].label, line: Number(num[1]) });
      if (e.error) return { text: e.error, tools };
      const under = /\b(under|less)\b/.test(q);
      const chance = under ? e.chance_under_pct : e.chance_over_pct;
      return { text: `**${e.player} ${under ? 'under' : 'over'} ${e.line} ${e.stat}**: **${pct(chance)}** chance.\n\n- Model expects **${e.model_mean}**${e.recent_over_of_last ? `; went over this line in ${e.recent_over_of_last} recent games` : ''}\n- Pick: **${e.pick}**${e.grade ? ` (${e.grade})` : ''}\n${(e.reasons || []).slice(0, 3).map((r) => `- ${r}`).join('\n')}`, tools };
    }
  }

  // Player stats
  if (player) {
    const r = await run('get_player', { sport: lg, name: player.name });
    if (r.error) return { text: r.error, tools };
    const proj = r.projected_this_game ? Object.entries(r.projected_this_game).filter(([, v]) => v).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(', ') : null;
    return { text: `**${r.name}** (${r.team}${r.pos ? ` ${r.pos}` : ''})${r.opp ? ` vs ${r.opp}` : ''}${r.injury ? `, **${r.injury}**` : ''}.\n\n${proj ? `- Projected: ${proj}\n` : ''}${(r.recent_games || []).slice(0, 4).map((g) => `- ${g.when} vs ${g.opp}: ${Object.entries(g).filter(([k, v]) => !['when', 'opp'].includes(k) && v).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(', ')}`).join('\n')}`, tools };
  }

  // Team / live game
  const team = findTeam(question, sink, lg);
  if (team) {
    const g = await run('get_live_game', { sport: lg, team });
    if (g.error) return { text: g.error, tools };
    if (g.status === 'not started') return { text: `**${g.away} @ ${g.home}** starts ${new Date(g.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`, tools };
    return { text: `**${g.score}** · ${g.status}\n\n${(g.last_plays || []).slice(0, 5).map((x) => `- ${x}`).join('\n')}`, tools };
  }

  // Best picks / parlay
  if (/\b(best|safe|safest|lock|locks|picks?|parlay|props?|bets?)\b/.test(q)) {
    const n = Number(q.match(/(\d)\s*-?\s*(leg|pick)/)?.[1]) || (/parlay/.test(q) ? 3 : 5);
    const r = await run('get_highest_chance_picks', { sport: lg, limit: 20 });
    const seen = new Set();
    const legs = (r.picks || []).filter((x) => { const k = [x.team, x.opp].sort().join(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n);
    if (!legs.length) return { text: `No ${lg.toUpperCase()} picks clear 75% right now (games may have started). Check back before the next slate.`, tools };
    const all = legs.reduce((a, x) => a * (x.chance_pct / 100), 1);
    return { text: `Highest-chance ${lg.toUpperCase()} picks (one per game):\n\n${legs.map((x) => `- **${x.player}** ${x.pick}: **${pct(x.chance_pct)}** (cleared it ${x.cleared_in_recent} recent games)`).join('\n')}${legs.length > 1 ? `\n\nAll ${legs.length} hit: **${pct(all * 100)}** (model estimate; same-game legs move together).` : ''}`, tools };
  }

  // Games today / this week
  if (/\b(games?|schedule|tonight|today|this week|scores?)\b/.test(q)) {
    const r = await run('get_games', { sport: lg });
    return { text: `${r.label}:\n\n${(r.games || []).slice(0, 12).map((g) => `- ${g.away} @ ${g.home}: ${g.score || new Date(g.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${g.spread ? ` (${g.spread})` : ''}`).join('\n')}`, tools };
  }

  return {
    text: 'In free mode I can answer:\n\n- **Best picks / a 3-leg parlay** (add NFL, CFB, NBA or tennis)\n- **A prop**, like “Jokic over 11.5 rebounds”\n- **A player**, like “How is Bijan Robinson doing?”\n- **A team’s game**, like “Lakers score”\n- **Today’s games** or **my slips**\n\nAdd a Claude API key in settings for full conversations.',
    tools,
  };
}
