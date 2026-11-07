// Tools the assistant can call. Each one reads data the app has already loaded
// (or the same public files and feeds the app uses) and returns compact JSON.
import { getGameSummary } from '../api.js';
import { parseSummary } from '../gamecast.js';
import { buildFeed, summarize } from '../liveFeed.js';
import { getNbaSummary } from '../nba/api.js';
import { parseNbaSummary } from '../nba/gamecast.js';
import { normName } from '../oddsapi.js';
import { buildSafePicks } from '../pages/Props.jsx';
import { loadSlips } from '../slips.js';
import { legStatus, loadPicks, summarize as summarizeRecord } from '../tracker.js';
import { matchModel } from '../tennis/data.jsx';

const r1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const pct = (p) => (p == null ? null : Math.round(p * 1000) / 10);
const SPORT = { type: 'string', enum: ['nfl', 'cfb', 'nba'], description: 'League: nfl, cfb (college football, FBS) or nba.' };

export const TOOLS = [
  {
    name: 'get_games',
    description: 'Games on the current NFL week or NBA slate: teams, status, score, start time, spread and TV. Use first to see what is being played.',
    input_schema: { type: 'object', properties: { sport: SPORT, team: { type: 'string', description: 'Optional team abbreviation, e.g. KC or LAL.' } }, required: ['sport'], additionalProperties: false },
  },
  {
    name: 'get_player',
    description: "A player's projection for this game, opponent, injury status, matchup grade, season averages and recent game logs.",
    input_schema: { type: 'object', properties: { sport: SPORT, name: { type: 'string', description: 'Player name (partial is fine).' } }, required: ['sport', 'name'], additionalProperties: false },
  },
  {
    name: 'evaluate_prop',
    description: "Run the app's prop model on one player/stat/line. Returns the chance of over and under, the model's mean, recent hit rate vs the line and the reasons. Chances on real sportsbook lines are already calibrated toward 50/50 by the measured track record.",
    input_schema: {
      type: 'object',
      properties: {
        sport: SPORT,
        player: { type: 'string' },
        stat: { type: 'string', description: 'Stat, e.g. points, rebounds, assists, PRA, threes, pass yards, rush yards, receptions, receiving yards, rush+rec yards.' },
        line: { type: 'number' },
      },
      required: ['sport', 'player', 'stat', 'line'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_prop_lines',
    description: "Real posted player-prop lines (DraftKings via ESPN, plus PrizePicks if connected) for the current slate, each run through the model. Filter by player, team or stat. Sorted by the model's confidence.",
    input_schema: {
      type: 'object',
      properties: { sport: SPORT, player: { type: 'string' }, team: { type: 'string' }, stat: { type: 'string' }, limit: { type: 'integer', description: 'Max rows, default 15.' } },
      required: ['sport'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_highest_chance_picks',
    description: "The model's highest-chance 'More' lines (75%+ target, calibrated on past games): for each player the highest line they've cleared in most recent games. Good for safe parlay legs.",
    input_schema: { type: 'object', properties: { sport: SPORT, limit: { type: 'integer', description: 'Max rows, default 12.' } }, required: ['sport'], additionalProperties: false },
  },
  {
    name: 'get_live_game',
    description: "Live (or final) play-by-play for a team's current game: score, clock, last plays and each player's running stat line.",
    input_schema: { type: 'object', properties: { sport: SPORT, team: { type: 'string', description: 'Team abbreviation.' } }, required: ['sport', 'team'], additionalProperties: false },
  },
  {
    name: 'get_my_slips',
    description: "The user's saved slips with each leg's live or final status.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_pick_record',
    description: "How the model's logged picks have actually done (win-loss by grade, calibration) and how much it is trusted against real sportsbook lines.",
    input_schema: { type: 'object', properties: { sport: SPORT }, required: ['sport'], additionalProperties: false },
  },
  {
    name: 'get_tennis_matches',
    description: "This week's ATP or WTA singles matches with live set scores and the model's win chance (calibrated Elo; live chance updates from the score). Filter by player or day.",
    input_schema: {
      type: 'object',
      properties: { tour: { type: 'string', enum: ['atp', 'wta'] }, player: { type: 'string' }, state: { type: 'string', enum: ['live', 'upcoming', 'finished', 'all'], description: 'Default: live and upcoming.' } },
      required: ['tour'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_tennis_player',
    description: 'A tennis player: ranking, model rating, season record, sets, games won, tiebreaks, deciding sets and last results.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, tour: { type: 'string', enum: ['atp', 'wta'] } }, required: ['name'], additionalProperties: false },
  },
].map((t) => ({ ...t, eager_input_streaming: true }));

const TOOL_LABEL = {
  get_games: 'Checking games', get_player: 'Looking up player', evaluate_prop: 'Running the prop model', get_prop_lines: 'Reading prop lines',
  get_highest_chance_picks: 'Finding highest-chance picks', get_live_game: 'Reading live play-by-play', get_my_slips: 'Checking your slips',
  get_pick_record: 'Checking the record', get_tennis_matches: 'Checking tennis matches', get_tennis_player: 'Looking up tennis player',
};
export const toolLabel = (name) => TOOL_LABEL[name] || name;

// ---- helpers ----------------------------------------------------------------

const findMarket = (cfg, stat) => {
  const s = normName(stat || '');
  if (!s) return null;
  const alias = { pra: 'pointsreboundsassists', ptsrebast: 'pointsreboundsassists', pr: 'pointsrebounds', pa: 'pointsassists', ra: 'reboundsassists', '3pm': 'threes', threepointers: 'threes', '3pt': 'threes', recyds: 'receivingyards', recyards: 'receivingyards', rushrec: 'rushrecyards', rushrecyds: 'rushrecyards' };
  const want = alias[s] || s;
  let best = null;
  for (const [key, M] of Object.entries(cfg.markets)) {
    const names = [key, M.label, M.short].map((x) => normName(x));
    if (names.some((n) => n === want)) return key;
    if (!best && names.some((n) => n.includes(want) || want.includes(n.replace('player', '')))) best = key;
  }
  return best;
};
const findRow = (rows, name) => {
  const n = normName(name || '');
  return rows?.find((r) => normName(r.name) === n) || rows?.find((r) => normName(r.name).includes(n)) || null;
};
const statLine = (cfg, s) => Object.fromEntries(Object.entries(cfg.markets).slice(0, 8).map(([k, M]) => [M.short, r1(M.get(s || {}) ?? 0)]));

function propOut(e) {
  return {
    player: e.player, team: e.team, opp: e.opp, stat: e.marketLabel, line: e.line, book: e.book || null,
    pick: e.grade?.key === 'pass' ? 'no edge' : e.side === 'over' ? 'MORE' : 'LESS', grade: e.grade?.label,
    chance_over_pct: pct(e.pOver), chance_under_pct: pct(e.pUnder), model_mean: r1(e.mean),
    recent_over_of_last: e.recent ? `${e.overs}/${e.recent.length}` : null, injury: e.injury || null,
    started: !!e.started, live_or_final_value: e.result?.actual ?? null,
    reasons: (e.reasons || []).map((r) => r.text).slice(0, 6),
  };
}

let tennisCache = {};
async function tennis(tour) {
  if (!tennisCache[tour]) tennisCache[tour] = fetch(`${import.meta.env.BASE_URL}data/tennis/${tour}.json`, { cache: 'no-cache' }).then((r) => r.json());
  return tennisCache[tour];
}

// ---- executor ---------------------------------------------------------------

/** sports: { nfl: { cfg, ctx, rows, data, lines }, nba: {...} } */
export async function runTool(name, input, sports) {
  const S = input?.sport ? sports[input.sport] : null;
  if (input?.sport && (!S?.ctx || !S?.data)) return { error: `${input.sport.toUpperCase()} data is still loading. Try again in a few seconds.` };
  switch (name) {
    case 'get_games': {
      const games = S.data.board?.games || [];
      const t = input.team?.toUpperCase();
      return {
        label: input.sport === 'nba' ? `Slate ${S.data.date}` : `Week ${S.data.core?.week}`,
        games: games.filter((g) => !t || g.home.abbr === t || g.away.abbr === t).map((g) => ({
          id: g.id, away: g.away.abbr, home: g.home.abbr, state: g.state, detail: g.detail, start: g.date,
          score: g.state === 'pre' ? null : `${g.away.abbr} ${g.away.score} - ${g.home.abbr} ${g.home.score}`,
          spread: g.line?.details || g.spread || null, total: g.line?.overUnder ?? null, tv: g.tv || null,
        })),
      };
    }
    case 'get_player': {
      const r = findRow(S.rows, input.name);
      const sp = r ? S.ctx.season?.players?.get(r.id) : [...(S.ctx.season?.players?.values() || [])].find((p) => normName(p.name).includes(normName(input.name)));
      if (!r && !sp) return { error: `No player matching "${input.name}" on this ${input.sport === 'nba' ? 'slate' : 'week'}.` };
      const log = (sp?.log || []).slice(-6).reverse();
      return {
        name: r?.name || sp?.name, team: r?.team || sp?.team, pos: r?.pos || sp?.pos, opp: r?.opp || null, injury: r?.injury || sp?.injury || null,
        projected_this_game: r ? statLine(S.cfg, r.s) : null, fantasy_projection: r1(r?.proj),
        matchup_grade: r?.grade?.letter || null,
        recent_games: log.map((l) => ({ when: l.week ? `Week ${l.week}` : l.date, opp: l.opp, ...statLine(S.cfg, l.s) })),
      };
    }
    case 'evaluate_prop': {
      const market = findMarket(S.cfg, input.stat);
      if (!market) return { error: `Unknown stat "${input.stat}". Options: ${Object.values(S.cfg.markets).map((m) => m.label).join(', ')}` };
      if (typeof input.line !== 'number') return { error: 'line must be a number' };
      const e = S.cfg.evaluate({ id: `ai:${normName(input.player)}|${market}`, player: input.player, market, line: input.line }, S.ctx);
      if (!e || e.unmatched) return { error: `Couldn't find ${input.player} with enough data for ${S.cfg.markets[market].label}.` };
      return propOut(e);
    }
    case 'get_prop_lines': {
      const lim = Math.min(40, input.limit || 15);
      const n = input.player ? normName(input.player) : null;
      const market = input.stat ? findMarket(S.cfg, input.stat) : null;
      const out = S.lines.map((l) => S.cfg.evaluate(l, S.ctx)).filter((e) => e && !e.unmatched
        && (!n || normName(e.player).includes(n)) && (!input.team || e.team === input.team.toUpperCase()) && (!market || e.market === market))
        .sort((a, b) => b.prob - a.prob);
      return { total_lines_loaded: S.lines.length, matching: out.length, lines: out.slice(0, lim).map(propOut) };
    }
    case 'get_highest_chance_picks': {
      const picks = buildSafePicks(S.cfg, S.ctx, S.rows, 0.75, S.ctx.gameByTeam).filter((p) => p.state === 'pre');
      return { picks: picks.slice(0, Math.min(30, input.limit || 12)).map((p) => ({ player: p.player, team: p.team, opp: p.opp, pick: `More ${p.line} ${p.statLabel}`, chance_pct: pct(p.prob), cleared_in_recent: `${p.hits}/${p.n}`, model_mean: r1(p.mean), start: p.date })) };
    }
    case 'get_live_game': {
      const g = S.ctx.gameByTeam?.[input.team.toUpperCase()];
      if (!g) return { error: `No ${input.sport.toUpperCase()} game for ${input.team} on this ${input.sport === 'nba' ? 'slate' : 'week'}.` };
      if (g.state === 'pre') return { status: 'not started', start: g.date, away: g.away.abbr, home: g.home.abbr };
      const football = input.sport !== 'nba';
      const raw = football ? await (S.data.api?.getGameSummary || getGameSummary)(g.id) : await getNbaSummary(g.id);
      const game = football ? parseSummary(raw) : parseNbaSummary(raw);
      const { items } = buildFeed(game, raw, football ? 'nfl' : 'nba');
      const lines = new Map();
      for (const i of items) for (const a of i.after || []) if (!lines.has(a.name)) lines.set(a.name, a.line);
      return {
        score: `${game.away.abbr} ${game.away.score} - ${game.home.abbr} ${game.home.score}`, status: g.detail || game.state,
        last_plays: items.slice(0, 10).map((i) => `${i.clock ? `Q${i.period} ${i.clock} · ` : ''}${summarize(i, football ? 'nfl' : 'nba')}`),
        player_lines: Object.fromEntries([...lines.entries()].slice(0, 16)),
      };
    }
    case 'get_my_slips': {
      const slips = loadSlips();
      if (!slips.length) return { slips: [], note: 'No saved slips. They are saved with "Save slip & track live" on Props, Parlays or Scan.' };
      return {
        slips: slips.slice(0, 10).map((s) => ({
          title: s.title, saved: new Date(s.created).toISOString(),
          legs: s.legs.map((l) => {
            const X = sports[l.sport];
            const st = l.result ? { state: 'final', ...l.result } : X?.ctx ? legStatus(l, { markets: X.cfg.markets, season: X.ctx.season, liveById: X.ctx.liveById, gameByTeam: X.ctx.gameByTeam }) : { state: 'loading' };
            return { player: l.player, pick: `${l.side === 'over' ? 'More' : 'Less'} ${l.line} ${l.stat}`, status: st.state, current: st.actual ?? null, hit: st.hit ?? null };
          }),
        })),
      };
    }
    case 'get_pick_record': {
      const sum = summarizeRecord(loadPicks(input.sport));
      const cal = S.ctx.lineCal;
      return {
        real_line_picks: sum.lines, highest_chance_picks: sum.safe, by_grade: sum.byGrade, calibration: sum.calibration,
        sportsbook_line_trust: cal ? { graded_lines: cal.n, trust_in_model_lean_pct: Math.round(cal.s * 100), model_side_when_70pct_sure_hit_pct: cal.modelSide70 ? pct(cal.modelSide70.hit) : null, using_default: !!cal.usingDefault } : null,
      };
    }
    case 'get_tennis_matches': {
      const d = await tennis(input.tour);
      const n = input.player ? normName(input.player) : null;
      const want = input.state || 'default';
      const ok = (m) => (want === 'all' ? true : want === 'live' ? m.state === 'in' : want === 'upcoming' ? m.state === 'pre' : want === 'finished' ? m.state === 'post' : m.state !== 'post');
      const list = d.matches.filter((m) => ok(m) && (!n || normName(m.a.name).includes(n) || normName(m.b.name).includes(n)))
        .sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 25);
      return {
        data_as_of: d.generatedAt,
        matches: list.map((m) => {
          const mm = matchModel(m, d);
          return {
            event: m.event, round: m.round, start: m.date, state: m.state, detail: m.detail,
            players: `${m.a.name} vs ${m.b.name}`, sets: m.sets.map((s) => `${s[0]}-${s[1]}`).join(' '),
            winner: m.winner ? m[m.winner].name : null,
            win_chance_pct: { [m.a.name]: pct(mm.liveP ?? mm.p), [m.b.name]: pct(1 - (mm.liveP ?? mm.p)) },
            pre_match_chance_pct: m.state !== 'pre' ? { [m.a.name]: pct(mm.p) } : undefined,
            expected_total_games: r1(mm.outlook.meanGames), best_of: mm.bestOf, thin_data: mm.thin,
          };
        }),
        note: 'Live scores in this snapshot can lag a few hours; the Tennis tab shows the latest.',
      };
    }
    case 'get_tennis_player': {
      const n = normName(input.name);
      for (const t of input.tour ? [input.tour] : ['atp', 'wta']) {
        const d = await tennis(t);
        const p = Object.values(d.players).find((x) => normName(x.name) === n) || Object.values(d.players).find((x) => normName(x.name).includes(n));
        if (p) {
          return {
            tour: t, name: p.name, rank: p.rank || null, rating: p.elo, rated_matches: p.n, season: `${p.w}-${p.l}`, sets: `${p.sw}-${p.sl}`,
            games_won_pct: p.gw + p.gl ? pct(p.gw / (p.gw + p.gl)) : null, tiebreaks: `${p.tbw}-${p.tbl}`, deciding_sets: `${p.dw}-${p.dl}`,
            last_results: p.recent.slice(0, 8).map((r) => `${r.win ? 'W' : 'L'} vs ${r.opp} ${r.score} (${r.event}, ${r.round})`),
          };
        }
      }
      return { error: `No tennis player matching "${input.name}".` };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
