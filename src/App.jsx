import { useEffect } from 'react';
import { DataProvider, useData, useRoute } from './data.jsx';
import { Overlay } from './components/panels.jsx';
import { Header, MobileNav, Ticker } from './components/shell.jsx';
import AiLauncher from './ai/Launcher.jsx';
import HypeHost from './ai/HypeHost.jsx';
import { LiveEntryBar, SlipsHub } from './slipsLive.jsx';
import { UiProvider, timeAgo, useNow } from './components/ui.jsx';
import Game from './pages/Game.jsx';
import Home from './pages/Home.jsx';
import Matchups from './pages/Matchups.jsx';
import Projections from './pages/Projections.jsx';
import Props from './pages/Props.jsx';
import Scan from './pages/Scan.jsx';
import Parlays from './pages/Parlays.jsx';
import Record, { NbaRecordRoute } from './pages/Record.jsx';
import Slips, { NbaSlipsRoute } from './pages/Slips.jsx';
import Stats from './pages/Stats.jsx';
import Teams from './pages/Teams.jsx';
import { NbaPlayerPanel, NbaTeamPanel } from './nba/components.jsx';
import { NbaDataProvider } from './nba/data.jsx';
import { TennisDataProvider } from './tennis/data.jsx';
import * as CFB_API from './cfb/api.js';
import CfbProps from './cfb/pages/Props.jsx';
import CfbPicks from './cfb/pages/Picks.jsx';
import { TennisPlayerPanel } from './tennis/components.jsx';
import TennisHome from './tennis/pages/Home.jsx';
import TennisMatch from './tennis/pages/Match.jsx';
import TennisPicks from './tennis/pages/Picks.jsx';
import TennisRankings from './tennis/pages/Rankings.jsx';
import TennisRecord from './tennis/pages/Record.jsx';
import NbaGame from './nba/pages/Game.jsx';
import NbaHome from './nba/pages/Home.jsx';
import NbaMatchups from './nba/pages/Matchups.jsx';
import NbaProjections from './nba/pages/Projections.jsx';
import NbaProps from './nba/pages/Props.jsx';
import NbaScan from './nba/pages/Scan.jsx';
import NbaParlays from './nba/pages/Parlays.jsx';
import NbaStats from './nba/pages/Stats.jsx';
import NbaTeams from './nba/pages/Teams.jsx';

const SPORTS = {
  nfl: {
    Provider: DataProvider,
    pages: { home: Home, game: Game, projections: Projections, props: Props, scan: Scan, parlays: Parlays, slips: Slips, record: Record, stats: Stats, teams: Teams, matchups: Matchups },
    panels: {},
    credit: 'Stats & projections via Sleeper · Scores, standings & logos via ESPN',
    footer: (core) => (core ? `${core.season} season · data refreshes automatically each week` : ''),
  },
  nba: {
    Provider: NbaDataProvider,
    pages: { home: NbaHome, game: NbaGame, projections: NbaProjections, props: NbaProps, scan: NbaScan, parlays: NbaParlays, slips: NbaSlipsRoute, record: NbaRecordRoute, stats: NbaStats, teams: NbaTeams, matchups: NbaMatchups },
    panels: { PlayerPanelC: NbaPlayerPanel, TeamPanelC: NbaTeamPanel },
    credit: 'Box scores & projections via Sleeper · Scores, standings & logos via ESPN',
    footer: (core) => (core ? `${core.label} season · data refreshes automatically every night` : ''),
  },
  cfb: {
    Provider: ({ children }) => <DataProvider api={CFB_API} sport="cfb">{children}</DataProvider>,
    pages: { home: Home, game: Game, projections: Projections, props: CfbProps, picks: CfbPicks, stats: Stats, teams: Teams, matchups: Matchups },
    panels: {},
    credit: 'Scores, box scores, rankings & lines via ESPN · Projections & ratings built from every FBS game',
    footer: (core) => (core ? `${core.season} season · data refreshes several times every Saturday` : ''),
  },
  tennis: {
    Provider: TennisDataProvider,
    pages: { home: TennisHome, match: TennisMatch, picks: TennisPicks, rankings: TennisRankings, record: TennisRecord },
    panels: { PlayerPanelC: TennisPlayerPanel, TeamPanelC: TennisPlayerPanel },
    credit: 'Scores, draws & rankings via ESPN · Player ratings built from every result since last season',
    footer: () => 'Tennis data refreshes daily, live scores every 30 seconds',
  },
};

function Shell({ route, sport }) {
  const { error, reload, updatedAt, core } = useData();
  useNow(30000);
  useEffect(() => { document.documentElement.dataset.sport = route.sport; }, [route.sport]);
  const Page = sport.pages[route.path] || sport.pages.home;
  return (
    <SlipsHub route={route}>
      <Header route={route} />
      <LiveEntryBar route={route} />
      {/* Home has its own swipeable game cards; game pages go full screen. */}
      {route.path !== 'game' && route.path !== 'home' && route.sport !== 'tennis' && <Ticker />}
      <main className="main">
        {error && (
          <div className="banner error" role="alert">
            <span>
              <strong>Couldn’t reach the data feeds.</strong> {error}. Check your connection and try again.
            </span>
            <button type="button" className="btn" onClick={reload}>Retry</button>
          </div>
        )}
        <Page key={route.path + (route.params.get('id') || '')} params={route.params} />
      </main>
      <footer className="footer">
        <span>
          {sport.credit}
          {updatedAt && <> · Updated {timeAgo(updatedAt)}</>}
        </span>
        <span className="muted">{sport.footer(core)} · Projections are estimates, not guarantees.</span>
      </footer>
      <MobileNav route={route} />
      <AiLauncher sport={route.sport} />
      <HypeHost />
      <Overlay {...sport.panels} />
    </SlipsHub>
  );
}

export default function App() {
  const route = useRoute();
  const sport = SPORTS[route.sport] || SPORTS.nfl;
  const { Provider } = sport;
  // Keyed by sport so switching NFL <-> NBA starts each data layer fresh.
  return (
    <Provider key={route.sport}>
      <UiProvider>
        <Shell route={route} sport={sport} />
      </UiProvider>
    </Provider>
  );
}
