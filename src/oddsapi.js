// The Odds API client + parsers for PrizePicks player-prop lines.
// Shared by the browser (user-supplied key) and scripts/fetch-props.mjs
// (GitHub Actions secret). Docs: https://the-odds-api.com/liveapi/guides/v4/

export const ODDS_BASE = 'https://api.the-odds-api.com/v4';
export const SPORT = 'americanfootball_nfl';
export const BOOK = 'prizepicks';

// Market key -> how to read it from Sleeper stats, and how it is distributed.
//   dist 'poisson' for low counts (TDs, receptions, INTs), 'normal' otherwise.
//   cv = default coefficient of variation used to shrink small samples.
export const MARKETS = {
  player_pass_yds: { label: 'Pass Yards', short: 'Pass Yds', get: (s) => s.pass_yd, dist: 'normal', cv: 0.3, pos: ['QB'] },
  player_pass_tds: { label: 'Pass TDs', short: 'Pass TD', get: (s) => s.pass_td, dist: 'poisson', pos: ['QB'] },
  player_pass_completions: { label: 'Completions', short: 'Cmp', get: (s) => s.pass_cmp, dist: 'normal', cv: 0.22, pos: ['QB'] },
  player_pass_attempts: { label: 'Pass Attempts', short: 'Att', get: (s) => s.pass_att, dist: 'normal', cv: 0.18, pos: ['QB'] },
  player_pass_interceptions: { label: 'Interceptions', short: 'INT', get: (s) => s.pass_int, dist: 'poisson', pos: ['QB'] },
  player_pass_rush_yds: { label: 'Pass + Rush Yards', short: 'Pass+Rush', get: (s) => sum(s.pass_yd, s.rush_yd), dist: 'normal', cv: 0.28, pos: ['QB'] },
  player_rush_yds: { label: 'Rush Yards', short: 'Rush Yds', get: (s) => s.rush_yd, dist: 'normal', cv: 0.48, pos: ['QB', 'RB', 'WR'] },
  player_rush_attempts: { label: 'Rush Attempts', short: 'Carries', get: (s) => s.rush_att, dist: 'normal', cv: 0.3, pos: ['QB', 'RB'] },
  player_receptions: { label: 'Receptions', short: 'Rec', get: (s) => s.rec, dist: 'poisson', pos: ['RB', 'WR', 'TE'] },
  player_reception_yds: { label: 'Receiving Yards', short: 'Rec Yds', get: (s) => s.rec_yd, dist: 'normal', cv: 0.55, pos: ['RB', 'WR', 'TE'] },
  player_rush_reception_yds: { label: 'Rush + Rec Yards', short: 'Rush+Rec', get: (s) => sum(s.rush_yd, s.rec_yd), dist: 'normal', cv: 0.4, pos: ['RB', 'WR', 'TE'] },
};

function sum(a, b) {
  return a == null && b == null ? undefined : (a || 0) + (b || 0);
}

export const DEFAULT_MARKETS = Object.keys(MARKETS);

export function normName(n = '') {
  return n
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '');
}

async function get(url, fetchImpl) {
  const res = await fetchImpl(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Odds API HTTP ${res.status}`);
    err.status = res.status;
    err.code = body.error_code;
    throw err;
  }
  return {
    body,
    remaining: res.headers.get('x-requests-remaining'),
    used: res.headers.get('x-requests-used'),
  };
}

/** Upcoming NFL events (free: does not cost credits). */
export async function listEvents(apiKey, fetchImpl = fetch) {
  const { body } = await get(`${ODDS_BASE}/sports/${SPORT}/events?apiKey=${encodeURIComponent(apiKey)}&dateFormat=iso`, fetchImpl);
  return body;
}

/**
 * Fetch PrizePicks lines for the given events.
 * Cost: 1 credit per market per event that returns data.
 */
export async function fetchPrizePicksLines(apiKey, { events, markets = DEFAULT_MARKETS, withinHours = 8 * 24, fetchImpl = fetch } = {}) {
  const now = Date.now();
  const list = (events || (await listEvents(apiKey, fetchImpl))).filter((e) => {
    const t = new Date(e.commence_time).getTime();
    return t > now && t - now < withinHours * 3600 * 1000;
  });
  const props = [];
  let remaining = null;
  let used = null;
  for (const e of list) {
    const url = `${ODDS_BASE}/sports/${SPORT}/events/${e.id}/odds?apiKey=${encodeURIComponent(apiKey)}&bookmakers=${BOOK}&markets=${markets.join(',')}&oddsFormat=american&dateFormat=iso`;
    const r = await get(url, fetchImpl);
    remaining = r.remaining ?? remaining;
    used = r.used ?? used;
    props.push(...parseEventOdds(r.body));
  }
  return { props, remaining: remaining != null ? Number(remaining) : null, used: used != null ? Number(used) : null, events: list.length };
}

/** Flatten an event-odds response into one row per player/market line. */
export function parseEventOdds(ev) {
  const out = new Map();
  for (const bm of ev.bookmakers || []) {
    if (bm.key !== BOOK) continue;
    for (const m of bm.markets || []) {
      if (!MARKETS[m.key]) continue;
      for (const o of m.outcomes || []) {
        if (o.point == null || !o.description) continue;
        const id = `${normName(o.description)}|${m.key}`;
        const row = out.get(id) || {
          id,
          player: o.description,
          market: m.key,
          line: o.point,
          eventId: ev.id,
          home: ev.home_team,
          away: ev.away_team,
          commence: ev.commence_time,
          updated: m.last_update || bm.last_update || null,
        };
        row.line = o.point;
        if (o.name === 'Over') row.overPrice = o.price;
        if (o.name === 'Under') row.underPrice = o.price;
        out.set(id, row);
      }
    }
  }
  return [...out.values()];
}
