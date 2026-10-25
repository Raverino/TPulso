import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyThemeColors } from './config';

// The four mode colours and the radar colour come from src/config.ts (one place).
applyThemeColors();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support (docs/OFFLINE.md): keeps the app and the timetable on the device. Production builds only,
// so the dev server always serves fresh files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Offline support unavailable:', err));
  });
}
