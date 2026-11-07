# Gridiron Edge

NFL **and NBA** stats, projections, live Game Center and PrizePicks prop picks. Use the **NFL | NBA** switch in the header.

A web app for NFL stats, fantasy projections, matchup grades and team outlooks. Built with React and Vite. It rolls over to each new NFL week automatically.

## Features

- **This Week:** a live score ticker, KPI cards, players primed for big weeks, teams to watch, smash spots, players heating up, players to start with caution, the full slate with projected scores and win probabilities, and defenses to stream.
- **Projections:** a sortable and filterable table with projected stat lines, matchup grades (A+ to F), the gap between projection and season average, sparklines, and actual points as games finish. You can view this week or next week.
- **Season Stats:** leaders by position, with stats specific to each position (snap %, catch %, YPC and so on).
- **Teams:** team rankings for the week (projected points, spread, win probability, outlook score), standings by division, and the playoff picture.
- **Props:** PrizePicks player-prop lines (More/Less), each with a hit probability, a confidence grade and the reasons behind the pick. It also shows hit/miss dots for recent games, line movement, a "best plays" strip, live result tracking and the model's weekly record.
- **Matchups:** a heatmap of fantasy points each defense allows to each position.
- **Player and team panels:** weekly charts, game logs, floor and ceiling ranges, season leaders and schedules with results.
- Small touches: PPR, Half and Std scoring (remembered between visits), light and dark themes, injury badges, possession and red-zone markers, the `/` key to jump to search, keyboard access, skeleton loaders, and a mobile tab bar.

## Data

| Source | Used for | How |
| --- | --- | --- |
| [Sleeper](https://docs.sleeper.com/) | Current week, weekly player stats, projections | Live, straight from the browser |
| ESPN | Teams, logos, standings, schedule and scores | `public/data/espn.json` snapshot, plus live scores when the browser allows it |

ESPN blocks most cross-origin browser requests, so `scripts/fetch-espn.mjs` writes the snapshot instead. The GitHub Action `.github/workflows/update-and-deploy.yml` refreshes it every day and every 30 minutes during game windows, then redeploys to GitHub Pages.

### PrizePicks lines

PrizePicks has no public API, and its site blocks automated requests, so this app doesn't scrape it. Lines come from [The Odds API](https://the-odds-api.com), which carries PrizePicks as a bookmaker (`bookmakers=prizepicks`). There are three ways to load them:

1. **Site-wide:** add a repository secret named `ODDS_API_KEY`. The workflow then runs `scripts/fetch-props.mjs` and publishes `public/data/props.json`. Optional repo variables `PROPS_MARKETS` and `PROPS_WITHIN_HOURS` limit how many credits each run uses (about 1 credit per stat type per game).
2. **Per browser:** on the Props page, open **Line sources**, paste your own key and choose an auto-refresh interval. The key is stored only in that browser.
3. **Manual:** paste lines like `Josh Allen, Pass Yards, 245.5`.

**Prop model.** The model starts from a mean: 60% Sleeper projection, 25% season average and 15% last-3 average. It adjusts that mean for matchup (±5%), game script from the implied total and spread (±6%), and injury (Questionable −7%; Out or Doubtful means avoid). It then models outcomes with a Poisson distribution for TDs, receptions and INTs, and a normal distribution for everything else, using the player's game-to-game spread shrunk toward a market default. Picks are graded against PrizePicks' per-leg break-even of about 54.25%: **Strong** is 64% or higher, **Solid** 58% or higher, **Lean** at or above break-even, and **No edge** below it.

### How the models work

- **Matchup grade:** each defense's fantasy points allowed per game to a position this season, ranked from 1 to 32.
- **Team projected points:** 65% Sleeper's implied team total plus 35% a ratings model, which averages a team's points scored per game with its opponent's points allowed per game and adjusts for home field.
- **Win probability:** the projected margin passed through a normal CDF (standard deviation about 13 points).
- **Outlook score (0–100):** the percentile of projected points (60%) combined with the percentile of the team's fantasy volume (40%).
- **Player "good week" score:** the projection adjusted by up to ±10% for matchup and up to ±4.5% for the last 3 games.

## Development

```bash
npm install
npm run data   # refresh the ESPN snapshot
ODDS_API_KEY=... npm run props   # refresh PrizePicks lines
npm run dev    # http://localhost:5173 (dev server proxies ESPN for live scores)
npm run build
```

### Deploying

In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**. Every push to `main` and every scheduled run then deploys the site.

## NBA

The NBA side (`#/nba/...`) has the same features, built around nightly slates:

- **Tonight:** a date picker that skips empty days, players primed for a big night, teams to watch, smash spots, players heating up, players to start with caution (including back-to-backs), the slate with projected scores and win probability, and value plays.
- **Projections:** PrizePicks-style fantasy score (PTS + 1.2 REB + 1.5 AST + 3 STL + 3 BLK − TO) and matchup grades by position group (guards, forwards, centers).
- **Props:** highest-chance picks, a safest slip builder, a searchable board of every player on the slate, and stat-by-stat sheets covering points, rebounds, assists, threes, combos, blocks, steals and turnovers. The model adds pace, blowout risk, back-to-backs and stat-specific matchups.
- **Season Stats**, **Teams** (rankings for the night plus conference standings with playoff and Play-In zones), **Matchups** (defense-vs-position heatmap by stat) and a live **Game Center** with play-by-play, box score, win probability and live fantasy points.

Data: Sleeper NBA season totals, per-game box scores and per-game projections, plus `public/data/nba/espn.json` (`npm run data:nba`). NBA PrizePicks lines come from `npm run props:nba`, which uses the same `ODDS_API_KEY`.

## Pick record, saved slips & installable app

- **Pick Record** (`#/record`, `#/nba/record`): every pick the model makes (graded PrizePicks lines and the 75% highest-chance lines) is logged before its game and graded from the box score afterward. Shows records by grade and stat, a calibration chart, and a leak-free backtest of the highest-chance method. Stored on the device.
- **Calibration**: the backtest showed raw spreads were too tight (75% lines hit ~64%), so highest-chance lines now use a 1.5× spread (`SAFE_SD_MULT`), which brings replayed hit rates back to target.
- **My Slips** (`#/slips`): save any slip from Props, the Parlay Builder or Slip Scan and follow each leg live, with optional alerts.
- **Install**: web app manifest + service worker; "Install the app" lives in the menu.

## Tennis (`#/tennis/...`)

- **Data**: `scripts/fetch-espn-tennis.mjs` pulls ATP/WTA draws, scores and rankings from ESPN plus every singles result since the start of last season (incremental after the first run; `--full` rebuilds).
- **Model** (`src/tennis/model.js`): Elo ratings from all results, shrunk toward 50/50 by a factor fit on the first two-thirds of the season and checked on the last third. Win chance is converted to a per-game probability, which drives set-score odds, total-games odds and live win chances from any score.
- **Pages**: Matches (live scores + win %), Match (odds, form, head-to-head), Picks & Parlays, Rankings (official + model rating), Model Record.

## Edge AI assistant

- "Ask AI" (header button on phones, floating button on desktop) opens a chat that runs on Claude (default `claude-opus-5-5`; Sonnet 5.5 / Haiku 5.5 selectable).
- Static site, no backend: the browser calls the Anthropic API directly with the user's own API key, stored only in that browser's localStorage. The SDK loads only when the assistant opens.
- Tools (`src/ai/tools.js`) read the app's live data and models: games, players, prop model (`evaluate_prop`), posted lines, highest-chance picks, live play-by-play, saved slips, pick record, tennis matches/players.
- Streaming, prompt caching on the system prompt + tools, server-side refusal fallback (`fallbacks: "default"`), effort `medium`.

## College football (`#/cfb/...`)

- **Data**: `scripts/fetch-espn-cfb.mjs` builds FBS player box scores for every game (ESPN summaries, incremental), roster positions, weekly projections (recent + season form × opponent defense × DraftKings-implied team total), team ratings and the backtests. Output in `public/data/cfb/`, NFL row shapes.
- **Reuse**: `DataProvider` takes an `api` source; `src/cfb/api.js` implements the same functions as the NFL feed, so Home, Game Center (live play-by-play), Projections, Stats, Teams, Matchups and Props run on college data.
- **Props & best picks**: no free feed carries college player props, so Props shows the model's calibrated highest-chance lines plus "type any line" for every player.
- **Game picks**: team ratings (warmed up on last season) pick winners at ~70% out of sample; against the spread and totals they don't beat the line, so the page shows those for information only.
