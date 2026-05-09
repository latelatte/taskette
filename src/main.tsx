import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import { App } from './App.js';
import { Sandbox } from './Sandbox.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element not found');

const isSandbox = new URLSearchParams(window.location.search).has('sandbox');

createRoot(rootEl).render(
  <StrictMode>
    {isSandbox ? <Sandbox /> : <App />}
  </StrictMode>,
);
