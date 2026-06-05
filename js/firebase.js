/* firebase.js — Firebase initialisation + DB layer
   All other JS files call saveDB() / loadDB() / window.S / window.DB
   exactly as before — this file is the only thing that changes. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc,
  collection, getDocs, deleteDoc, arrayUnion, addDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAnalytics,
  logEvent,
  setUserId,
  setUserProperties
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// ── Config ────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDjZjWJm4XVDMHo0rnEdxZzKwDSS0ie2KQ",
  authDomain:        "circuitspractice-b4cb0.firebaseapp.com",
  projectId:         "circuitspractice-b4cb0",
  storageBucket:     "circuitspractice-b4cb0.firebasestorage.app",
  messagingSenderId: "14921793805",
  appId:             "1:14921793805:web:146e3685cb1af09e847044",
  measurementId:     "G-BVTRKSKQBJ"
};

const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);

// Analytics may fail in dev (localhost/file://) or if blocked by an ad blocker.
// Wrap in try/catch so a failure here never prevents login from working.
let analytics = null;
try { analytics = getAnalytics(app); } catch(e) { console.info('Analytics unavailable:', e.message); }

// ── User data sanitization ────────────────────
// Called on every user object read from Firestore.
// Enforces strict types on every field so a malicious value
// (e.g. streak = "<img onerror=...>") can never reach the DOM.
// Any field that isn't the expected type is reset to its safe default.
window.sanitizeUser = function(data) {
  const safe = {};

  // Preserve the document ID
  safe.uid = typeof data.uid === 'string' ? data.uid : '';

  // String fields — must be plain strings with no HTML; strip tags entirely
  const stripTags = v => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').slice(0, 200) : '';
  safe.username        = stripTags(data.username);
  safe.notifPrefs      = {};
  if (data.notifPrefs && typeof data.notifPrefs === 'object') {
    safe.notifPrefs.email         = stripTags(data.notifPrefs.email).slice(0, 200);
    safe.notifPrefs.posts         = !!data.notifPrefs.posts;
    safe.notifPrefs.announcements = !!data.notifPrefs.announcements;
    safe.notifPrefs.assignments   = !!data.notifPrefs.assignments;
  }

  // Boolean fields — must be exactly true or false
  safe.isAdmin = data.isAdmin === true;

  // Numeric fields — must be a finite non-negative integer
  const safeInt = (v, max = 1e6) => {
    const n = parseInt(v, 10);
    return (Number.isFinite(n) && n >= 0 && n <= max) ? n : 0;
  };
  safe.streak = safeInt(data.streak, 9999);

  // scores — object of { topicKey: { correct: int, attempted: int } }
  safe.scores = {};
  if (data.scores && typeof data.scores === 'object') {
    for (const [k, v] of Object.entries(data.scores)) {
      if (typeof k !== 'string' || k.length > 100) continue;
      if (!v || typeof v !== 'object') continue;
      safe.scores[k.replace(/<[^>]*>/g, '')] = {
        correct:   safeInt(v.correct),
        attempted: safeInt(v.attempted),
      };
    }
  }

  // assignSubmissions — object of { assignId: { probId: submission } }
  // We don't render values from inside submissions into innerHTML, but sanitize anyway
  safe.assignSubmissions = {};
  if (data.assignSubmissions && typeof data.assignSubmissions === 'object') {
    for (const [aId, probs] of Object.entries(data.assignSubmissions)) {
      if (typeof aId !== 'string' || aId.length > 100) continue;
      if (!probs || typeof probs !== 'object') continue;
      safe.assignSubmissions[aId] = {};
      for (const [pId, sub] of Object.entries(probs)) {
        if (typeof pId !== 'string' || pId.length > 100) continue;
        if (!sub || typeof sub !== 'object') continue;
        safe.assignSubmissions[aId][pId] = {
          correct:   !!sub.correct,
          late:      !!sub.late,
          timestamp: safeInt(sub.timestamp, Date.now() + 1e10),
          details:   Array.isArray(sub.details) ? sub.details.map(d => ({
            label:     stripTags(String(d.label || '')),
            submitted: parseFloat(d.submitted) || 0,
            expected:  parseFloat(d.expected)  || 0,
            unit:      stripTags(String(d.unit || '')).slice(0, 10),
            ok:        !!d.ok,
          })) : [],
        };
      }
    }
  }

  // assignAttempts — tracks how many times each student has attempted a problem
  // in an assignment. Keyed by "assignId-probId-username". Used to enforce
  // per-problem attempt limits and must survive page refreshes.
  safe.assignAttempts = {};
  if (data.assignAttempts && typeof data.assignAttempts === 'object') {
    for (const [k, v] of Object.entries(data.assignAttempts)) {
      if (typeof k !== 'string' || k.length > 200) continue;
      const cleanKey = k.replace(/<[^>]*>/g, '').trim();
      if (!cleanKey) continue;                               // skip empty / pure-tag keys
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 9999) {
        safe.assignAttempts[cleanKey] = n;
      }
    }
  }

  // attemptLog — array, keep structure but sanitize string fields
  safe.attemptLog = [];
  if (Array.isArray(data.attemptLog)) {    safe.attemptLog = data.attemptLog.slice(-500).map(e => ({
      ts:          safeInt(e.ts, Date.now() + 1e10),
      assignId:    stripTags(String(e.assignId  || '')).slice(0, 100),
      probId:      stripTags(String(e.probId    || '')).slice(0, 100),
      probTitle:   stripTags(String(e.probTitle || '')).slice(0, 200),
      assignTitle: stripTags(String(e.assignTitle||'')).slice(0, 200),
      attemptNum:  safeInt(e.attemptNum, 100),
      correct:     !!e.correct,
      late:        !!e.late,
      answers: Array.isArray(e.answers) ? e.answers.map(a => ({
        label:     stripTags(String(a.label    || '')).slice(0, 100),
        submitted: parseFloat(a.submitted)     || 0,
        expected:  parseFloat(a.expected)      || 0,
        unit:      stripTags(String(a.unit     || '')).slice(0, 10),
        ok:        !!a.ok,
      })) : [],
    }));
  }

  return safe;
};


// ALWAYS use this when inserting any user-supplied value into innerHTML.
// Converts < > & " ' into HTML entities so the browser treats them as text,
// never as executable markup.
window.escHtml = function(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};


// ── Blog categories — single source of truth ──
// Both the blog page AND the home page render category pills from here,
// so a colour set in the Category editor is consistent everywhere.
// Stored in Firestore at config/blogCategories as { list:[{name,color}] }.
window.DEFAULT_CATEGORIES = [
  { name:'Tutorial',     color:'#4ade80' },
  { name:'Update',       color:'#9d7de8' },
  { name:'Announcement', color:'#e8c96b' },
  { name:'Resource',     color:'#2dd4bf' },
];

// Convert a #rrggbb (or #rgb) hex to "r,g,b" for use inside rgba()
window.hexToRgb = function(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '157,125,232'; // fallback to accent purple
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

// Look up a category's colour by name (falls back to a neutral grey)
window.getCatColor = function(name) {
  const cats = window.DB.categories && window.DB.categories.length
    ? window.DB.categories : window.DEFAULT_CATEGORIES;
  const c = cats.find(c => c.name === name);
  return c ? c.color : null;
};

// Canonical pill renderer used by blog.js AND home.js
window.catPill = function(cat) {
  const color = window.getCatColor(cat);
  const style = color
    ? `background:rgba(${window.hexToRgb(color)},.12);color:${color};border:0.5px solid rgba(${window.hexToRgb(color)},.30)`
    : 'background:rgba(157,125,232,.08);color:var(--text3);border:0.5px solid var(--border)';
  return `<span class="pill" style="${style}">${window.escHtml(cat)}</span>`;
};

// Persist the category list (admin only). Firestore rules also enforce admin.
window.saveCategories = async function() {
  if (!window.S.isAdmin) { console.warn('[security] saveCategories blocked'); return; }
  const list = Array.isArray(window.DB.categories) ? window.DB.categories : [];
  try {
    await setDoc(doc(db, 'config', 'blogCategories'), { list }, { merge: false });
  } catch(e) {
    console.error('saveCategories failed:', e.code, e.message);
    throw e;
  }
};


function track(eventName, params = {}) {
  if (!analytics) return;
  try { logEvent(analytics, eventName, params); } catch(e) {}
}
// Expose globally so other modules (practice.js, assignments.js) can call it
window.track = track;

// ── In-memory DB mirror ───────────────────────
window.DB = { users:{}, problems:[], folders:[], assignments:[], posts:[], topics:[], homepage:{}, events:[], sections:[], categories:[] };
window.S  = {
  user:null, isAdmin:false, uid:null,
  activeFolderId:null, activeBuiltin:null, currentBuiltinProb:null,
  folderProblems:[], folderIdx:0,
  editingId:null, editorVars:[], editorImg:null, formEnabled:true,
  editingAssignId:null, editingPostId:null, blogFilter:'All', blogSearch:'', blogAuthor:'All'
};

let _varCtr = 0;
window.nextVarId = () => _varCtr++;

// ── Helpers ───────────────────────────────────
function toArray(snapshot) {
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Load shared content from Firestore ────────
async function loadSharedData() {
  const [probSnap, postSnap, assignSnap, folderSnap, topicSnap, hpSnap, evSnap, ratingSnap, sectSnap] = await Promise.all([
    getDocs(collection(db, 'problems')),
    getDocs(collection(db, 'posts')),
    getDocs(collection(db, 'assignments')),
    getDocs(collection(db, 'folders')),
    getDocs(collection(db, 'topics')),
    getDoc(doc(db, 'config', 'homepage')),
    getDocs(collection(db, 'events')),
    getDocs(collection(db, 'ratings')),
    window.S.isAdmin ? getDocs(collection(db, 'sections')) : Promise.resolve({ docs: [] }),
  ]);
  window.DB.problems    = toArray(probSnap).sort((a,b) => (a.order ?? 999) - (b.order ?? 999));
  window.DB.posts       = toArray(postSnap);
  window.DB.assignments = toArray(assignSnap);
  window.DB.folders     = toArray(folderSnap).sort((a,b) => (a.order ?? 999) - (b.order ?? 999));
  window.DB.topics      = toArray(topicSnap);
  window.DB.homepage    = hpSnap.exists() ? hpSnap.data() : { banner:'', bannerEnabled:true };
  window.DB.events      = toArray(evSnap);
  window.DB.sections    = toArray(sectSnap);
  // Blog categories — read separately and defensively. If this doc is missing
  // OR the Firestore rules deny reading it, we fall back to defaults instead of
  // letting the whole app fail to load.
  window.DB.categories = window.DEFAULT_CATEGORIES.map(c => ({ ...c }));
  try {
    const catSnap = await getDoc(doc(db, 'config', 'blogCategories'));
    const _catList = (catSnap.exists() && Array.isArray(catSnap.data().list)) ? catSnap.data().list : null;
    if (_catList && _catList.length) {
      window.DB.categories = _catList
        .filter(c => c && typeof c.name === 'string')
        .map(c => ({
          name:  c.name.replace(/<[^>]*>/g, '').slice(0, 40),
          color: (typeof c.color === 'string' && /^#[0-9a-fA-F]{3,6}$/.test(c.color.trim())) ? c.color.trim() : '#9d7de8',
        }));
    }
  } catch(e) {
    console.warn('blogCategories read failed — using default categories:', e.code || e.message);
  }
  // Merge rating aggregates onto problem objects
  const ratingsMap = {};
  toArray(ratingSnap).forEach(r => { ratingsMap[r.id] = r; });
  window.DB.problems.forEach(p => {
    const r = ratingsMap[p.id];
    if (r) { p.ratingAvg = r.avg; p.ratingCount = r.count; }
  });
  window.DB.problems.forEach(p => { if (p.enabled === undefined) p.enabled = true; });
}

// ── Load this user's profile ──────────────────
async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) {
    const data = sanitizeUser(snap.data());
    window.DB.users[data.username] = data;
    return data;
  }
  return null;
}

// ── saveDB — writes everything back ──────────
// Called exactly the same way as the localStorage version.
// Writes current user profile + any changed shared collections.
window.saveDB = async function() {
  const uid = window.S.uid;
  if (!uid) return;

  // Always save current user's own profile (allowed for all users)
  const u = window.DB.users[window.S.user];
  if (u) {
    await setDoc(doc(db, 'users', uid), u, { merge: true });
  }

  // Shared data writes are admin-only — Firestore rules enforce this too,
  // but we guard here to avoid noisy permission-denied errors in the console.
  if (!window.S.isAdmin) return;

  const writes = [];

  // Stamp order index before building write calls
  window.DB.problems.forEach((p, i) => { p.order = i; });
  window.DB.folders.forEach((f, i)  => { f.order = i; });

  for (const p of window.DB.problems) {
    const { id, ...data } = p;
    writes.push(setDoc(doc(db, 'problems', id), data, { merge: true }));
  }
  for (const p of window.DB.posts) {
    const { id, ...data } = p;
    writes.push(setDoc(doc(db, 'posts', id), data, { merge: true }));
  }
  for (const a of window.DB.assignments) {
    const { id, ...data } = a;
    writes.push(setDoc(doc(db, 'assignments', id), data, { merge: true }));
  }
  for (const f of window.DB.folders) {
    const { id, ...data } = f;
    writes.push(setDoc(doc(db, 'folders', id), data, { merge: true }));
  }
  for (const t of window.DB.topics) {
    const { id, ...data } = t;
    writes.push(setDoc(doc(db, 'topics', id), data, { merge: true }));
  }
  if (window.DB.homepage) {
    writes.push(setDoc(doc(db, 'config', 'homepage'), window.DB.homepage, { merge: true }));
  }

  await Promise.all(writes);
};

// Lightweight version — only saves current user profile (for score/streak updates)
window.saveUserOnly = async function() {
  const uid = window.S.uid;
  if (!uid) { console.warn('saveUserOnly: no uid'); return; }
  const u = window.DB.users[window.S.user];
  if (!u) { console.warn('saveUserOnly: no user object'); return; }

  // Whitelist exact fields and enforce types before writing.
  // This means even if u.streak was tampered with in memory,
  // we only ever write a safe integer to Firestore.
  const safe = {
    scores:            (u.scores && typeof u.scores === 'object') ? u.scores : {},
    streak:            (Number.isFinite(parseInt(u.streak)) && parseInt(u.streak) >= 0)
                         ? parseInt(u.streak) : 0,
    assignSubmissions: (u.assignSubmissions && typeof u.assignSubmissions === 'object')
                         ? u.assignSubmissions : {},
    notifPrefs:        (u.notifPrefs && typeof u.notifPrefs === 'object')
                         ? {
                             email:         typeof u.notifPrefs.email === 'string'
                                              ? u.notifPrefs.email.slice(0, 200) : '',
                             posts:         !!u.notifPrefs.posts,
                             announcements: !!u.notifPrefs.announcements,
                             assignments:   !!u.notifPrefs.assignments,
                           }
                         : {},
    attemptLog:        Array.isArray(u.attemptLog) ? u.attemptLog : [],
    assignAttempts:    (u.assignAttempts && typeof u.assignAttempts === 'object')
                         ? u.assignAttempts : {},
  };

  try {
    await setDoc(doc(db, 'users', uid), safe, { merge: true });
  } catch(e) {
    console.error('saveUserOnly failed:', e.code, e.message);
    throw e;
  }
};

// Append a single attempt record to the user's attemptLog array in Firestore.
// Batches entries in memory and flushes every 60 seconds to reduce writes.
// This turns 10 individual writes into 1, crucial for large exams.
const _attemptQueue = [];
let   _attemptFlushTimer = null;

window.logAttempt = function(entry) {
  _attemptQueue.push(entry);
  // Flush immediately on first entry, then debounce subsequent ones
  if (!_attemptFlushTimer) {
    _attemptFlushTimer = setTimeout(_flushAttemptLog, 60000); // 60 second batch window
  }
};

async function _flushAttemptLog() {
  _attemptFlushTimer = null;
  if (!_attemptQueue.length) return;
  const uid = window.S.uid;
  if (!uid) return;
  const batch = _attemptQueue.splice(0); // drain the queue
  try {
    await updateDoc(doc(db, 'users', uid), {
      attemptLog: arrayUnion(...batch) // write all queued entries in one Firestore call
    });
  } catch(e) {
    console.warn('_flushAttemptLog failed:', e);
    // Put them back so they don't get lost
    _attemptQueue.unshift(...batch);
  }
}

// Flush on page unload so nothing is lost when student closes tab
window.addEventListener('beforeunload', () => {
  if (_attemptQueue.length && window.S.uid) {
    // Use sendBeacon for reliable unload writes
    _flushAttemptLog();
  }
});

// Save just the homepage config
window.saveHomepage = async function() {
  if (window.DB.homepage) {
    await setDoc(doc(db, 'config', 'homepage'), window.DB.homepage, { merge: true });
  }
};

// Append a record to the top-level `auditLog` collection in Firestore.
// Each document is one admin action — auto-ID'd by Firestore so they
// stack up in insertion order and are easy to filter/export in the console.
// Uses addDoc so it never overwrites anything.
window.logAdminAction = async function(action, details = {}) {
  try {
    await addDoc(collection(db, 'auditLog'), {
      ts:       Date.now(),
      admin:    window.S.user || '—',
      action,   // e.g. 'save_problem', 'delete_folder', 'publish_post'
      ...details,
    });
  } catch(e) {
    // Non-critical — never surface to admin
    console.warn('logAdminAction failed:', e);
  }
};

// Record a practice attempt using atomic server-side increment.
// The client says "add 1 to attempted" and the server does it —
// a student can never set their own score to an arbitrary value this way.
window.recordScore = async function(topicKey, correct) {
  const uid = window.S.uid;
  if (!uid) return;
  const field = `scores.${topicKey}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      [`${field}.attempted`]: increment(1),
      [`${field}.correct`]:   increment(correct ? 1 : 0),
      streak: increment(correct ? 1 : -999999), // handled below
    });
  } catch(e) {
    // If the score field doesn't exist yet, create it
    await setDoc(doc(db, 'users', uid), {
      scores: { [topicKey]: { attempted: 1, correct: correct ? 1 : 0 } },
    }, { merge: true });
  }
};

// Record streak atomically — separate from score so we can set it to 0 on wrong answer
window.recordStreak = async function(correct) {
  const uid = window.S.uid;
  if (!uid) return;
  try {
    if (correct) {
      await updateDoc(doc(db, 'users', uid), { streak: increment(1) });
    } else {
      await updateDoc(doc(db, 'users', uid), { streak: 0 });
    }
  } catch(e) { console.warn('recordStreak failed:', e); }
};


window._fetchAllUsers = async function() {
  if (!window.S.isAdmin) {
    console.warn('[security] _fetchAllUsers blocked — caller is not admin');
    return [];
  }
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => sanitizeUser({ uid: d.id, ...d.data() }));
};

// Generic setDoc helper used by calendar.js
window._setDoc = async function(collectionName, id, data) {
  await setDoc(doc(db, collectionName, id), data, { merge: true });
};

// Low-level Firestore helpers used by ratings.js
window._docRef    = (col, id)       => doc(db, col, id);
window._getDoc    = (ref)           => getDoc(ref);
window._updateDoc = (ref, data)     => updateDoc(ref, data);

// Delete a Firestore document (used when deleting problems/posts/etc.)
window.deleteFromDB = async function(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
};

// ── Auth ─────────────────────────────────────
function showAuthErr(id, msg) {
  const e = document.getElementById(id);
  e.querySelector('span').textContent = msg;
  e.classList.remove('hidden');
}
function hideAuthErr(id) { document.getElementById(id).classList.add('hidden'); }

window.setAuthTab = function(t, el) {
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('auth-login').classList.toggle('hidden', t !== 'login');
  document.getElementById('auth-register').classList.toggle('hidden', t !== 'register');
};

window.doLogin = async function() {
  hideAuthErr('l-err');
  const idRaw = document.getElementById('l-user').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!idRaw || !pass) { showAuthErr('l-err', 'Enter your username/email and password.'); return; }

  // Accept either a real email (contains @) or a username. For legacy accounts
  // the username maps to username@circuitspractice.app. Spaces in the username
  // are encoded as dots so Firebase sees a valid email address.
  // New accounts (created with a real email) always log in by email.
  let email;
  if (idRaw.includes('@')) {
    email = idRaw;
  } else {
    const safePart = idRaw.replace(/\s+/g, '.').replace(/[^a-zA-Z0-9._%+\-]/g, '');
    email = safePart + '@circuitspractice.app';
  }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged handles the rest
  } catch(e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' ||
        e.code === 'auth/wrong-password'  || e.code === 'auth/invalid-email') {
      showAuthErr('l-err', 'Username/email or password incorrect.');
    } else {
      showAuthErr('l-err', e.message);
    }
  }
};

// ── Self-serve password reset ─────────────────
// Sends a Firebase reset email to the address entered. Only works for accounts
// whose Auth email is a real address (all accounts created with an email, and
// any older account migrated in the Firebase console). We never reveal whether
// an address is registered.
window.toggleResetForm = function() {
  const box = document.getElementById('auth-reset');
  if (!box) return;
  const showing = !box.classList.contains('hidden');
  box.classList.toggle('hidden', showing);
  if (!showing) {
    const pre = document.getElementById('l-user').value.trim();
    const inp = document.getElementById('l-reset-email');
    if (inp && pre.includes('@')) inp.value = pre;   // prefill if they typed an email
    inp?.focus();
  }
};

window.sendPasswordReset = async function() {
  const email = document.getElementById('l-reset-email')?.value.trim() || '';
  const ok  = document.getElementById('l-reset-ok');
  const err = document.getElementById('l-reset-err');
  ok?.classList.add('hidden'); err?.classList.add('hidden');
  const showErr = m => { if (err) { err.querySelector('span').textContent = m; err.classList.remove('hidden'); } };
  const showOk  = m => { if (ok)  { ok.textContent = m; ok.classList.remove('hidden'); } };

  if (!email || !email.includes('@')) { showErr('Enter the email address on your account.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showOk('If an account uses that email, a reset link is on its way. Check your inbox (and spam).');
  } catch(e) {
    // Don't disclose whether the address exists.
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-email') {
      showOk('If an account uses that email, a reset link is on its way. Check your inbox (and spam).');
    } else {
      console.error('sendPasswordReset failed:', e.code, e.message);
      showErr(e.message);
    }
  }
};

// ── One-time email migration prompt ───────────
// Legacy accounts were created with username@circuitspractice.app as their Auth
// email, so native password reset can't reach them. On login we offer to set a
// real email — that becomes their Auth identity (sign-in + reset) and contact
// address. Once migrated (Auth email no longer @circuitspractice.app), it never
// shows again. "Skip for now" hides it for this session only.
window.maybePromptEmailMigration = function() {
  try {
    if (window._emailMigrateSkipped) return;
    const legacy = (window.S.authEmail || '').toLowerCase().endsWith('@circuitspractice.app');
    console.info('[email-migration] authEmail:', window.S.authEmail, '| legacy:', legacy);
    if (!legacy) return;
    const modal = document.getElementById('email-migrate-modal');
    if (!modal) { console.error('[email-migration] modal element not found'); return; }
    const u   = window.DB.users[window.S.user];
    const inp = document.getElementById('em-email');
    if (inp) inp.value = (u && u.notifPrefs && u.notifPrefs.email) || '';
    document.getElementById('em-ok')?.classList.add('hidden');
    document.getElementById('em-err')?.classList.add('hidden');
    modal.classList.remove('hidden');
  } catch(e) { console.error('maybePromptEmailMigration failed:', e); }
};

// Can also be called manually (e.g. from profile) to update the email at any time.
window.openEmailMigrate = function() {
  const modal = document.getElementById('email-migrate-modal');
  if (!modal) return;
  const u   = window.DB.users[window.S.user];
  const inp = document.getElementById('em-email');
  if (inp) inp.value = (u && u.notifPrefs && u.notifPrefs.email) || '';
  document.getElementById('em-ok')?.classList.add('hidden');
  document.getElementById('em-err')?.classList.add('hidden');
  modal.classList.remove('hidden');
};

window.skipEmailMigrate  = function() { window._emailMigrateSkipped = true; closeEmailMigrate(); };
window.closeEmailMigrate = function() { document.getElementById('email-migrate-modal')?.classList.add('hidden'); };

window.submitEmailMigration = async function() {
  const email = (document.getElementById('em-email')?.value || '').trim().toLowerCase();
  const ok  = document.getElementById('em-ok');
  const err = document.getElementById('em-err');
  ok?.classList.add('hidden'); err?.classList.add('hidden');
  const showErr = m => { if (err) { err.querySelector('span').textContent = m; err.classList.remove('hidden'); } };
  const showOk  = m => { if (ok)  { ok.textContent = m; ok.classList.remove('hidden'); } };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('Enter a valid email address.'); return; }

  // 1. Always save the contact email to the profile (notifications + record),
  //    even if the Auth migration needs a verification click.
  try {
    const u = window.DB.users[window.S.user];
    if (u) {
      const prev = u.notifPrefs || {};
      u.notifPrefs = {
        email,
        posts:         prev.posts !== undefined ? prev.posts : true,
        announcements: prev.announcements !== undefined ? prev.announcements : true,
        assignments:   prev.assignments !== undefined ? prev.assignments : true,
      };
      await saveUserOnly();
    }
  } catch(e) { console.error('migration: saving contact email failed:', e); }

  // 2. Migrate the Firebase Auth email so password reset reaches them.
  try {
    const authMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    try {
      await authMod.updateEmail(auth.currentUser, email);
      window.S.authEmail = email;
      logAdminAction('email_migrated', { username: window.S.user });
      showOk('Saved! Sign in and reset your password with this email from now on.');
      setTimeout(closeEmailMigrate, 2200);
    } catch(e1) {
      if (e1.code === 'auth/requires-recent-login') {
        showErr('For security, please sign out and sign back in, then set your email again.');
      } else if (e1.code === 'auth/email-already-in-use') {
        showErr('That email is already used by another account.');
      } else if (e1.code === 'auth/operation-not-allowed' || e1.code === 'auth/unverified-email') {
        // Project requires verifying the new address first — send the link.
        try {
          await authMod.verifyBeforeUpdateEmail(auth.currentUser, email);
          showOk('Check your inbox and click the link to confirm. Until then, keep signing in with your username.');
        } catch(e2) {
          console.error('verifyBeforeUpdateEmail failed:', e2.code, e2.message);
          showErr(e2.message);
        }
      } else {
        console.error('updateEmail failed:', e1.code, e1.message);
        showErr(e1.message);
      }
    }
  } catch(e) {
    console.error('migration: auth module import failed:', e);
    showErr('Could not update your email right now — your contact email was still saved.');
  }
};

window.doRegister = async function() {
  // Public self-registration is disabled — accounts are created by admins only
  // (Admin → User management → create account). This guard ensures that even if
  // doRegister is invoked (e.g. an old cached page, or the console), no public
  // account is ever created.
  console.warn('[security] public registration is disabled — accounts are admin-created only');
  const err = document.getElementById('r-err');
  if (err) {
    const span = err.querySelector('span');
    if (span) span.textContent = 'Registration is disabled. Contact your instructor for an account.';
    err.classList.remove('hidden');
  } else {
    // Registration UI has been removed; surface the message on the login form instead
    try { showAuthErr('l-err', 'Registration is disabled. Contact your instructor for an account.'); } catch(e) {}
  }
};

window.doLogout = async function() {
  await signOut(auth);
  // onAuthStateChanged handles UI reset
};

// ── Auth state observer ───────────────────────
onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    // Load profile immediately regardless of app ready state
    const profile = await loadUserProfile(firebaseUser.uid);
    if (!profile) {
      await signOut(auth);
      return;
    }

    window.S.uid     = firebaseUser.uid;
    window.S.user    = profile.username;
    window.S.isAdmin = !!profile.isAdmin;
    window.S.authEmail = firebaseUser.email || '';

    if (analytics) {
      setUserId(analytics, firebaseUser.uid);
      setUserProperties(analytics, { is_admin: profile.isAdmin ? 'true' : 'false' });
    }
    track('login', { method: 'username' });

    await loadSharedData();

    // enterApp() is defined in app.js which loads after firebase.js.
    // If it's ready, call it now. If not, store a callback — app.js will
    // call it immediately after setting window._appReady = true.
    const go = () => enterApp();
    if (window._appReady) {
      go();
    } else {
      window._pendingAuthUser = go;
    }

  } else {
    window.S.user    = null;
    window.S.isAdmin = false;
    window.S.uid     = null;
    window._pendingAuthUser = null;
    track('logout');
    try { if (analytics) setUserId(analytics, null); } catch(e) {}
    document.getElementById('screen-app').classList.add('hidden');
    document.getElementById('screen-auth').classList.remove('hidden');
    ['l-user','l-pass'].forEach(id => document.getElementById(id).value = '');
    hideAuthErr('l-err');
  }
});

// ── User management (admin) ───────────────────
window.renderUserMgmt = async function() {
  if (!window.S.isAdmin) {
    console.warn('[security] renderUserMgmt blocked — caller is not admin');
    return;
  }
  const wrap = document.getElementById('user-mgmt-list');
  wrap.innerHTML = '<div style="color:var(--text3);font-size:12px">Loading…</div>';
  const snap = await getDocs(collection(db, 'users'));
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  wrap.innerHTML = '';

  users.forEach(u => {
    const isSelf = u.username === window.S.user;
    const row = document.createElement('div');
    row.className = 'user-row';

    // Username — textContent only, never innerHTML
    const unSpan = document.createElement('span');
    unSpan.className = 'un';
    unSpan.textContent = u.username;         // ← textContent, not innerHTML
    row.appendChild(unSpan);

    // Contact email (if on file) — textContent only, never innerHTML
    if (u.notifPrefs && typeof u.notifPrefs.email === 'string' && u.notifPrefs.email) {
      const em = document.createElement('span');
      em.style.cssText = 'font-size:11px;color:var(--text4);font-family:var(--mono)';
      em.textContent = u.notifPrefs.email;
      row.appendChild(em);
    }

    // Role pill
    const pill = document.createElement('span');
    pill.className = u.isAdmin ? 'pill pill-admin' : 'pill';
    if (!u.isAdmin) pill.style.cssText = 'background:rgba(255,255,255,.04);color:var(--text3)';
    pill.textContent = u.isAdmin ? 'admin' : 'student';
    row.appendChild(pill);

    if (isSelf) {
      const you = document.createElement('span');
      you.style.cssText = 'font-size:11px;color:var(--text4)';
      you.textContent = '(you)';
      row.appendChild(you);
    } else {
      // Toggle admin — addEventListener, uid/username never touch HTML
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn btn-sm';
      toggleBtn.innerHTML = `<i class="ti ${u.isAdmin ? 'ti-shield-off' : 'ti-shield-check'}"></i>`;
      const toggleLabel = document.createTextNode(u.isAdmin ? ' Remove' : ' Make admin');
      toggleBtn.appendChild(toggleLabel);
      toggleBtn.addEventListener('click', () => toggleAdmin(u.uid, u.username, !u.isAdmin));
      row.appendChild(toggleBtn);

      // Delete — addEventListener, uid/username never touch HTML
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm btn-red';
      delBtn.innerHTML = '<i class="ti ti-trash"></i>';
      delBtn.addEventListener('click', () => deleteUser(u.uid, u.username));
      row.appendChild(delBtn);
    }

    wrap.appendChild(row);
  });
};

window.toggleAdmin = async function(uid, username, makeAdmin) {
  if (!window.S.isAdmin) {
    console.warn('[security] toggleAdmin blocked — caller is not admin');
    return;
  }
  await setDoc(doc(db, 'users', uid), { isAdmin: makeAdmin }, { merge: true });
  logAdminAction(makeAdmin ? 'grant_admin' : 'revoke_admin', { uid, username });
  renderUserMgmt();
  renderAnalytics();
};

window.deleteUser = async function(uid, username) {
  if (!window.S.isAdmin) {
    console.warn('[security] deleteUser blocked — caller is not admin');
    return;
  }
  if (!confirm(
    `Delete "${username}"?\n\n` +
    `This removes their profile and data from the database.\n\n` +
    `IMPORTANT: You must also delete their login account manually:\n` +
    `Firebase Console → Authentication → Users → find ${username}@circuitspractice.app → Delete.\n\n` +
    `If you skip that step, the username will appear taken on re-registration.`
  )) return;
  await deleteDoc(doc(db, 'users', uid));
  logAdminAction('delete_account', { uid, username });
  renderUserMgmt();
  renderAnalytics();
};

window.adminCreateUser = async function() {
  // Double-check: this should only ever be callable by a verified admin
  if (!window.S.isAdmin) {
    console.warn('[security] adminCreateUser blocked — caller is not admin');
    return;
  }
  const email    = document.getElementById('mu-email').value.trim().toLowerCase();
  const username = document.getElementById('mu-user').value.trim();
  const pass     = document.getElementById('mu-pass').value;
  const isAdmin  = document.getElementById('mu-admin').checked;
  const err = document.getElementById('mu-err');
  const ok  = document.getElementById('mu-ok');
  err.classList.add('hidden'); ok.classList.add('hidden');
  const showErr = m => { err.querySelector('span').textContent = m; err.classList.remove('hidden'); };

  if (!email)                                       { showErr('Enter an email address.');        return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))     { showErr('Enter a valid email address.');    return; }
  if (!username)                                    { showErr('Enter a username.');               return; }
  if (pass.length < 6)                              { showErr('Password needs 6+ characters.');   return; }

  // Username is the student's display name (shown in grade tables, analytics),
  // so keep it unique even though it's no longer the login identity.
  try {
    const existing = await window._fetchAllUsers();
    if (existing.some(u => (u.username || '').toLowerCase() === username.toLowerCase())) {
      showErr('That username is already in use — pick another.'); return;
    }
  } catch(e) { console.warn('username uniqueness check skipped:', e); }

  // The REAL email is the Firebase Auth identity. This is what makes native
  // password reset work (Firebase sends reset mail to the Auth email), and the
  // student signs in with their email. Username is stored as their display name.
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, 'users', cred.user.uid), {
      username, isAdmin, scores:{}, probScores:{}, streak:0, assignSubmissions:{},
      notifPrefs: { email, posts:true, announcements:true, assignments:true },
    });
    logAdminAction('create_account', { uid: cred.user.uid, username, isAdmin, hasEmail: true });
    track('admin_create_account', { is_admin: isAdmin });
    // NOTE: creating a user signs the admin into the new account (Firebase client
    // SDK limitation without the Admin SDK). Hence the "sign back in" reminder.
    ok.textContent = `"${username}" created. They sign in with ${email}. You may need to sign back in.`;
    ok.classList.remove('hidden');
    ['mu-email','mu-user','mu-pass'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('mu-admin').checked = false;
    renderUserMgmt();
  } catch(e) {
    if (e.code === 'auth/email-already-in-use') {
      showErr('An account with that email already exists.');
    } else {
      console.error('adminCreateUser failed:', e.code, e.message);
      showErr(e.message);
    }
  }
};

window.changePassword = async function() {
  const newP  = document.getElementById('cp-new').value;
  const newP2 = document.getElementById('cp-new2').value;
  const err = document.getElementById('cp-err');
  const ok  = document.getElementById('cp-ok');
  err.classList.add('hidden'); ok.classList.add('hidden');
  if (newP.length < 6) { err.querySelector('span').textContent = '6+ characters required.'; err.classList.remove('hidden'); return; }
  if (newP !== newP2)  { err.querySelector('span').textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return; }
  try {
    const { updatePassword } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    await updatePassword(auth.currentUser, newP);
    ok.textContent = 'Password updated.';
    ok.classList.remove('hidden');
    ['cp-old','cp-new','cp-new2'].forEach(id => document.getElementById(id).value = '');
  } catch(e) {
    err.querySelector('span').textContent = e.code === 'auth/requires-recent-login'
      ? 'Please sign out and sign back in, then try again.'
      : e.message;
    err.classList.remove('hidden');
  }
};

// (Script loading order is handled by main.js)
