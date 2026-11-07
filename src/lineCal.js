// Calibration for real sportsbook lines, published by scripts/calibrate-lines.mjs.
import { useEffect, useState } from 'react';

const DEFAULT = { s: 0.08, b: 0, n: 0, usingDefault: true };
const cache = {};

export function useLineCalibration(sport) {
  const [cal, setCal] = useState(cache[sport] || null);
  useEffect(() => {
    if (cache[sport]) { setCal(cache[sport]); return; }
    fetch(`${import.meta.env.BASE_URL}data/${sport && sport !== 'nfl' ? `${sport}/` : ''}lines-calibration.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : DEFAULT))
      .catch(() => DEFAULT)
      .then((j) => { cache[sport] = { ...DEFAULT, ...j }; setCal(cache[sport]); });
  }, [sport]);
  return cal || DEFAULT;
}
