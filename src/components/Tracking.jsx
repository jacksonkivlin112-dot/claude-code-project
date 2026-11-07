import { useEffect, useRef, useState } from 'react';
import { saveSlip } from '../slips.js';

const slipsHref = (sport) => `#/${sport && sport !== 'nfl' ? `${sport}/` : ''}slips`;

/**
 * "Save slip" for any list of legs. Legs need: sport, playerId, player, market,
 * line, side; optional team, opp, stat, prob, gameTime|date, gameId, week.
 */
export function SaveSlipButton({ legs, title, source, className = 'btn-ghost' }) {
  const [saved, setSaved] = useState(null);
  const sig = legs.map((l) => `${l.playerId}|${l.market}|${l.line}|${l.side}`).join(',');
  useEffect(() => setSaved(null), [sig]);
  const ok = legs.filter((l) => l.playerId && l.market && l.line != null);
  if (!ok.length) return null;
  if (saved) {
    return <a className={`${className} saved`} href={slipsHref(legs[0].sport)}>Saved ✓ · Track it live →</a>;
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => setSaved(saveSlip({ title, source, legs: ok.map((l) => ({ ...l, gameTime: l.gameTime || l.date })) }))}
      title="Save this slip and follow every leg live"
    >
      ☆ Save slip & track live{ok.length < legs.length ? ` (${ok.length} of ${legs.length} legs)` : ''}
    </button>
  );
}

/** Progress of one leg toward its line. */
export function LegBar({ leg, st }) {
  const actual = st?.actual;
  const fill = actual == null ? 0 : Math.min(1, actual / Math.max(leg.line, 0.5));
  const tone = st?.state === 'final' ? (st.push ? 'push' : st.hit ? 'hit' : 'miss') : st?.state === 'live' ? (st.onPace ? 'pace' : 'behind') : 'idle';
  return (
    <span className={`lbar ${tone}`} aria-hidden>
      <span className="lbar-fill" style={{ width: `${fill * 100}%` }} />
      <span className="lbar-line" />
    </span>
  );
}

/** Sends a notification (via the service worker when available). */
export async function notify(title, body, tag) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) await reg.showNotification(title, { body, tag, icon: './icon-192.png', badge: './icon-192.png' });
    else new Notification(title, { body, tag, icon: './icon-192.png' });
  } catch { /* unsupported */ }
}

const NOTIFIED = 'ge:slips:notified';
/** Fire one alert per leg result / slip result, remembered across reloads. */
export function useSlipAlerts(events) {
  const sent = useRef(null);
  useEffect(() => {
    if (!sent.current) { try { sent.current = new Set(JSON.parse(localStorage.getItem(NOTIFIED)) || []); } catch { sent.current = new Set(); } }
    let changed = false;
    for (const ev of events) {
      if (sent.current.has(ev.key)) continue;
      sent.current.add(ev.key);
      changed = true;
      // Only alert for things that happen while you're following along (not old results on first open).
      if (Date.now() - ev.when < 6 * 3600e3) notify(ev.title, ev.body, ev.key);
    }
    if (changed) { try { localStorage.setItem(NOTIFIED, JSON.stringify([...sent.current].slice(-500))); } catch { /* ignore */ } }
  }, [events]);
}
