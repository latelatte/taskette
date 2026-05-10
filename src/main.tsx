import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import { App } from './App.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element not found');

// Sandbox is dev-only design QA, code-split out of the production bundle.
const isSandbox = import.meta.env.DEV
  && new URLSearchParams(window.location.search).has('sandbox');
const Sandbox = isSandbox
  ? lazy(() => import('./Sandbox.js').then((m) => ({ default: m.Sandbox })))
  : null;

createRoot(rootEl).render(
  <StrictMode>
    {Sandbox === null
      ? <App />
      : <Suspense fallback={null}><Sandbox /></Suspense>}
  </StrictMode>,
);
