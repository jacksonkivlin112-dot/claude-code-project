import { DataProvider, useData, useRoute } from './data.jsx';
import { Overlay } from './components/panels.jsx';
import { Header, MobileNav, Ticker } from './components/shell.jsx';
import { UiProvider, timeAgo, useNow } from './components/ui.jsx';
import Game from './pages/Game.jsx';
import Home from './pages/Home.jsx';
import Matchups from './pages/Matchups.jsx';
import Projections from './pages/Projections.jsx';
import Props from './pages/Props.jsx';
import Scan from './pages/Scan.jsx';
import Parlays from './pages/Parlays.jsx';
import Stats from './pages/Stats.jsx';
import Teams from './pages/Teams.jsx';
import { NbaPlayerPanel, NbaTeamPanel } from './nba/components.jsx';
import { NbaDataProvider } from './nba/data.jsx';
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
    pages: { home: Home, game: Game, projections: Projections, props: Props, scan: Scan, parlays: Parlays, stats: Stats, teams: Teams, matchups: Matchups },
    panels: {},
    credit: 'Stats & projections via Sleeper · Scores, standings & logos via ESPN',
    footer: (core) => (core ? `${core.season} season · data refreshes automatically each week` : ''),
  },
  nba: {
    Provider: NbaDataProvider,
    pages: { home: NbaHome, game: NbaGame, projections: NbaProjections, props: NbaProps, scan: NbaScan, parlays: NbaParlays, stats: NbaStats, teams: NbaTeams, matchups: NbaMatchups },
    panels: { PlayerPanelC: NbaPlayerPanel, TeamPanelC: NbaTeamPanel },
    credit: 'Box scores & projections via Sleeper · Scores, standings & logos via ESPN',
    footer: (core) => (core ? `${core.label} season · data refreshes automatically every night` : ''),
  },
};

function Shell({ route, sport }) {
  const { error, reload, updatedAt, core } = useData();
  useNow(30000);
  const Page = sport.pages[route.path] || sport.pages.home;
  return (
    <>
      <Header route={route} />
      <Ticker />
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
      <Overlay {...sport.panels} />
    </>
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
