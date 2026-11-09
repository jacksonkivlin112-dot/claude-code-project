import { useEffect, useRef, useState } from 'react';
import { aiHype, hypeLine } from './hype.js';

const COLORS = ['#22c55e', '#facc15', '#f97316', '#a78bfa', '#38bdf8', '#f43f5e'];

/** Toast stack for hype messages (+ confetti on wins). */
export default function HypeHost() {
  const [toasts, setToasts] = useState([]);
  const id = useRef(0);
  useEffect(() => {
    const on = (ev) => {
      const e = ev.detail;
      const n = ++id.current;
      const good = e.kind === 'hit' || e.kind === 'won';
      setToasts((t) => [...t.slice(-2), { n, e, text: hypeLine(e), good, big: e.kind === 'won' }]);
      try { if (good) navigator.vibrate?.(e.kind === 'won' ? [80, 60, 80, 60, 200] : 60); } catch { /* ignore */ }
      aiHype(e).then((text) => text && setToasts((t) => t.map((x) => (x.n === n ? { ...x, text, ai: true } : x))));
      setTimeout(() => setToasts((t) => t.filter((x) => x.n !== n)), e.kind === 'won' ? 9000 : 6500);
    };
    window.addEventListener('ge:hype', on);
    return () => window.removeEventListener('ge:hype', on);
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="hype-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.n} className={`hype ${t.good ? 'good' : 'bad'} ${t.big ? 'big' : ''}`} onClick={() => setToasts((x) => x.filter((y) => y.n !== t.n))}>
          {t.big && (
            <span className="hype-confetti" aria-hidden>
              {Array.from({ length: 36 }, (_, i) => (
                <i key={i} style={{ left: `${(i * 37) % 100}%`, background: COLORS[i % COLORS.length], animationDelay: `${(i % 9) * 0.08}s`, '--dx': `${((i * 53) % 120) - 60}px`, '--rot': `${(i * 97) % 720}deg` }} />
              ))}
            </span>
          )}
          <span className="hype-ai">{t.e.kind === 'injury' ? '⚠ News' : '✦ AI'}</span>
          <p>{t.text}</p>
        </div>
      ))}
    </div>
  );
}
