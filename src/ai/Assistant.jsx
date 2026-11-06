import Anthropic from '@anthropic-ai/sdk';
import { useEffect, useRef, useState } from 'react';
import { DataProvider, useData } from '../data.jsx';
import { NbaDataProvider } from '../nba/data.jsx';
import { NBA_CFG, useNbaContext } from '../nba/pages/Props.jsx';
import { NFL_CFG, useNflContext, usePropLines } from '../pages/Props.jsx';
import { TOOLS, runTool, toolLabel } from './tools.js';

const KEY = 'ge:ai:key';
const MODEL_KEY = 'ge:ai:model';
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Smartest' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Fast, about half the cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest, cheapest' },
];
const MAX_STEPS = 10;
const ls = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ } } };

// Stable system prompt: cached together with the tool list.
const SYSTEM = `You are the AI assistant inside Gridiron Edge, a sports app for NFL, NBA and tennis (ATP/WTA) with live play-by-play, projections, a player-prop model, a parlay builder, saved slips and a pick record.

How to work:
- Use the tools for every fact: games, scores, player stats, projections, prop lines and model chances. Never invent a line, stat, injury or score. If a tool returns an error or nothing, say so plainly.
- NFL and NBA tools take a sport parameter; tennis tools take a tour (atp or wta). The user's message starts with the app context (date, which tab they are on); use it to resolve "today", "tonight", "this week" and to pick the sport when they don't name one.
- For a prop question, call evaluate_prop with the exact line. For "best picks" or parlays, prefer get_highest_chance_picks (calibrated, has held up in testing) and get_prop_lines. Combine several tool calls in one turn when they are independent.

Be honest about the model:
- Sportsbook lines are sharp. On graded real lines the model's strong leans have not beaten the line, so chances on real lines are pulled toward 50/50 and often show "no edge". Say that when it applies; don't oversell a pick. get_pick_record has the numbers.
- The highest-chance (floor) lines and tennis win chances are calibrated on past results the model never saw. Their percentages mean what they say, but nothing is a lock.
- Give the chance for a parlay as the product of the legs and note that legs from the same game are correlated.
- This is research and entertainment, not financial advice. If the user talks about chasing losses, betting money they can't afford, or seems distressed about gambling, respond with care and mention 1-800-GAMBLER.

Style: the user is usually on a phone. Lead with the answer in a sentence or two, then a few short bullet points with the key numbers in bold. No tables, no headings longer than a few words, no long preambles. Use player last names after the first mention.`;

/** Mounts a league's data and keeps the latest values in a ref for the tools. */
function Bridge({ sport, sink, onReady }) {
  const own = sport === 'nfl' ? useNflContext() : useNbaContext();
  const data = useData();
  const P = usePropLines(sport);
  sink.current[sport] = { cfg: sport === 'nfl' ? NFL_CFG : NBA_CFG, ctx: own.ctx, rows: own.rows, data, lines: P.lines };
  useEffect(() => { if (own.ctx) onReady(sport); }, [!!own.ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Tiny, safe markdown: bold, italics, inline code, bullets, numbered lists, paragraphs. */
function Md({ text }) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const b = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (b) { if (!list) { list = []; out.push({ list }); } list.push(inline(b[1])); continue; }
    list = null;
    if (!line.trim()) { out.push({ gap: true }); continue; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    out.push({ p: h ? `<b>${inline(h[1])}</b>` : inline(line) });
  }
  return (
    <div className="ai-md">
      {out.map((x, i) => (x.list ? <ul key={i}>{x.list.map((l, k) => <li key={k} dangerouslySetInnerHTML={{ __html: l }} />)}</ul>
        : x.gap ? null : <p key={i} dangerouslySetInnerHTML={{ __html: x.p }} />))}
    </div>
  );
}

const SUGGEST = {
  nfl: ['Who has the best matchups this week?', 'Build me a safe 3-leg NFL parlay', 'Is Bijan Robinson over 85.5 rush + rec yards a good pick?', 'How is the model doing on real lines?'],
  nba: ['What are the highest-chance NBA props tonight?', 'Should I take Jokic over 11.5 rebounds?', 'Build a 3-leg parlay from tonight’s games', 'How are my saved slips doing?'],
  tennis: ['Who are the safest tennis picks today?', 'Preview the biggest ATP match today', 'How has the tennis model done?', 'Give me a 3-leg tennis parlay'],
};

export default function Assistant({ sport, onClose }) {
  const [apiKey, setApiKey] = useState(() => ls.get(KEY));
  const [model, setModel] = useState(() => ls.get(MODEL_KEY) || MODELS[0].id);
  const [settings, setSettings] = useState(!ls.get(KEY));
  const [draftKey, setDraftKey] = useState('');
  const [items, setItems] = useState([]); // chat view
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState({});
  const sink = useRef({});
  const msgs = useRef([]); // API conversation, append-only
  const streamRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [items]);
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', on); document.body.classList.remove('no-scroll'); };
  }, [onClose]);

  const patchLast = (fn) => setItems((xs) => { const c = [...xs]; c[c.length - 1] = fn(c[c.length - 1]); return c; });

  async function send(text) {
    const q = text.trim();
    if (!q || busy) return;
    if (!apiKey) { setSettings(true); return; }
    setInput('');
    setBusy(true);
    setItems((xs) => [...xs, { role: 'user', text: q }, { role: 'assistant', text: '', tools: [], thinking: true }]);
    const context = `[App context: today is ${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, local time ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}; the user is on the ${sport === 'tennis' ? 'Tennis' : sport.toUpperCase()} tab.]`;
    msgs.current.push({ role: 'user', content: `${context}\n\n${q}` });
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const canFallback = model !== 'claude-haiku-5-5';
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 16000,
          ...(canFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system: SYSTEM,
          tools: TOOLS,
          messages: msgs.current,
        });
        streamRef.current = stream;
        stream.on('text', (delta) => patchLast((m) => ({ ...m, text: m.text + delta, thinking: false })));
        const msg = await stream.finalMessage();
        msgs.current.push({ role: 'assistant', content: msg.content });
        if (msg.stop_reason === 'refusal') {
          patchLast((m) => ({ ...m, thinking: false, note: 'Claude declined to answer this one. Try rephrasing.' }));
          break;
        }
        const uses = msg.content.filter((b) => b.type === 'tool_use');
        if (msg.stop_reason === 'max_tokens' && uses.length) {
          patchLast((m) => ({ ...m, thinking: false, note: 'The answer got too long. Ask for a shorter version.' }));
          break;
        }
        if (msg.stop_reason !== 'tool_use' || !uses.length) break;
        patchLast((m) => ({ ...m, thinking: true, tools: [...m.tools, ...uses.map((u) => toolLabel(u.name))], text: m.text ? `${m.text}\n\n` : m.text }));
        const results = await Promise.all(uses.map(async (u) => {
          const okInput = u.input && typeof u.input === 'object' && !Array.isArray(u.input);
          if (!okInput) return { type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'INVALID_JSON: tool input could not be parsed; send it again.' };
          try {
            const out = await runTool(u.name, u.input, sink.current);
            return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 24000), ...(out?.error ? { is_error: true } : {}) };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: u.id, is_error: true, content: `Tool failed: ${e.message || e}` };
          }
        }));
        msgs.current.push({ role: 'user', content: results });
      }
    } catch (e) {
      const msg = e instanceof Anthropic.AuthenticationError ? 'Your API key was rejected. Check it in settings.'
        : e instanceof Anthropic.PermissionDeniedError ? 'This API key doesn’t have access to that model. Try another model in settings.'
        : e instanceof Anthropic.RateLimitError ? 'Rate limited, or your account is out of credits. Wait a moment, or add credits in the Claude Console.'
        : e instanceof Anthropic.APIUserAbortError ? 'Stopped.'
        : e instanceof Anthropic.APIConnectionError ? 'Couldn’t reach Claude. Check your connection.'
        : e instanceof Anthropic.APIError ? `Claude API error ${e.status}: ${e.message}`
        : `Something went wrong: ${e.message || e}`;
      patchLast((m) => ({ ...m, thinking: false, error: msg }));
    } finally {
      streamRef.current = null;
      patchLast((m) => ({ ...m, thinking: false }));
      setBusy(false);
    }
  }

  const saveKey = () => {
    const k = draftKey.trim();
    if (!k) return;
    ls.set(KEY, k); setApiKey(k); setDraftKey(''); setSettings(false);
  };
  const reset = () => { if (!busy) { msgs.current = []; setItems([]); } };
  const loading = sport !== 'tennis' && !ready[sport];

  return (
    <div className="ai-sheet" role="dialog" aria-modal="true" aria-label="AI assistant" onClick={onClose}>
      <NbaDataProvider><Bridge sport="nba" sink={sink} onReady={(s) => setReady((r) => ({ ...r, [s]: true }))} /></NbaDataProvider>
      <DataProvider><Bridge sport="nfl" sink={sink} onReady={(s) => setReady((r) => ({ ...r, [s]: true }))} /></DataProvider>
      <div className="ai-panel" onClick={(e) => e.stopPropagation()}>
        <header className="ai-head">
          <span className="ai-title"><span className="ai-spark" aria-hidden>✦</span> Edge AI <small>{MODELS.find((m) => m.id === model)?.label}</small></span>
          <span className="ai-head-btns">
            {items.length > 0 && <button type="button" className="icon-btn" onClick={reset} title="New chat" aria-label="New chat">↺</button>}
            <button type="button" className={`icon-btn ${settings ? 'on' : ''}`} onClick={() => setSettings((s) => !s)} title="Settings" aria-label="Settings">⚙</button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </span>
        </header>

        {settings ? (
          <div className="ai-settings">
            <h3>Connect your Claude API key</h3>
            <p className="muted small">The assistant runs on Claude through your own Anthropic API account, so it works with no server and nobody else can use your credits. Your key is saved only in this browser on this device and is sent only to Anthropic.</p>
            <ol className="install-help">
              <li>Go to <a className="link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>, sign in and add a few dollars of credit.</li>
              <li>Create an API key and paste it below.</li>
              <li>Tip: set a monthly spend limit in the Console.</li>
            </ol>
            <div className="ai-keyrow">
              <input type="password" autoComplete="off" spellCheck={false} placeholder={apiKey ? 'Key saved: paste a new one to replace it' : 'sk-ant-…'} value={draftKey} onChange={(e) => setDraftKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveKey()} aria-label="Anthropic API key" />
              <button type="button" className="btn" onClick={saveKey} disabled={!draftKey.trim()}>Save</button>
            </div>
            {apiKey && <button type="button" className="link small" onClick={() => { ls.set(KEY, ''); setApiKey(''); }}>Remove saved key</button>}
            <h3>Model</h3>
            <div className="ai-models">
              {MODELS.map((m) => (
                <button key={m.id} type="button" className={model === m.id ? 'on' : ''} onClick={() => { setModel(m.id); ls.set(MODEL_KEY, m.id); }}>
                  <b>{m.label}</b><small>{m.note}</small>
                </button>
              ))}
            </div>
            <p className="muted small">A typical question costs a few cents with Opus, less with Sonnet or Haiku. Anyone who can use this browser can use the saved key, so remove it on shared devices.</p>
            {apiKey && <button type="button" className="btn-ghost" onClick={() => setSettings(false)}>Back to chat</button>}
          </div>
        ) : (
          <>
            <div className="ai-log">
              {items.length === 0 && (
                <div className="ai-empty">
                  <p><b>Ask anything about tonight’s games, players, props or your slips.</b> Answers use the same live data and models as the app.</p>
                  <div className="ai-suggest">
                    {SUGGEST[sport].map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
                  </div>
                  {loading && <p className="muted small">Loading {sport.toUpperCase()} data…</p>}
                </div>
              )}
              {items.map((m, i) => (
                <div key={i} className={`ai-msg ${m.role}`}>
                  {m.role === 'user' ? <p>{m.text}</p> : (
                    <>
                      {m.tools?.length > 0 && <div className="ai-tools">{[...new Set(m.tools)].map((t) => <span key={t}>✓ {t}</span>)}</div>}
                      {m.text && <Md text={m.text} />}
                      {m.thinking && <div className="ai-dots" aria-label="Thinking"><span /><span /><span /></div>}
                      {m.note && <p className="muted small">{m.note}</p>}
                      {m.error && <p className="ai-error">{m.error}</p>}
                    </>
                  )}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <textarea rows={1} value={input} placeholder="Ask about a player, line or game…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} aria-label="Message" />
              {busy ? <button type="button" className="ai-send stop" onClick={() => streamRef.current?.abort()} aria-label="Stop">■</button>
                : <button type="submit" className="ai-send" disabled={!input.trim()} aria-label="Send">↑</button>}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
