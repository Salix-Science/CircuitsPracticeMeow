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
  'js/gradebook.js',
  'js/admin.js',
  'js/progress.js',
  'js/calendar.js',
  'js/ratings.js',
  'js/notifications.js',
  'js/app.js',
];

for (const src of scripts) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = (e) => { console.error('Failed to load', src, e); reject(e); };
    document.head.appendChild(s);
  });
}
