/* main.js — Single entry point. Imports firebase.js (which sets up
   window.DB, window.S, window.doLogin etc.), then loads all other
   scripts once Firebase is ready.

   Loading strategy:
   - The first 14 feature scripts are fetched in parallel (Promise.all),
     cutting the serial waterfall down to a single network round-trip.
   - app.js is loaded last and alone because it sets window._appReady = true,
     which signals firebase.js to hand off the pending auth state. It must
     not fire until all feature scripts have finished executing.
*/

import './firebase.js';

// ── Feature scripts — load all in parallel ───────────────────────────────────
// None of these reference each other's globals at parse time; they only
// expose window.* functions that are called later from event handlers and
// app.js routing. Parallel loading is therefore safe.
const featureScripts = [
  'js/home.js',
  'js/practice.js',
  'js/blog.js',
  'js/editor.js',
  'js/assignments.js',
  'js/gradebook.js',
  'js/admin.js',
  'js/sitegrades.js',
  'js/sections.js',
  'js/progress.js',
  'js/calendar.js',
  'js/profile.js',
  'js/notifications.js',
  'js/ratings.js',
  'js/adminlog.js',
];

function loadScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    // Resolve (don't reject) on error so a single missing/failed script can't
    // halt the chain — app.js still loads and the app stays usable. The failed
    // feature simply won't be available; the error is logged for diagnosis.
    s.onerror = (e) => { console.error('Failed to load', src, '— continuing without it', e); resolve(); };
    document.head.appendChild(s);
  });
}

await Promise.all(featureScripts.map(loadScript));

// ── app.js — must run last ───────────────────────────────────────────────────
// Sets window._appReady = true and flushes window._pendingAuthUser.
// Guaranteed to execute only after all feature scripts have finished.
await loadScript('js/app.js');
