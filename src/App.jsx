import { DataProvider, useData, useRoute } from './data.jsx';
import { Overlay } from './components/panels.jsx';
import { Header, MobileNav, Ticker } from './components/shell.jsx';
import { UiProvider, timeAgo, useNow } from './components/ui.jsx';
import Game from './pages/Game.jsx';
import Home from './pages/Home.jsx';
import Matchups from './pages/Matchups.jsx';
import Projections from './pages/Projections.jsx';
import Props from './pages/Props.jsx';
import Stats from './pages/Stats.jsx';
import Teams from './pages/Teams.jsx';

const PAGES = { home: Home, game: Game, projections: Projections, props: Props, stats: Stats, teams: Teams, matchups: Matchups };

function Shell() {
  const route = useRoute();
  const { error, reload, updatedAt, core } = useData();
  useNow(30000);
  const Page = PAGES[route.path] || Home;
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
          Stats & projections via Sleeper · Scores, standings & logos via ESPN
          {updatedAt && <> · Updated {timeAgo(updatedAt)}</>}
        </span>
        <span className="muted">
          {core ? `${core.season} season · data refreshes automatically each week` : ''} · Projections are estimates, not guarantees.
        </span>
      </footer>
      <MobileNav route={route} />
      <Overlay />
    </>
  );
}

export default function App() {
  return (
    <DataProvider>
      <UiProvider>
        <Shell />
      </UiProvider>
    </DataProvider>
  );
}
