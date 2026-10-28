import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyAppearance } from './appearance';
import { installPressedState } from './lib/pressed';

// The four mode colours and the radar colour come from src/config.ts (one place); the appearance (Standard or
// Azulejo) is applied before the first paint.
applyAppearance();
installPressedState();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support (docs/OFFLINE.md): keeps the app and the timetable on the device. Production builds only,
// so the dev server always serves fresh files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Offline support unavailable:', err));
  // The page may already have finished loading when this module runs; then 'load' never fires again.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
