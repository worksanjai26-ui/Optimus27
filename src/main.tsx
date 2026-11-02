import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// The admin panel is not linked from the site; open /admin (or /#admin on hosts without SPA rewrites).
const AdminPage = lazy(() => import('./AdminPage'));
// GitHub Pages serves the site under a sub-path and has no SPA rewrites, so /#admin is the reliable URL there.
const adminPath = import.meta.env.BASE_URL.replace(/\/+$/, '') + '/admin';
const isAdmin = window.location.pathname.replace(/\/+$/, '') === adminPath || window.location.hash === '#admin';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin ? <Suspense fallback={null}><AdminPage /></Suspense> : <App />}
  </React.StrictMode>
);
