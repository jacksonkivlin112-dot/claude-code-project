// Favorite teams per sport: shown first in game lists and the switcher.
import { useEffect, useState } from 'react';

const KEY = (sport) => `ge:fav:${sport}`;
const subs = new Set();
const read = (sport) => { try { return new Set(JSON.parse(localStorage.getItem(KEY(sport))) || []); } catch { return new Set(); } };

export function toggleFavorite(sport, abbr) {
  const s = read(sport);
  if (s.has(abbr)) s.delete(abbr); else s.add(abbr);
  try { localStorage.setItem(KEY(sport), JSON.stringify([...s])); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

/** -> [Set of favorite abbrs, toggle(abbr)] */
export function useFavorites(sport = 'nfl') {
  const [favs, setFavs] = useState(() => read(sport));
  useEffect(() => {
    const f = () => setFavs(read(sport));
    f();
    subs.add(f);
    return () => subs.delete(f);
  }, [sport]);
  return [favs, (abbr) => toggleFavorite(sport, abbr)];
}

/** 1 when either team in the game is a favorite. */
export const favoriteRank = (g, favs) => (favs.has(g.home.abbr) || favs.has(g.away.abbr) ? 1 : 0);
