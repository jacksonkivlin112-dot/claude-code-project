// Hype messages for slip results: instant local lines, upgraded by Claude when an API key is saved.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const first = (n) => n.split(' ')[0];
const last = (n) => n.split(' ').slice(-1)[0];

const LINES = {
  hit: [
    (e) => `FIRE PICKS BRO 🔥 ${last(e.player)} cashed ${e.side} ${e.line} ${e.stat}`,
    (e) => `${first(e.player)} said "I got you" 😤 ${e.actual} ${e.stat}, never in doubt`,
    (e) => `Another one ✅ ${last(e.player)} took care of business`,
    (e) => `You're cooking right now 👨‍🍳 ${last(e.player)} hits`,
    (e) => `${last(e.player)} ate 🍽️ ${e.actual} ${e.stat} — sharp pick`,
    (e) => `Bro you're locked in 🔒 ${last(e.player)} ${e.side} ${e.line} ✅`,
  ],
  sweat: [
    (e) => `Sweat it out 😅 ${last(e.player)} hit by a hair — ${e.actual} on ${e.line}. A win's a win`,
    (e) => `HEART ATTACK 🫀 ${last(e.player)} squeaks it — ${e.actual} ${e.stat}. Still counts bro`,
  ],
  smash: [
    (e) => `ABSOLUTE SMASH 💥 ${last(e.player)} put up ${e.actual} on a ${e.line} line`,
    (e) => `${last(e.player)} cleared that by a mile 🚀 ${e.actual} ${e.stat}. Fire pick bro`,
  ],
  miss: [
    (e) => `${last(e.player)} let you down 😮‍💨 ${e.actual} on ${e.line}. Shake it off`,
    (e) => `Tough one — ${last(e.player)} fell short (${e.actual}). Process was right, variance happens`,
    (e) => `${last(e.player)} fumbled the bag 💀 ${e.actual} ${e.stat}. On to the next`,
  ],
  won: [
    (e) => `🏆 SLIP CASHED BRO${e.payout ? ` — ${e.payout} payday` : ''}! Fire picks all day 🔥🔥🔥`,
    (e) => `YOU HIT THE ${e.legs}-PICK 💰${e.payout ? ` ${e.payout} secured` : ''}. Screenshot that`,
    (e) => `Every leg cashed 🎯 ${e.legs} for ${e.legs}. You're him`,
  ],
  lost: [
    (e) => `${e.title} didn't get there 😔 ${e.hits}/${e.legs} hit${e.hits === e.legs - 1 ? ' — one leg away, brutal' : ''}. Back at it tomorrow`,
    (e) => `Slip's done (${e.hits}/${e.legs}). Keep the bankroll right and run it back 💪`,
  ],
};

/** Instant local line for a result event. */
export function hypeLine(e) {
  let kind = e.kind;
  if (kind === 'hit' && e.actual != null) {
    const margin = e.side === 'Less' ? e.line - e.actual : e.actual - e.line;
    if (margin <= Math.max(0.5, e.line * 0.04)) kind = 'sweat';
    else if (margin >= Math.max(3, e.line * 0.4)) kind = 'smash';
  }
  return pick(LINES[kind] || LINES.hit)(e);
}

/** One-line hype from Claude (Haiku) when the user saved an API key; null otherwise. */
export async function aiHype(e) {
  let key = '';
  try { key = localStorage.getItem('ge:ai:key') || ''; } catch { /* ignore */ }
  if (!key) return null;
  const what = e.kind === 'won' ? `Their whole ${e.legs}-pick slip "${e.title}" just won${e.payout ? `, paying ${e.payout}` : ''}.`
    : e.kind === 'lost' ? `Their ${e.legs}-pick slip "${e.title}" just lost with ${e.hits}/${e.legs} legs hitting.`
    : `${e.player} (${e.side} ${e.line} ${e.stat}) just ${e.kind === 'hit' ? 'HIT' : 'missed'} with ${e.actual}.`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 80,
        system: 'You are the hype-man in a sports betting tracker app. Write ONE short message (max 18 words) reacting to the bettor\'s result, like a friend texting: casual slang ("bro", "fire picks"), 1-2 emojis. Hype wins hard; for losses be supportive, never encourage chasing losses. Output only the message.',
        messages: [{ role: 'user', content: what }],
      }),
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const text = j.content?.find((c) => c.type === 'text')?.text?.trim();
    return text ? text.replace(/^"|"$/g, '') : null;
  } catch { return null; }
}

/** Show a hype toast anywhere in the app. */
export const sendHype = (e) => window.dispatchEvent(new CustomEvent('ge:hype', { detail: e }));
