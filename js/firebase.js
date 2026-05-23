/* firebase.js — Firebase initialisation + DB layer
   All other JS files call saveDB() / loadDB() / window.S / window.DB
   exactly as before — this file is the only thing that changes. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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

  // attemptLog — array, keep structure but sanitize string fields
  safe.attemptLog = [];
  if (Array.isArray(data.attemptLog)) {
    safe.attemptLog = data.attemptLog.slice(-500).map(e => ({
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

  // assignAttempts — object of { varKey: count }
  safe.assignAttempts = {};
  if (data.assignAttempts && typeof data.assignAttempts === 'object') {
    for (const [k, v] of Object.entries(data.assignAttempts)) {
      if (typeof k !== 'string' || k.length > 200) continue;
      const n = parseInt(v);
      if (Number.isFinite(n) && n >= 0) safe.assignAttempts[k] = n;
    }
    console.log('[firebase] loaded assignAttempts:', Object.keys(safe.assignAttempts).length, 'entries');
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


function track(eventName, params = {}) {
  if (!analytics) return;
  try { logEvent(analytics, eventName, params); } catch(e) {}
}
// Expose globally so other modules (practice.js, assignments.js) can call it
window.track = track;

// ── In-memory DB mirror ───────────────────────
window.DB = { users:{}, problems:[], folders:[], assignments:[], posts:[], topics:[], homepage:{}, events:[], sections:[] };
window.S  = {
  user:null, isAdmin:false, uid:null,
  activeFolderId:null, activeBuiltin:null, currentBuiltinProb:null,
  folderProblems:[], folderIdx:0,
  editingId:null, editorVars:[], editorImg:null, formEnabled:true,
  editingAssignId:null, editingPostId:null, blogFilter:'All'
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
  const username = document.getElementById('l-user').value.trim();
  const pass     = document.getElementById('l-pass').value;
  if (!username || !pass) { showAuthErr('l-err', 'Enter username and password.'); return; }

  // We store users as username@circuitspractice.app internally
  const email = username + '@circuitspractice.app';
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged handles the rest
  } catch(e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
      showAuthErr('l-err', 'Username or password incorrect.');
    } else {
      showAuthErr('l-err', e.message);
    }
  }
};

window.doRegister = async function() {
  hideAuthErr('r-err');
  document.getElementById('r-ok').classList.add('hidden');
  const username = document.getElementById('r-user').value.trim();
  const pass     = document.getElementById('r-pass').value;
  const pass2    = document.getElementById('r-pass2').value;
  if (!username || username.length < 3) { showAuthErr('r-err', 'At least 3 characters.'); return; }
  if (pass.length < 6)                   { showAuthErr('r-err', 'Password needs 6+ characters.'); return; }
  if (pass !== pass2)                    { showAuthErr('r-err', 'Passwords do not match.'); return; }

  const email = username + '@circuitspractice.app';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    // Write user profile to Firestore
    await setDoc(doc(db, 'users', cred.user.uid), {
      username,
      isAdmin: false,
      scores: {},
      probScores: {},
      streak: 0,
      assignSubmissions: {},
    });
    track('sign_up', { method: 'username' });
    const ok = document.getElementById('r-ok');
    ok.textContent = 'Account created! You can now sign in.';
    ok.classList.remove('hidden');
    ['r-user','r-pass','r-pass2'].forEach(id => document.getElementById(id).value = '');
    await signOut(auth); // sign out so user signs in fresh
  } catch(e) {
    if (e.code === 'auth/email-already-in-use') {
      showAuthErr('r-err', 'Username already taken.');
    } else {
      showAuthErr('r-err', e.message);
    }
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
  const username = document.getElementById('mu-user').value.trim();
  const pass     = document.getElementById('mu-pass').value;
  const isAdmin  = document.getElementById('mu-admin').checked;
  const err = document.getElementById('mu-err');
  const ok  = document.getElementById('mu-ok');
  err.classList.add('hidden'); ok.classList.add('hidden');
  if (!username)     { err.querySelector('span').textContent = 'Enter a username.';        err.classList.remove('hidden'); return; }
  if (pass.length<6) { err.querySelector('span').textContent = '6+ characters required.';  err.classList.remove('hidden'); return; }
  const email = username + '@circuitspractice.app';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, 'users', cred.user.uid), {
      username, isAdmin, scores:{}, probScores:{}, streak:0, assignSubmissions:{}
    });
    logAdminAction('create_account', { uid: cred.user.uid, username, isAdmin });
    track('admin_create_account', { is_admin: isAdmin });
    // Sign back in as admin (creating a user signs you out of your session in Firebase)
    // We avoid this by using Admin SDK in real apps, but for simplicity just warn:
    ok.textContent = `"${username}" created. Note: you may need to sign back in.`;
    ok.classList.remove('hidden');
    document.getElementById('mu-user').value = '';
    document.getElementById('mu-pass').value = '';
    document.getElementById('mu-admin').checked = false;
    renderUserMgmt();
  } catch(e) {
    if (e.code === 'auth/email-already-in-use') {
      err.querySelector('span').textContent = 'Username already exists.';
    } else {
      err.querySelector('span').textContent = e.message;
    }
    err.classList.remove('hidden');
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
