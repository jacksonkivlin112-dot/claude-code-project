// Load NFL and NBA data side by side: the page's own sport comes from the
// surrounding provider, the other sport is mounted in its own provider and
// its context is reported back through a bridge.
import { useEffect, useState } from 'react';
import { DataProvider } from './data.jsx';
import { NbaDataProvider } from './nba/data.jsx';
import { NBA_CFG, useNbaContext } from './nba/pages/Props.jsx';
import { NFL_CFG, useNflContext } from './pages/Props.jsx';
import { CFB_CFG } from './cfb/pages/Props.jsx';

export const CFGS = { nfl: NFL_CFG, nba: NBA_CFG, cfb: CFB_CFG };
export const SPORT_LABEL = { nfl: 'NFL', nba: 'NBA', cfb: 'CFB' };
export const OWN_HOOK = { nfl: useNflContext, nba: useNbaContext, cfb: useNflContext };

function Bridge({ use, onChange }) {
  const v = use();
  useEffect(() => { onChange(v); }, [v.ctx, v.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** @returns [{ nfl: {ctx, rows}, nba: {ctx, rows} }, element to render] */
export function useDualSports(home, own) {
  const [other, setOther] = useState({ ctx: null, rows: null });
  const sports = home === 'nfl' ? { nfl: own, nba: other } : { nfl: other, nba: own };
  const element = home === 'nfl'
    ? <NbaDataProvider><Bridge use={useNbaContext} onChange={setOther} /></NbaDataProvider>
    : <DataProvider><Bridge use={useNflContext} onChange={setOther} /></DataProvider>;
  return [sports, element];
}
