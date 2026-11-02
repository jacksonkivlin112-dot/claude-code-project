/** Big underline tabs pinned with the scoreboard at the top of a game. */
export default function GameTabs({ tabs, value, onChange }) {
  return (
    <nav className="game-tabs" role="tablist" aria-label="Game sections">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} className={value === t.value ? 'on' : ''} onClick={() => { onChange(t.value); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
