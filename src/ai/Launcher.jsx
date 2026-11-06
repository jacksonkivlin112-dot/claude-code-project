import { Suspense, lazy, useEffect, useState } from 'react';

const Assistant = lazy(() => import('./Assistant.jsx'));

/** Floating "Ask AI" button; the assistant (and its SDK) load only when opened. */
export default function AiLauncher({ sport }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener('ge:open-ai', on);
    return () => window.removeEventListener('ge:open-ai', on);
  }, []);
  return (
    <>
      <button type="button" className="ai-fab" onClick={() => setOpen(true)} aria-label="Ask the AI assistant">
        <span aria-hidden>✦</span><b>Ask AI</b>
      </button>
      {open && (
        <Suspense fallback={<div className="ai-sheet"><div className="ai-panel"><div className="ai-dots"><span /><span /><span /></div></div></div>}>
          <Assistant sport={sport} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
