import { NFL_CFG, PropsPage, useNflContext } from '../../pages/Props.jsx';

export const CFB_CFG = {
  ...NFL_CFG,
  sport: 'cfb',
  title: 'College Football Props',
  safeMinProj: 6,
  example: 'Carson Beck, Pass Yards, 255.5\nJeremiyah Love Rush Yds 95.5',
  searchHint: 'Search any FBS player or team (e.g. Arch Manning, OSU)',
  noLines: {
    title: 'No sportsbook posts college player props to a free feed',
    body: (
      <>
        Use <strong>Highest-chance props</strong> above for the model’s best picks, or search any player in <strong>All player props</strong> and type the line from your app to get More or Less with a chance.
      </>
    ),
  },
};

export default function CfbProps() {
  return <PropsPage cfg={CFB_CFG} useSportContext={useNflContext} />;
}
