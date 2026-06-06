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
    // NOTE: attemptLog is intentionally absent here. It is written exclusively
    // via logAttempt → arrayUnion, which appends atomically. Writing it here
    // would overwrite the Firestore array with a stale in-memory snapshot and
    // erase entries that logAttempt queued but hasn't flushed yet.
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
  // Mirror into the in-memory user so in-session reads (and the next saveUserOnly
  // call, if attemptLog were included) see the latest data. We keep this separate
  // from the Firestore write (arrayUnion) so there's no overwrite conflict.
  const _lUser = window.DB?.users?.[window.S?.user];
  if (_lUser) { if (!Array.isArray(_lUser.attemptLog)) _lUser.attemptLog = []; _lUser.attemptLog.push(entry); }
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
  if (!idRaw || !pass) { showAuthErr('l-err', 'Enter your email and password.'); return; }

  // Determine the Firebase Auth email to sign in with.
  // New accounts: real email is the Auth identity — use it directly.
  // Legacy accounts: Auth identity is username@circuitspractice.app.
  //   - If they type their username (no @): map it directly.
  //   - If they type their real email (@): look it up in Firestore first
  //     so we never make a failed sign-in attempt with the wrong address
  //     (a failed attempt can trigger Firebase rate-limiting).
  let loginEmail;

  if (!idRaw.includes('@')) {
    // Plain username — map to legacy auth address
    const safePart = idRaw.replace(/\s+/g, '.').replace(/[^a-zA-Z0-9._%+\-]/g, '');
    loginEmail = safePart + '@circuitspractice.app';
  } else {
    // Real email typed — check if it belongs to a legacy account first
    const typedEmail = idRaw.toLowerCase();
    try {
      const snap = await getDocs(collection(db, 'users'));
      const match = snap.docs.map(d => d.data())
        .find(u => (u.notifPrefs?.email || '').toLowerCase() === typedEmail);
      if (match && match.username) {
        // Legacy account: sign in with their @circuitspractice.app address
        const safePart = match.username.replace(/\s+/g, '.').replace(/[^a-zA-Z0-9._%+\-]/g, '');
        loginEmail = safePart + '@circuitspractice.app';
      } else {
        // New account: real email is the Auth identity
        loginEmail = typedEmail;
      }
    } catch(e) {
      // Firestore lookup failed — fall back to trying the email directly
      console.warn('doLogin: Firestore lookup failed, trying email directly', e);
      loginEmail = typedEmail;
    }
  }

  try {
    await signInWithEmailAndPassword(auth, loginEmail, pass);
    // onAuthStateChanged handles the rest
  } catch(e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' ||
        e.code === 'auth/wrong-password'  || e.code === 'auth/invalid-email') {
      showAuthErr('l-err', 'Email or password incorrect.');
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
    if (!legacy) return;
    // Also suppress if they already saved a real contact email in a prior session
    const u = window.DB.users[window.S.user];
    const savedEmail = (u && u.notifPrefs && u.notifPrefs.email) || '';
    if (savedEmail && !savedEmail.endsWith('@circuitspractice.app')) return;
    const modal = document.getElementById('email-migrate-modal');
    if (!modal) { console.error('[email-migration] modal element not found'); return; }
    const inp = document.getElementById('em-email');
    if (inp) inp.value = savedEmail;
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

  // Save the real email to the Firestore profile. doLogin will use this to
  // look up legacy accounts by contact email, so the student can sign in
  // with this address even though Firebase Auth still holds the
  // username@circuitspractice.app identity internally.
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
    // Mark as migrated so the modal suppresses on future logins
    window.S.authEmail = email;
    logAdminAction('set_login_email', { username: window.S.user });
    showOk('Done! You can now sign in with ' + email + '.');
    setTimeout(closeEmailMigrate, 2500);
  } catch(e) {
    console.error('submitEmailMigration failed:', e);
    showErr('Could not save — see console for details.');
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

  if (!email)                                   { showErr('Enter an email address.');      return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('Enter a valid email address.'); return; }
  if (!username)                                { showErr('Enter a username.');            return; }
  if (pass.length < 6)                          { showErr('Password needs 6+ characters.');return; }

  // Username is unique (it's the login identity + the display name in analytics)
  try {
    const existing = await window._fetchAllUsers();
    if (existing.some(u => (u.username || '').toLowerCase() === username.toLowerCase())) {
      showErr('That username is already in use — pick another.'); return;
    }
  } catch(e) { console.warn('username uniqueness check skipped:', e); }

  // Username is the login identity (username@circuitspractice.app, spaces -> dots).
  // Email is the contact address for notifications. Password resets are done by
  // the instructor in the Firebase console (set a new password directly).
  const loginEmail = username.replace(/\s+/g, '.').replace(/[^a-zA-Z0-9._%+\-]/g, '') + '@circuitspractice.app';
  try {
    const cred = await createUserWithEmailAndPassword(auth, loginEmail, pass);
    await setDoc(doc(db, 'users', cred.user.uid), {
      username, isAdmin, scores:{}, probScores:{}, streak:0, assignSubmissions:{},
      notifPrefs: { email, posts:true, announcements:true, assignments:true },
    });
    logAdminAction('create_account', { uid: cred.user.uid, username, isAdmin, hasEmail: true });
    track('admin_create_account', { is_admin: isAdmin });
    ok.textContent = `"${username}" created. They sign in with the username "${username}". You may need to sign back in.`;
    ok.classList.remove('hidden');
    ['mu-email','mu-user','mu-pass'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('mu-admin').checked = false;
    renderUserMgmt();
  } catch(e) {
    if (e.code === 'auth/email-already-in-use') {
      showErr('That username is already taken.');
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


// ── Batch account creation ────────────────────
// Parses a CSV with columns: name, email (header row optional).
// Creates one Firebase Auth account per row using the real email as the
// login identity, generates a random password, and writes the Firestore
// profile. Runs sequentially — the Firebase client SDK signs in as each
// newly created user, so we re-authenticate as admin after every account.
// Results (including generated passwords) are shown in the UI so the
// instructor can distribute credentials.

function _batchGenPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#';
  let p = '';
  for (let i = 0; i < 12; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

function _batchParseCSV(raw) {
  // Split into non-empty lines
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], error: 'CSV is empty.' };

  // Detect delimiter: comma or tab
  const delim = lines[0].includes('\t') ? '\t' : ',';

  // Parse each line: strip surrounding quotes from each cell
  const parsed = lines.map(l =>
    l.split(delim).map(c => c.trim().replace(/^["']|["']$/g, '').trim())
  );

  // Skip header row if first row contains no @ sign in either cell
  const firstRow = parsed[0];
  const hasHeader = firstRow.length >= 2 &&
    !firstRow[0].includes('@') && !firstRow[1].includes('@');
  const dataRows = hasHeader ? parsed.slice(1) : parsed;

  if (!dataRows.length) return { rows: [], error: 'No data rows found after header.' };

  // Determine which column is name vs email
  // Try to auto-detect: the column that contains @ is email
  let nameCol = 0, emailCol = 1;
  const sample = dataRows.find(r => r.length >= 2);
  if (sample && sample[0].includes('@') && !sample[1].includes('@')) {
    nameCol = 1; emailCol = 0;
  }

  const rows = [];
  const emailSeen = new Set();
  dataRows.forEach((cols, i) => {
    if (cols.length < 2) return; // skip malformed rows
    const name  = cols[nameCol]  || '';
    const email = (cols[emailCol] || '').toLowerCase();
    if (!name || !email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return; // skip invalid emails
    if (emailSeen.has(email)) return; // deduplicate
    emailSeen.add(email);
    rows.push({ name, email });
  });

  if (!rows.length) return { rows: [], error: 'No valid name/email rows found. Check that columns are name and email.' };
  return { rows, error: null };
}

window.batchPreviewCSV = function batchPreviewCSV() {
  const raw = document.getElementById('batch-csv')?.value || '';
  const preview = document.getElementById('batch-preview');
  if (!preview) return;

  const { rows, error } = _batchParseCSV(raw);
  if (error) {
    preview.innerHTML = `<div style="color:var(--red);font-size:12px;margin-top:8px"><i class="ti ti-alert-circle"></i> ${escHtml(error)}</div>`;
    return;
  }
  preview.innerHTML = `
    <div style="font-size:12px;color:var(--text3);margin-top:10px;margin-bottom:6px">
      <i class="ti ti-check" style="color:var(--green)"></i>
      Found <strong style="color:var(--text)">${rows.length}</strong> student${rows.length !== 1 ? 's' : ''} — review before creating:
    </div>
    <div style="overflow-x:auto;max-height:180px;overflow-y:auto;border:0.5px solid var(--border);border-radius:var(--r2)">
      <table class="dash-table" style="font-size:11px">
        <thead><tr><th>#</th><th>Name</th><th>Email</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `<tr><td style="color:var(--text4)">${i + 1}</td><td>${escHtml(r.name)}</td><td style="font-family:var(--mono)">${escHtml(r.email)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <button class="btn btn-accent" style="margin-top:10px" onclick="batchCreateAccounts()">
      <i class="ti ti-user-plus"></i> Create ${rows.length} account${rows.length !== 1 ? 's' : ''}
    </button>`;
};

window.batchCreateAccounts = async function batchCreateAccounts() {
  if (!window.S.isAdmin) { console.warn('[security] batchCreateAccounts blocked'); return; }

  const raw = document.getElementById('batch-csv')?.value || '';
  const { rows, error } = _batchParseCSV(raw);
  if (error || !rows.length) return;

  // Save admin credentials before we start (creating users signs us out)
  const adminEmail    = window.S.authEmail;
  const adminPassEl   = document.getElementById('batch-admin-pass');
  const adminPass     = adminPassEl?.value || '';
  if (!adminPass) {
    const errEl = document.getElementById('batch-err');
    if (errEl) { errEl.querySelector('span').textContent = 'Enter your admin password so we can re-sign you in after each account is created.'; errEl.classList.remove('hidden'); }
    return;
  }
  document.getElementById('batch-err')?.classList.add('hidden');

  const log     = document.getElementById('batch-log');
  const results = document.getElementById('batch-results');
  if (log)     { log.innerHTML = ''; log.style.display = 'block'; }
  if (results) results.innerHTML = '';

  // Disable the create button to prevent double-clicks
  const btn = document.querySelector('[onclick="batchCreateAccounts()"]');
  if (btn) btn.setAttribute('disabled', '');

  const created = [];
  const skipped = [];
  const failed  = [];

  function addLog(msg, color = 'var(--text3)') {
    if (!log) return;
    const line = document.createElement('div');
    line.style.cssText = `font-size:11px;font-family:var(--mono);color:${color};margin-bottom:2px`;
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  addLog(`Starting batch creation for ${rows.length} students…`);

  // Fetch existing users once for duplicate checking
  let existingEmails = new Set();
  try {
    const existing = await window._fetchAllUsers();
    existing.forEach(u => {
      if (u.notifPrefs?.email) existingEmails.add(u.notifPrefs.email.toLowerCase());
    });
  } catch(e) { addLog('Warning: could not check for existing accounts — duplicates may occur.', 'var(--warn)'); }

  for (let i = 0; i < rows.length; i++) {
    const { name, email } = rows[i];
    addLog(`[${i + 1}/${rows.length}] ${name} (${email})…`);

    if (existingEmails.has(email)) {
      addLog(`  → Skipped — account with this email already exists.`, 'var(--warn)');
      skipped.push({ name, email, reason: 'Email already in use' });
      continue;
    }

    const pass = _batchGenPassword();
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await setDoc(doc(db, 'users', cred.user.uid), {
        username: name,
        isAdmin:  false,
        scores: {}, probScores: {}, streak: 0, assignSubmissions: {},
        notifPrefs: { email, posts: true, announcements: true, assignments: true },
      });
      logAdminAction('batch_create_account', { uid: cred.user.uid, username: name, email });
      created.push({ name, email, pass });
      existingEmails.add(email);
      addLog(`  → Created.`, 'var(--green)');
    } catch(e) {
      const reason = e.code === 'auth/email-already-in-use'
        ? 'Email already in use'
        : (e.message || String(e));
      addLog(`  → Failed: ${reason}`, 'var(--red)');
      failed.push({ name, email, reason });
    }

    // Re-authenticate as admin after each creation
    // (Firebase client SDK signs in as the newly created user)
    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPass);
    } catch(e) {
      addLog(`FATAL: Could not re-authenticate as admin — stopping. (${e.message})`, 'var(--red)');
      break;
    }
  }

  addLog(`Done. ${created.length} created, ${skipped.length} skipped, ${failed.length} failed.`,
    failed.length ? 'var(--warn)' : 'var(--green)');

  // ── Results table ──
  if (!results) return;
  let html = '';

  if (created.length) {
    html += `
      <div style="margin-top:14px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">
          <i class="ti ti-check" style="color:var(--green)"></i> Created (${created.length}) — save these passwords now
        </div>
        <div style="overflow-x:auto;border:0.5px solid var(--border);border-radius:var(--r2)">
          <table class="dash-table" style="font-size:11px">
            <thead><tr><th>Name</th><th>Email</th><th>Temp password</th></tr></thead>
            <tbody>
              ${created.map(r => `<tr>
                <td>${escHtml(r.name)}</td>
                <td style="font-family:var(--mono)">${escHtml(r.email)}</td>
                <td style="font-family:var(--mono);color:var(--accent2)">${escHtml(r.pass)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <button class="btn btn-sm" style="margin-top:8px" onclick="batchExportCSV()">
          <i class="ti ti-table-export"></i> Download credentials CSV
        </button>
      </div>`;
  }

  if (skipped.length) {
    html += `
      <div style="margin-top:12px;font-size:11px;color:var(--warn)">
        <i class="ti ti-alert-triangle"></i> Skipped (${skipped.length}):
        ${skipped.map(r => `${escHtml(r.name)} (${escHtml(r.email)})`).join(', ')}
      </div>`;
  }

  if (failed.length) {
    html += `
      <div style="margin-top:8px;font-size:11px;color:var(--red)">
        <i class="ti ti-x"></i> Failed (${failed.length}):
        ${failed.map(r => `${escHtml(r.name)}: ${escHtml(r.reason)}`).join(', ')}
      </div>`;
  }

  results.innerHTML = html;
  window._batchCreated = created; // store for CSV export
  renderUserMgmt();
};

window.batchExportCSV = function batchExportCSV() {
  const rows = window._batchCreated;
  if (!rows || !rows.length) return;
  const lines = ['Name,Email,Temporary Password',
    ...rows.map(r => [r.name, r.email, r.pass].map(v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(','))
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `circuitspractice_credentials_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// (Script loading order is handled by main.js)
