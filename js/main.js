/* main.js — Single entry point. Imports firebase.js (which sets up
   window.DB, window.S, window.doLogin etc.), then loads all other
   scripts in order once Firebase is ready. */

import './firebase.js';

// firebase.js is synchronous up to the point of registering onAuthStateChanged,
// so by the time this import resolves, all window.* functions are defined.
// Now dynamically load the remaining scripts in strict order.
const scripts = [
  'js/home.js',
  'js/practice.js',
  'js/blog.js',
  'js/editor.js',
  'js/assignments.js',
  'js/patch-verify.js',   // server-side answer verification — overrides checkMainAnswer + submitAssignProb
  'js/gradebook.js',
  'js/admin.js',
  'js/sitegrades.js',
  'js/sections.js',
  'js/progress.js',
  'js/calendar.js',
  'js/profile.js',
  'js/notifications.js',
  'js/ratings.js',
  'js/app.js',
];

for (const src of scripts) {
  await new Promise((resolve) => {
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
