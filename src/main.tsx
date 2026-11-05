import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { restoreReturnHash } from './supabase';
import './index.css';

// Google sends people back to the site root; put the page they signed in from (#mypass, #admin, #scan) back.
restoreReturnHash();

// The admin panel and the scanner are not linked from the site; open /admin or /scan (or /#admin and /#scan on
// hosts without SPA rewrites, which is the reliable URL on GitHub Pages, served under a sub-path).
const AdminPage = lazy(() => import('./AdminPage'));
const ScanPage = lazy(() => import('./ScanPage'));
const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === base + '/admin' || window.location.hash === '#admin';
const isScan = path === base + '/scan' || window.location.hash === '#scan';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin ? <Suspense fallback={null}><AdminPage /></Suspense>
      : isScan ? <Suspense fallback={null}><ScanPage /></Suspense>
      : <App />}
  </React.StrictMode>
);
