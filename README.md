# Gridiron Edge

A web app for NFL stats, fantasy projections, matchup grades and team outlooks. Built with React and Vite. It rolls over to each new NFL week automatically.

## Features

- **This Week:** a live score ticker, KPI cards, players primed for big weeks, teams to watch, smash spots, players heating up, players to start with caution, the full slate with projected scores and win probabilities, and defenses to stream.
- **Projections:** a sortable and filterable table with projected stat lines, matchup grades (A+ to F), the gap between projection and season average, sparklines, and actual points as games finish. You can view this week or next week.
- **Season Stats:** leaders by position, with stats specific to each position (snap %, catch %, YPC and so on).
- **Teams:** team rankings for the week (projected points, spread, win probability, outlook score), standings by division, and the playoff picture.
- **Matchups:** a heatmap of fantasy points each defense allows to each position.
- **Player and team panels:** weekly charts, game logs, floor and ceiling ranges, season leaders and schedules with results.
- Small touches: PPR, Half and Std scoring (remembered between visits), light and dark themes, injury badges, possession and red-zone markers, the `/` key to jump to search, keyboard access, skeleton loaders, and a mobile tab bar.

## Data

| Source | Used for | How |
| --- | --- | --- |
| [Sleeper](https://docs.sleeper.com/) | Current week, weekly player stats, projections | Live, straight from the browser |
| ESPN | Teams, logos, standings, schedule and scores | `public/data/espn.json` snapshot, plus live scores when the browser allows it |

ESPN blocks most cross-origin browser requests, so `scripts/fetch-espn.mjs` writes the snapshot instead. The GitHub Action `.github/workflows/update-and-deploy.yml` refreshes it every day and every 30 minutes during game windows, then redeploys to GitHub Pages.

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
npm run dev    # http://localhost:5173 (dev server proxies ESPN for live scores)
npm run build
```

### Deploying

In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**. Every push to `main` and every scheduled run then deploys the site.
