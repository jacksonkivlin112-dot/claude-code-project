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
