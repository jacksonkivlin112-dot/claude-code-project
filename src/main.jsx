import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Long explanations are folded to two lines; tap to expand or fold again.
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('.hero-sub, .pboard-head p.muted, .fold');
  if (el && !e.target.closest('a, button, input, select, label')) el.classList.toggle('open');
});

// Keep Chrome/Android's install prompt so the menu can offer "Install app".
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; window.dispatchEvent(new Event('ge:installable')); });

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Installable app + offline shell (production only, so dev reloads stay fresh).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}

// New-version check: the installed app has no pull-to-refresh, so compare the deployed
// bundle with the running one when the app comes back to the foreground (and every 10 min),
// and offer a one-tap update.
if (import.meta.env.PROD) {
  const current = [...document.scripts].map((s) => s.src).find((s) => /assets\/index-/.test(s));
  let shown = false;
  const check = async () => {
    if (shown || !current) return;
    try {
      const html = await (await fetch(`${import.meta.env.BASE_URL}index.html?ts=${Date.now()}`, { cache: 'no-store' })).text();
      const latest = html.match(/assets\/index-[^"']+\.js/)?.[0];
      if (latest && !current.endsWith(latest)) {
        shown = true;
        const bar = document.createElement('button');
        bar.className = 'update-bar';
        bar.textContent = 'New version available · Tap to update';
        bar.onclick = async () => {
          try { const regs = await navigator.serviceWorker?.getRegistrations?.(); await Promise.all((regs || []).map((r) => r.update())); } catch { /* ignore */ }
          window.location.reload();
        };
        document.body.appendChild(bar);
      }
    } catch { /* offline */ }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, 10 * 60 * 1000);
  setTimeout(check, 5000);
}
