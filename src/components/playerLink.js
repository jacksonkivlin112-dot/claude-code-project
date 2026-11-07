// Tap a player anywhere in a game (play-by-play, box score) to open their stat sheet.
// Game feeds use ESPN ids while the app's season data may use other ids, so match by name
// (and team when two players share a name).
import { useCallback } from 'react';
import { useData } from '../data.jsx';
import { normName } from '../oddsapi.js';
import { useUi } from './ui.jsx';

const cache = new WeakMap();
function index(players) {
  if (!players) return null;
  if (!cache.has(players)) {
    const m = new Map();
    for (const p of players.values()) {
      const k = normName(p.name || `${p.first || ''} ${p.last || ''}`);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    cache.set(players, m);
  }
  return cache.get(players);
}

/** -> (name, team) => opened? */
export function usePlayerOpener() {
  const { season } = useData() || {};
  const { openPlayer } = useUi() || {};
  return useCallback((name, team) => {
    const m = index(season?.players);
    const list = m?.get(normName(name || ''));
    if (!list?.length || !openPlayer) return false;
    const p = list.find((x) => x.team === team) || list[0];
    openPlayer(p.id);
    return true;
  }, [season, openPlayer]);
}
