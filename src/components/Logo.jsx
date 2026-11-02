import { useId } from 'react';

/** Gridiron Edge mark: gradient shield, gold football in motion, speed streaks. */
export default function Logo({ size = 34 }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo-mark">
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="0.5" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M32 2 58 11v20c0 16-11 26.5-26 31C17 57.5 6 47 6 31V11Z" fill={`url(#${id}s)`} />
      <path d="M32 7.5 52.5 14.8V31c0 12.4-8.2 21-20.5 25.2C19.7 52 11.5 43.4 11.5 31V14.8Z" fill="#0b0d1f" />
      <path d="M15 45h9M13.5 39.5h8M18 50h7" stroke={`url(#${id}s)`} strokeWidth="2.6" strokeLinecap="round" />
      <g transform="rotate(-38 35 29)">
        <ellipse cx="35" cy="29" rx="15" ry="8.6" fill={`url(#${id}b)`} />
        <path d="M28.5 29h13M31.5 26.2v5.6M35 26.2v5.6M38.5 26.2v5.6" stroke="#0b0d1f" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M22.4 25.6c1.6-2 3.5-3.2 5.6-3.9M47.6 32.4c-1.6 2-3.5 3.2-5.6 3.9" stroke="#0b0d1f" strokeWidth="1.5" fill="none" opacity="0.45" strokeLinecap="round" />
      </g>
      <path d="M32 2 58 11v20c0 2-.2 3.9-.5 5.7" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" fill="none" />
    </svg>
  );
}
