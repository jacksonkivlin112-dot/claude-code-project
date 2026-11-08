import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CFGS, SPORT_LABEL, useDualSports } from '../dualSport.jsx';
import { useNbaContext } from '../nba/pages/Props.jsx';
import { normName } from '../oddsapi.js';
import { BREAKEVEN } from '../propsModel.js';
import { parseSlipText } from '../slipParse.js';
import { PAYOUTS, americanOdds, breakEvenFlex, breakEvenPower, evFlex, evPower, hitDistribution, kelly, quantiles } from '../slipMath.js';
import { SaveSlipButton } from '../components/Tracking.jsx';
import { Avatar, Card, Empty, Segmented, SkeletonRows, TeamLogo, f1, kickoff, useUi } from '../components/ui.jsx';
import { NFL_CFG, useNflContext } from './Props.jsx';

const pct = (p, d = 1) => (p == null || Number.isNaN(p) ? '—' : `${(p * 100).toFixed(d)}%`);
const signed = (v, d = 1, suf = '') => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}${suf}`);

// ---- OCR -------------------------------------------------------------------------

/** Upscale, grayscale, invert dark screenshots and boost contrast so OCR reads app text well. */
async function preprocess(file) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  const scale = img.width < 1100 ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = img.width * scale;
  c.height = img.height * scale;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const dark = sum / (px.length / 4) < 120;
  for (let i = 0; i < px.length; i += 4) {
    let v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (dark) v = 255 - v;
    v = Math.max(0, Math.min(255, (v - 128) * 1.6 + 128));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  g.putImageData(data, 0, 0);
  return { canvas: c, url: img.src };
}

export async function runOcr(file, onProgress) {
  const { canvas } = await preprocess(file);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress),
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

// ---- Page ------------------------------------------------------------------------

// Reached from the NFL tab: NFL data comes from the page's provider, NBA is loaded alongside.
export default function Scan() {
  const own = useNflContext();
  return <ScanPage home="nfl" own={own} />;
}

export function NbaScanRoute() {
  const own = useNbaContext();
  return <ScanPage home="nba" own={own} />;
}

function ScanPage({ home, own }) {
  const [sports, bridge] = useDualSports(home, own);
  const roster = useMemo(
    () => [
      ...(sports.nfl.rows || []).filter((r) => r.pos !== 'K' && r.pos !== 'DEF').map((r) => ({ ...r, sport: 'nfl' })),
      ...(sports.nba.rows || []).map((r) => ({ ...r, sport: 'nba' })),
    ],
    [sports.nfl.rows, sports.nba.rows], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const byName = useMemo(() => {
    const m = new Map();
    for (const r of roster) if (!m.has(normName(r.name))) m.set(normName(r.name), r);
    return m;
  }, [roster]);
  const sportOf = (l) => l.sport || byName.get(normName(l.player || ''))?.sport || null;
  const aliasesFor = (p) => CFGS[p.sport]?.aliases;
  const [legs, setLegs] = useState([]);
  const [status, setStatus] = useState(null); // {phase, progress}
  const [preview, setPreview] = useState(null);
  const [rawText, setRawText] = useState('');
  const [showText, setShowText] = useState(false);
  const [stake, setStake] = useState('10');
  const [mode, setMode] = useState('auto');
  const [power, setPower] = useState(PAYOUTS.power);
  const [flex, setFlex] = useState(PAYOUTS.flex);
  const inputRef = useRef();

  // Legs handed over from the Parlay Builder.
  useEffect(() => {
    try {
      const pre = JSON.parse(localStorage.getItem('ge:scan:prefill') || 'null');
      if (pre?.length) {
        setLegs(pre);
        setStatus({ phase: `Loaded ${pre.length} legs from the Parlay Builder`, done: true, ok: true });
      }
      localStorage.removeItem('ge:scan:prefill');
    } catch { /* ignore */ }
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPreview(URL.createObjectURL(file));
    setStatus({ phase: 'Reading screenshot…', progress: 0 });
    try {
      const text = await runOcr(file, (p) => setStatus({ phase: 'Reading screenshot…', progress: p }));
      setRawText(text);
      const found = parseSlipText(text, roster, aliasesFor);
      window.__geScan = { text, found }; // last scan, for debugging and tests
      setLegs(found.length ? found : []);
      setStatus({ phase: found.length ? `Found ${found.length} leg${found.length === 1 ? '' : 's'}` : 'No players recognized. Add the legs below or check the extracted text.', done: true, ok: found.length > 0 });
    } catch (e) {
      setStatus({ phase: `Couldn’t read the image (${e.message}). Add legs manually below.`, done: true, ok: false });
    }
  }, [roster]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); handleFile(item.getAsFile()); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  const reparse = () => {
    const found = parseSlipText(rawText, roster, aliasesFor);
    setLegs(found);
    setStatus({ phase: `Re-read text · ${found.length} leg${found.length === 1 ? '' : 's'}`, done: true, ok: found.length > 0 });
  };

  const analyzed = useMemo(() => legs.map((l, i) => {
    const sport = sportOf(l);
    const cfg = CFGS[sport];
    const ctx = sport ? sports[sport].ctx : null;
    if (!cfg || !ctx || !l.player || !l.market || !cfg.markets[l.market] || l.line == null || Number.isNaN(Number(l.line))) return { leg: l, i, sport, incomplete: true };
    const e = cfg.evaluate({ id: `scan:${i}`, player: l.player, market: l.market, line: Number(l.line) }, ctx);
    if (!e || e.unmatched || e.mean == null) return { leg: l, i, sport, unmatched: true, e };
    const prob = l.side === 'under' ? e.pUnder : e.pOver;
    return { leg: l, i, sport, cfg, ctx, e, prob };
  }), [legs, sports.nfl.ctx, sports.nba.ctx, byName]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = { nfl: !!sports.nfl.ctx, nba: !!sports.nba.ctx };

  const valid = analyzed.filter((a) => a.prob != null);
  const update = (i, patch) => setLegs((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Slip scanner</p>
          <h1>Analyze a PrizePicks Slip</h1>
          <p className="hero-sub">
            Upload or paste a screenshot of your PrizePicks entry or board. <strong>NFL, NBA, or both mixed in one parlay</strong>: each leg is matched to the right sport automatically. The text is read on your device and never uploaded.
            Every leg runs through the full prop model, and the whole slip gets exact odds: chance of each hit count, Power and Flex expected value, break-evens, suggested stake and correlation risk.
          </p>
        </div>
      </div>

      {bridge}

      <section
        className={`scan-drop ${status && !status.done ? 'busy' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
      >
        {preview && <img src={preview} alt="Uploaded slip" className="scan-thumb" />}
        <div className="scan-drop-body">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7h3l2-3h8l2 3h3v13H3z" /><circle cx="12" cy="13" r="4" /></svg>
          <strong>{preview ? 'Scan another screenshot' : 'Drop a screenshot here'}</strong>
          <span className="muted small">or paste it (Ctrl/⌘+V), or</span>
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>Choose image</button>
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          <span className="scan-ready">
            {['nfl', 'nba'].map((k) => <span key={k} className={ready[k] ? 'on' : ''}>{ready[k] ? '✓' : '…'} {SPORT_LABEL[k]} {ready[k] ? 'ready' : 'loading'}</span>)}
          </span>
          {status && (
            <div className={`scan-status ${status.done ? (status.ok ? 'ok' : 'warn') : ''}`}>
              {!status.done && <div className="meter"><div className="meter-fill tone-accent" style={{ width: `${Math.round((status.progress || 0) * 100)}%` }} /></div>}
              <span>{status.phase}{!status.done && status.progress ? ` ${Math.round(status.progress * 100)}%` : ''}</span>
            </div>
          )}
        </div>
      </section>

      <LegEditor legs={legs} setLegs={setLegs} update={update} roster={roster} byName={byName} analyzed={analyzed} />

      {rawText && (
        <div className="scan-raw">
          <button type="button" className="link small" onClick={() => setShowText((s) => !s)}>{showText ? 'Hide' : 'Show'} text read from the image</button>
          {showText && (
            <>
              <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={8} spellCheck={false} />
              <button type="button" className="btn-ghost" onClick={reparse}>Re-read legs from this text</button>
            </>
          )}
        </div>
      )}

      {!ready.nfl && !ready.nba ? (
        <Card><SkeletonRows n={4} h={60} /></Card>
      ) : valid.length === 0 ? (
        <Card><Empty title="Add at least one complete leg">Each leg needs a player, a stat and a line. The analysis appears here instantly.</Empty></Card>
      ) : (
        <>
          <SlipSummary legs={valid} stake={stake} setStake={setStake} mode={mode} setMode={setMode} power={power} flex={flex} />
          <div className="scan-save">
            <SaveSlipButton
              className="btn"
              title={`Scanned ${valid.length}-pick slip`}
              source="scan"
              legs={valid.map((a) => ({ sport: a.sport, playerId: a.e.playerId, player: a.e.player, team: a.e.team, opp: a.e.opp, market: a.leg.market, stat: a.e.marketShort, line: Number(a.leg.line), side: a.leg.side || 'over', prob: a.prob, gameTime: a.e.commence || a.ctx.gameByTeam?.[a.e.team]?.date, gameId: a.ctx.gameByTeam?.[a.e.team]?.id, week: a.ctx.week }))}
            />
          </div>
          <PayoutAssumptions power={power} setPower={setPower} flex={flex} setFlex={setFlex} />
          <div className="section-head"><h2>Leg-by-leg breakdown</h2><span className="muted small">Every number the model uses for each pick</span></div>
          <div className="leg-cards">
            {valid.map((a) => <LegCard key={a.i} a={a} home={home} mixed={new Set(valid.map((v) => v.sport)).size > 1} n={valid.length} power={power} />)}
          </div>
        </>
      )}

      <p className="disclaimer">
        Probabilities are model estimates from projections, recent form, matchups and game script. They are not guarantees, and real outcomes vary. Legs are treated as independent except where flagged. Payout multipliers are PrizePicks’ standard ones and may differ by state or promotion, so edit them above if needed. Play responsibly: 18+/21+ where legal. Help: 1-800-GAMBLER.
      </p>
    </div>
  );
}

// ---- Leg editor --------------------------------------------------------------------

function LegEditor({ legs, setLegs, update, roster, byName, analyzed }) {
  return (
    <Card title="Slip legs" subtitle="Check what was read and fix anything that’s off. Changes update the analysis instantly." action={<button type="button" className="btn-ghost" onClick={() => setLegs((l) => [...l, { player: '', market: null, line: null, side: 'over' }])}>+ Add leg</button>}>
      {legs.length === 0 ? (
        <p className="muted small">No legs yet. Upload a screenshot, or add legs by hand.</p>
      ) : (
        <div className="leg-editor">
          <datalist id="scan-names">{roster.map((r) => <option key={`${r.sport}${r.id}`} value={r.name}>{SPORT_LABEL[r.sport]} · {r.pos} · {r.team}</option>)}</datalist>
          {legs.map((l, i) => {
            const r = byName.get(normName(l.player || ''));
            const sport = l.sport || r?.sport;
            const cfg = CFGS[sport] || NFL_CFG;
            const markets = r ? cfg.marketsFor(r) : Object.keys(cfg.markets);
            const a = analyzed[i];
            return (
              <div key={i} className={`le-row ${a?.unmatched || (l.player && !r) ? 'bad' : ''}`}>
                <span className="le-n">{i + 1}</span>
                <input className="le-player" list="scan-names" value={l.player || ''} placeholder="Player (NFL or NBA)" onChange={(e) => { const hit = byName.get(normName(e.target.value)); update(i, { player: e.target.value, sport: hit?.sport || null, ...(hit && hit.sport !== l.sport ? { market: null } : {}) }); }} aria-label={`Leg ${i + 1} player`} />
                <select value={l.market || ''} onChange={(e) => update(i, { market: e.target.value || null })} aria-label={`Leg ${i + 1} stat`}>
                  <option value="">Stat…</option>
                  {markets.map((k) => <option key={k} value={k}>{cfg.markets[k].label}</option>)}
                </select>
                <input className="le-line" type="number" step="0.5" min="0" inputMode="decimal" value={l.line ?? ''} placeholder="Line" onChange={(e) => update(i, { line: e.target.value === '' ? null : Number(e.target.value) })} aria-label={`Leg ${i + 1} line`} />
                <Segmented size="sm" label={`Leg ${i + 1} side`} value={l.side} onChange={(v) => update(i, { side: v })} options={[{ value: 'over', label: 'More' }, { value: 'under', label: 'Less' }]} />
                {sport && <span className={`sport-tag ${sport}`}>{SPORT_LABEL[sport]}</span>}
                <span className="le-prob">{a?.prob != null ? <strong className={a.prob >= BREAKEVEN ? 'pos-txt' : 'neg-txt'}>{pct(a.prob, 0)}</strong> : <span className="muted small">{l.player && !r ? 'Not found' : '—'}</span>}</span>
                {l.confidence != null && <span className={`le-conf ${l.confidence >= 85 ? 'hi' : l.confidence >= 60 ? 'mid' : 'lo'}`} title={`Read from image: ${l.source || ''}`}>{l.confidence}% read</span>}
                <button type="button" className="le-x" onClick={() => setLegs((ls) => ls.filter((_, k) => k !== i))} aria-label={`Remove leg ${i + 1}`}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---- Slip summary ------------------------------------------------------------------

function SlipSummary({ legs, stake, setStake, mode, setMode, power, flex }) {
  const probs = legs.map((a) => a.prob);
  const n = probs.length;
  const dist = hitDistribution(probs);
  const expHits = probs.reduce((a, b) => a + b, 0);
  const pw = evPower(probs, power);
  const fx = evFlex(probs, flex);
  const bePow = breakEvenPower(n, power);
  const beFlex = breakEvenFlex(n, flex);
  const bet = Math.max(0, parseFloat(stake) || 0);
  const best = pw && fx ? (fx.ev > pw.ev ? 'flex' : 'power') : pw ? 'power' : fx ? 'flex' : null;
  const chosen = mode === 'auto' ? best : mode;
  const ev = chosen === 'power' ? pw?.ev : fx?.ev;
  const kPow = pw ? kelly(pw.pAll, pw.mult) : 0;
  const weakest = [...legs].sort((a, b) => a.prob - b.prob)[0];
  const avgP = expHits / n;
  const geo = probs.reduce((a, p) => a * p, 1) ** (1 / n);

  // Correlation: legs sharing a team or game are not independent.
  const warnings = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const A = legs[i].e;
      const B = legs[j].e;
      if (!A.team || !B.team || legs[i].sport !== legs[j].sport) continue;
      if (A.team === B.team) warnings.push({ tone: legs[i].leg.side === legs[j].leg.side ? 'warn' : 'bad', text: `${A.player} and ${B.player} play for ${A.team}. Same-team legs move together, so a bad game script hurts both${legs[i].leg.side !== legs[j].leg.side ? ', and opposite sides partly cancel out' : ''}.` });
      else if (A.opp === B.team) warnings.push({ tone: 'warn', text: `${A.player} (${A.team}) and ${B.player} (${B.team}) are in the same game. Pace and game script link these outcomes.` });
    }
  }
  if (legs.some((a) => a.e.injury)) warnings.push({ tone: 'bad', text: `Injury designation on ${legs.filter((a) => a.e.injury).map((a) => `${a.e.player} (${a.e.injury})`).join(', ')}.` });
  if (legs.some((a) => a.e.started)) warnings.push({ tone: 'warn', text: 'Some legs are from games already underway or final. Their odds no longer reflect pregame value.' });

  const verdict = ev == null ? null : ev > 0.15 ? { tone: 'great', label: 'Strong +EV entry' } : ev > 0 ? { tone: 'good', label: 'Slight +EV entry' } : ev > -0.15 ? { tone: 'warn', label: 'Slightly −EV' } : { tone: 'bad', label: 'Negative EV' };
  const maxD = Math.max(...dist);

  return (
    <section className="slip-sum">
      <div className="ss-top">
        <div className="ss-hero">
          <span className="eyebrow">All {n} legs hit</span>
          <strong className="ss-big">{pct(dist[n])}</strong>
          <span className="muted small">Fair odds {americanOdds(dist[n])} · expected {expHits.toFixed(2)} of {n} legs hit</span>
          {verdict && <span className={`ss-verdict tone-${verdict.tone}`}>{verdict.label}{ev != null ? ` · ${signed(ev * 100, 1, '%')} EV (${chosen === 'power' ? 'Power' : 'Flex'})` : ''}</span>}
        </div>
        <div className="ss-dist" role="img" aria-label="Chance of each number of hits">
          {dist.map((p, k) => {
            const pays = chosen === 'power' ? (k === n ? power[n] : 0) : (flex[n]?.[k] || 0);
            return (
              <div key={k} className="ss-bar-col" title={`${k} of ${n} hit: ${pct(p, 2)}${pays ? ` · pays ${pays}x` : ''}`}>
                <span className="ss-bar-val">{pct(p, 0)}</span>
                <div className={`ss-bar ${pays > 1 ? 'win' : pays > 0 ? 'push' : ''}`} style={{ height: `${Math.max(3, (p / maxD) * 100)}%` }} />
                <span className="ss-bar-k">{k}/{n}</span>
                {pays > 0 && <span className="ss-bar-pay">{pays}x</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="ss-controls">
        <label className="select-label">Entry $<input type="number" min="0" step="1" value={stake} onChange={(e) => setStake(e.target.value)} className="ss-stake" /></label>
        <Segmented size="sm" label="Entry type" value={mode} onChange={setMode} options={[{ value: 'auto', label: `Best (${best === 'flex' ? 'Flex' : 'Power'})` }, { value: 'power', label: 'Power' }, ...(fx ? [{ value: 'flex', label: 'Flex' }] : [])]} />
      </div>

      <div className="ss-grid">
        <Metric label="Power payout" value={pw ? `${pw.mult}x` : 'n/a'} sub={pw ? `$${(bet * pw.mult).toFixed(2)} if all hit` : `${n}-pick Power not offered`} />
        <Metric label="Power EV" value={pw ? signed(pw.ev * 100, 1, '%') : '—'} sub={pw ? `${pw.ev >= 0 ? '+' : '−'}$${Math.abs(bet * pw.ev).toFixed(2)} per entry` : ''} tone={pw ? (pw.ev >= 0 ? 'pos' : 'neg') : ''} />
        <Metric label="Flex EV" value={fx ? signed(fx.ev * 100, 1, '%') : 'n/a'} sub={fx ? `Cash ${pct(fx.pCash, 0)} · profit ${pct(fx.pProfit, 0)}` : 'Flex needs 3–6 picks'} tone={fx ? (fx.ev >= 0 ? 'pos' : 'neg') : ''} />
        <Metric label="Break-even per leg" value={pct(bePow, 1)} sub={`Power · Flex ${beFlex ? pct(beFlex, 1) : 'n/a'}`} />
        <Metric label="Average leg" value={pct(avgP)} sub={`Geometric mean ${pct(geo)} · ${avgP >= (bePow || 1) ? 'above' : 'below'} Power break-even`} tone={avgP >= (bePow || 1) ? 'pos' : 'neg'} />
        <Metric label="Kelly stake" value={pct(kPow, 2)} sub={kPow > 0 ? `of bankroll (¼-Kelly ${pct(kPow / 4, 2)})` : 'No edge: Kelly says pass'} />
        <Metric label="At least one miss" value={pct(1 - dist[n])} sub={`Lose all on Power ${pct(1 - dist[n], 0)}`} />
        <Metric label="Weakest leg" value={weakest.e.player} sub={`${weakest.leg.side === 'over' ? 'More' : 'Less'} ${weakest.leg.line} ${weakest.e.marketShort} · ${pct(weakest.prob, 0)}`} tone={weakest.prob < BREAKEVEN ? 'neg' : ''} />
      </div>

      {weakest.prob < (bePow || BREAKEVEN) && n > 2 && (
        <p className="ss-tip">Dropping <strong>{weakest.e.player}</strong> raises the all-hit chance to <strong>{pct(dist[n] / weakest.prob)}</strong> as a {n - 1}-pick{power[n - 1] ? ` paying ${power[n - 1]}x (EV ${signed(((dist[n] / weakest.prob) * power[n - 1] - 1) * 100, 1, '%')})` : ''}.</p>
      )}
      {warnings.length > 0 && (
        <ul className="ss-warn">{warnings.map((w, i) => <li key={i} className={`r-${w.tone === 'bad' ? 'neg' : 'neutral'}`}>{w.text}</li>)}</ul>
      )}
    </section>
  );
}

function Metric({ label, value, sub, tone = '' }) {
  return (
    <div className="ss-metric">
      <span className="stat-label">{label}</span>
      <strong className={tone === 'pos' ? 'pos-txt' : tone === 'neg' ? 'neg-txt' : ''}>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

function PayoutAssumptions({ power, setPower, flex, setFlex }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pay-assume">
      <button type="button" className="link small" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Edit'} payout assumptions</button>
      {open && (
        <div className="pay-grid">
          <div>
            <h3>Power</h3>
            {Object.entries(power).map(([n, m]) => (
              <label key={n} className="pay-row">{n} picks <input type="number" step="0.5" value={m} onChange={(e) => setPower({ ...power, [n]: Number(e.target.value) })} />x</label>
            ))}
          </div>
          <div>
            <h3>Flex</h3>
            {Object.entries(flex).map(([n, t]) => (
              <div key={n} className="pay-row">
                <span>{n} picks</span>
                {Object.entries(t).sort((a, b) => b[0] - a[0]).map(([k, m]) => (
                  <label key={k}>{k}/{n} <input type="number" step="0.1" value={m} onChange={(e) => setFlex({ ...flex, [n]: { ...t, [k]: Number(e.target.value) } })} />x</label>
                ))}
              </div>
            ))}
          </div>
          <button type="button" className="btn-ghost" onClick={() => { setPower(PAYOUTS.power); setFlex(PAYOUTS.flex); }}>Reset to standard</button>
        </div>
      )}
    </div>
  );
}

// ---- Leg card ----------------------------------------------------------------------

function LegCard({ a, home, mixed, n, power }) {
  const { e, leg, prob, cfg, ctx } = a;
  const { openPlayer } = useUi();
  const gameByTeam = ctx.gameByTeam || {};
  const M = cfg.markets[leg.market];
  const dist = M.dist === 'poisson' || (M.poissonBelow && e.mean < M.poissonBelow) ? 'poisson' : 'normal';
  const sd = e.sd || Math.sqrt(Math.max(e.mean, 0.01));
  const qs = quantiles(dist, e.mean, sd);
  const other = leg.side === 'over' ? e.pUnder : e.pOver;
  const z = (e.mean - leg.line) / sd;
  const be = breakEvenPower(n, power) || BREAKEVEN;
  const step = e.mean >= 60 ? 10 : e.mean >= 25 ? 5 : e.mean >= 8 ? 1 : 0.5;
  const sens = [-2, -1, 0, 1, 2].map((d) => ({ d, ln: leg.line + d * step }));
  const hits = e.recent || [];
  const hitN = hits.filter((h) => (leg.side === 'over' ? h.val > leg.line : h.val < leg.line)).length;
  const g = e.team ? gameByTeam[e.team] : null;
  const lo = Math.min(qs[0], leg.line) * 0.9;
  const hi = Math.max(qs[4], leg.line) * 1.08 || 1;
  const x = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  const edge = prob - be;

  return (
    <article className={`leg-card ${prob >= be ? 'good' : 'bad'}`}>
      <header className="lc-head">
        <button type="button" className="lc-player" onClick={() => e.playerId && a.sport === home && openPlayer(e.playerId)}>
          <Avatar player={{ id: e.playerId || '0', sport: cfg.sport, pos: e.pos, team: e.team, first: e.player.split(' ')[0], last: e.player.split(' ').slice(-1)[0] }} size={46} />
          <span>
            <strong>{e.player}{mixed && <span className={`sport-tag ${a.sport}`}>{SPORT_LABEL[a.sport]}</span>}</strong>
            <small>{e.pos} · {e.team}{e.opp ? ` vs ${e.opp}` : ''}{g ? ` · ${g.state === 'pre' ? kickoff(g.date) : g.state === 'in' ? 'Live' : 'Final'}` : ''}</small>
          </span>
        </button>
        <span className={`lc-pick ${leg.side}`}>{leg.side === 'over' ? 'MORE' : 'LESS'} {leg.line} <small>{M.label}</small></span>
        <span className="lc-prob">
          <strong className={prob >= be ? 'pos-txt' : 'neg-txt'}>{pct(prob)}</strong>
          <small className={`grade-txt g-${prob >= 0.64 ? 'strong' : prob >= 0.58 ? 'solid' : prob >= BREAKEVEN ? 'lean' : 'pass'}`}>{prob >= 0.64 ? 'Strong' : prob >= 0.58 ? 'Solid' : prob >= BREAKEVEN ? 'Lean' : 'Below break-even'}</small>
        </span>
      </header>

      {other > prob && <p className="lc-flip">The model prefers <strong>{leg.side === 'over' ? 'Less' : 'More'}</strong> here ({pct(other)}). Consider flipping this leg.</p>}

      <div className="lc-grid">
        <Metric label="Model projection" value={f1(e.mean)} sub={`σ ${f1(sd)} · ${dist === 'poisson' ? 'Poisson' : 'Normal'} model`} />
        <Metric label="Edge vs line" value={signed(e.mean - leg.line)} sub={`${signed(((e.mean - leg.line) / Math.max(leg.line, 0.5)) * 100, 1, '%')} · z ${signed(z, 2)}`} tone={(leg.side === 'over' ? z : -z) > 0 ? 'pos' : 'neg'} />
        <Metric label="Fair line" value={f1(qs[2])} sub="Median outcome (50/50 point)" />
        <Metric label="Fair odds" value={americanOdds(prob)} sub={`Opposite side ${americanOdds(other)}`} />
        <Metric label="Edge vs break-even" value={signed(edge * 100, 1, ' pts')} sub={`Needs ${pct(be, 1)} for a ${n}-pick Power`} tone={edge >= 0 ? 'pos' : 'neg'} />
        <Metric label="Hit rate at this line" value={hits.length ? `${hitN}/${hits.length}` : '—'} sub={hits.length ? `${pct(hitN / hits.length, 0)} of recent games` : 'No recent games'} tone={hits.length ? (hitN / hits.length >= 0.6 ? 'pos' : hitN / hits.length <= 0.4 ? 'neg' : '') : ''} />
        <Metric label="Season avg" value={f1(e.seasonAvg)} sub={`Last ${cfg.sport === 'nba' ? 5 : 3}: ${f1(e.last3)}`} />
        <Metric label="Projection feed" value={e.projVal != null ? f1(e.projVal) : '—'} sub={e.matchup ? `Opp. rank ${e.matchup.rank}/${e.matchup.of} vs position` : 'Matchup data pending'} />
      </div>

      <div className="lc-dist">
        <div className="lc-dist-head"><span className="stat-label">Outcome range</span><span className="muted small">10th · 25th · median · 75th · 90th percentile</span></div>
        <div className="lc-track">
          <div className="lc-band outer" style={{ left: x(qs[0]), width: `calc(${x(qs[4])} - ${x(qs[0])})` }} />
          <div className="lc-band inner" style={{ left: x(qs[1]), width: `calc(${x(qs[3])} - ${x(qs[1])})` }} />
          <div className="lc-med" style={{ left: x(qs[2]) }} />
          <div className="lc-line" style={{ left: x(leg.line) }}><span>Line {leg.line}</span></div>
        </div>
        <div className="lc-qs">{qs.map((q, k) => <span key={k}>{f1(q)}</span>)}</div>
      </div>

      <div className="lc-sens">
        <span className="stat-label">If the line moves</span>
        <div className="lc-sens-row">
          {sens.map(({ ln, d }) => <SensCell key={d} cfg={cfg} ctx={ctx} leg={leg} line={ln} current={d === 0} />)}
        </div>
      </div>

      {hits.length > 0 && (
        <div className="lc-hist">
          <span className="stat-label">Recent games vs {leg.line}</span>
          <div className="lc-hist-row">
            {hits.map((h) => {
              const win = leg.side === 'over' ? h.val > leg.line : h.val < leg.line;
              return <span key={h.week} className={win ? 'w' : h.val === leg.line ? 'p' : 'l'} title={h.label || `Wk ${h.week} vs ${h.opp}`}>{Math.round(h.val * 10) / 10}</span>;
            })}
          </div>
        </div>
      )}

      <ul className="lc-reasons">{e.reasons.map((r, k) => <li key={k} className={`r-${r.tone}`}>{r.text}</li>)}</ul>
    </article>
  );
}

/** Probability for the chosen side at a shifted line. */
function SensCell({ cfg, ctx, leg, line, current }) {
  if (line < 0 || !ctx) return <span className="sens-cell muted">—</span>;
  const e = cfg.evaluate({ id: `sens:${leg.player}:${leg.market}:${line}`, player: leg.player, market: leg.market, line }, ctx);
  const p = e ? (leg.side === 'under' ? e.pUnder : e.pOver) : null;
  return (
    <span className={`sens-cell ${current ? 'cur' : ''}`}>
      <small>{line}</small>
      <strong className={p >= BREAKEVEN ? 'pos-txt' : 'neg-txt'}>{p != null ? `${Math.round(p * 100)}%` : '—'}</strong>
    </span>
  );
}
