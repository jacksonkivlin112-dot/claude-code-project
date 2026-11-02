import { createContext, useContext, useEffect, useState } from 'react';
import { headshot } from '../api.js';
import { useData } from '../data.jsx';

// ---- formatting -----------------------------------------------------------

export const f1 = (n) => (n == null || Number.isNaN(n) ? '—' : n.toFixed(1));
export const f0 = (n) => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString());
export const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);

export function timeAgo(t) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function kickoff(iso, { long = false } = {}) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: long ? 'long' : 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

/** Re-render periodically so relative timestamps stay fresh. */
export function useNow(ms = 30000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

// ---- overlay context ------------------------------------------------------

const UiCtx = createContext(null);
export const useUi = () => useContext(UiCtx);
export function UiProvider({ children }) {
  const [overlay, setOverlay] = useState(null); // {type:'player'|'team', id}
  return (
    <UiCtx.Provider value={{ overlay, openPlayer: (id) => setOverlay({ type: 'player', id }), openTeam: (id) => setOverlay({ type: 'team', id }), close: () => setOverlay(null) }}>
      {children}
    </UiCtx.Provider>
  );
}

// ---- atoms ----------------------------------------------------------------

export function TeamLogo({ abbr, size = 24, className = '', eager = false }) {
  const { teams } = useData();
  const t = teams?.[abbr];
  const [err, setErr] = useState(false);
  if (!t?.logo || err) {
    return (
      <span className={`logo-fallback ${className}`} style={{ width: size, height: size, fontSize: size * 0.36, background: t?.color || 'var(--surface-3)' }}>
        {abbr}
      </span>
    );
  }
  return <img className={`team-logo ${className}`} src={t.logo} alt={`${t.name} logo`} width={size} height={size} loading={eager ? 'eager' : 'lazy'} onError={() => setErr(true)} />;
}

export function TeamChip({ abbr, size = 20, showName = false }) {
  const { teams } = useData();
  const { openTeam } = useUi();
  const t = teams?.[abbr];
  return (
    <button type="button" className="team-chip" onClick={(e) => { e.stopPropagation(); openTeam(abbr); }} title={t?.name || abbr}>
      <TeamLogo abbr={abbr} size={size} />
      <span>{showName ? t?.short || abbr : abbr}</span>
    </button>
  );
}

export function Avatar({ player, size = 36, badge = false }) {
  const { teams } = useData();
  const [err, setErr] = useState(false);
  const color = teams?.[player.team]?.color || 'var(--surface-3)';
  const initials = player.pos === 'DEF' ? player.team : `${player.first?.[0] || ''}${player.last?.[0] || ''}`;
  return (
    <span className="avatar" style={{ width: size, height: size, '--ring': color }}>
      {err ? (
        <span className="avatar-initials" style={{ fontSize: size * 0.36 }}>{initials}</span>
      ) : (
        <img src={headshot(player)} alt="" loading="lazy" onError={() => setErr(true)} />
      )}
      {badge && player.team && (
        <span className="avatar-badge" style={{ background: color }}>
          <TeamLogo abbr={player.team} size={Math.round(size * 0.34)} />
        </span>
      )}
    </span>
  );
}

export function PosBadge({ pos }) {
  return <span className={`pos pos-${pos}`}>{pos}</span>;
}

export function GradeChip({ grade, matchup, pos }) {
  const title = matchup ? `Allows ${matchup.avg.toFixed(1)} pts/g to ${pos} · ${matchup.rank} of ${matchup.of} (1 = most generous)` : 'Not enough data yet';
  return <span className={`grade tone-${grade.tone}`} title={title}>{grade.letter}</span>;
}

export function Tag({ tag }) {
  return <span className={`tag tone-${tag.tone}`} title={tag.title}>{tag.label}</span>;
}

export function InjuryDot({ status, part }) {
  if (!status) return null;
  const short = { Questionable: 'Q', Doubtful: 'D', Out: 'O', IR: 'IR', PUP: 'PUP', Sus: 'SUS' }[status] || status.slice(0, 3).toUpperCase();
  const tone = status === 'Questionable' ? 'warn' : 'bad';
  return <span className={`inj tone-${tone}`} title={`${status}${part ? ` · ${part}` : ''}`}>{short}</span>;
}

export function Delta({ value, digits = 1, suffix = '' }) {
  if (value == null || Number.isNaN(value)) return <span className="delta muted">—</span>;
  const cls = value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat';
  const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '•';
  return (
    <span className={`delta ${cls}`}>
      <span className="arrow" aria-hidden>{arrow}</span>
      {Math.abs(value).toFixed(digits)}
      {suffix}
    </span>
  );
}

export function Segmented({ options, value, onChange, size = 'md', label }) {
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Card({ title, subtitle, action, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="sub">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Skeleton({ h = 14, w = '100%', r = 6, style }) {
  return <span className="skeleton" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

export function SkeletonRows({ n = 6, h = 44 }) {
  return (
    <div className="skel-rows">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} h={h} r={10} style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-35 12 12)" />
        <path d="M9 15l6-6M10.5 12.5l1 1M12.5 10.5l1 1" />
      </svg>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

// ---- charts ---------------------------------------------------------------

export function Sparkline({ values, width = 84, height = 24, highlightLast = true }) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return <span className="spark-empty">—</span>;
  const max = Math.max(...v, 1);
  const min = Math.min(...v, 0);
  const step = width / (v.length - 1);
  const y = (x) => height - 3 - ((x - min) / (max - min || 1)) * (height - 6);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(x).toFixed(1)}`).join('');
  const trendUp = v[v.length - 1] >= v.reduce((a, b) => a + b, 0) / v.length;
  return (
    <svg className={`spark ${trendUp ? 'up' : 'down'}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={`${d}L${width},${height}L0,${height}Z`} className="spark-fill" />
      <path d={d} className="spark-line" />
      {highlightLast && <circle cx={(v.length - 1) * step} cy={y(v[v.length - 1])} r="2.5" className="spark-dot" />}
    </svg>
  );
}

/** Weekly bar chart with optional dashed reference line (e.g., projection or average). */
export function WeeklyBars({ data, refLine, refLabel, height = 160, maxWeek = 18, minWeek = 1, axisLabel }) {
  const [hover, setHover] = useState(null);
  const byWeek = new Map(data.map((d) => [d.week, d]));
  const last = Math.max(maxWeek, ...data.map((d) => d.week), minWeek);
  const weeks = Array.from({ length: last - minWeek + 1 }, (_, i) => i + minWeek);
  const max = Math.max(...data.map((d) => d.value), refLine || 0, 5) * 1.12;
  const W = 100 / weeks.length;
  return (
    <div className="wbars" style={{ height }}>
      <div className="wbars-plot">
        {refLine != null && (
          <div className="wbars-ref" style={{ bottom: `${(refLine / max) * 100}%` }}>
            <span>{refLabel} {refLine.toFixed(1)}</span>
          </div>
        )}
        {weeks.map((w) => {
          const d = byWeek.get(w);
          return (
            <div key={w} className="wbars-col" style={{ width: `${W}%` }} onMouseEnter={() => setHover(w)} onMouseLeave={() => setHover(null)}>
              {d ? (
                <div className={`wbars-bar ${d.tone || ''} ${hover === w ? 'hover' : ''}`} style={{ height: `${Math.max((d.value / max) * 100, 1.5)}%` }}>
                  {hover === w && (
                    <div className="wbars-tip">
                      <strong>{d.value.toFixed(1)}</strong>
                      <span>{axisLabel ? d.label : `Wk ${w}${d.label ? ` · ${d.label}` : ''}`}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="wbars-none" title={axisLabel ? 'Did not play' : `Week ${w}: did not play`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="wbars-axis">
        {weeks.map((w) => (
          <span key={w} style={{ width: `${W}%` }} className={byWeek.has(w) ? '' : 'dim'}>{axisLabel ? axisLabel(w) : w}</span>
        ))}
      </div>
    </div>
  );
}

export function Meter({ value, max = 100, tone = 'accent', label }) {
  const p = Math.max(0, Math.min(1, value / max));
  return (
    <div className="meter" title={label}>
      <div className={`meter-fill tone-${tone}`} style={{ width: `${p * 100}%` }} />
    </div>
  );
}

export function WinProbBar({ home, away, pHome }) {
  const { teams } = useData();
  const hc = teams?.[home]?.color || 'var(--accent)';
  const ac = teams?.[away]?.color || 'var(--surface-3)';
  return (
    <div className="wp">
      <div className="wp-bar">
        <div style={{ width: `${(1 - pHome) * 100}%`, background: ac }} />
        <div style={{ width: `${pHome * 100}%`, background: hc }} />
      </div>
      <div className="wp-labels">
        <span>{away} {pct(1 - pHome)}</span>
        <span>{pct(pHome)} {home}</span>
      </div>
    </div>
  );
}
