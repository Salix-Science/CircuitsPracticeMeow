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
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  deleteDoc,
  arrayUnion,
  addDoc,
  increment,
  query,
  orderBy,
  limit,
  startAfter
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

// Expose the Firebase app instance so assignments.js can call getFunctions()
// without re-initializing (avoids "Firebase: App named '[DEFAULT]' already exists" error).
window._firebaseApp = app;
// Expose db + Firestore query helpers for adminlog.js
window._getFirestoreDb = () => db;
window._firestoreQuery = { query, collection, orderBy, limit, startAfter, getDocs };

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

  // probRatings — { probId: 1-5 } — written by ratings.js via saveUserOnly
  safe.probRatings = {};
  if (data.probRatings && typeof data.probRatings === 'object') {
    for (const [k, v] of Object.entries(data.probRatings)) {
      if (typeof k !== 'string' || k.length > 100) continue;
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5) {
        safe.probRatings[k] = n;
      }
    }
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
  { name:'Tutorial',     color:'#4fa3e0' },
  { name:'Update',       color:'#9d7de8' },
  { name:'Announcement', color:'#e07c4f' },
  { name:'Resource',     color:'#4fba7c' },
];

window.hexToRgb = function(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)}` : '157,125,232';
};

window.categoryPill = function(cat, categories) {
  const list = categories || window.DB.categories || window.DEFAULT_CATEGORIES;
  const match = list.find(c => c.name === cat);
  const color = match?.color || null;
  const style = color
    ? `background:rgba(${window.hexToRgb(color)},.12);color:${color};border:0.5px solid rgba(${window.hexToRgb(color)},.30)`
    : 'background:rgba(157,125,232,.08);color:var(--text3);border:0.5px solid var(--border)';
  return `<span class="pill" style="${style}">${window.escHtml(cat)}</span>`;
};

// Alias for backwards compatibility with any references to the old name
window.catPill = window.categoryPill;

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
// FIX: Each collection is fetched individually so a permission error on one
// (e.g. draft posts blocked by rules, or sections if not yet admin) cannot
// crash the entire Promise.all and silently abort the login flow.
async function safeGetDocs(col) {
  try {
    return await getDocs(collection(db, col));
  } catch(e) {
    console.warn(`[loadSharedData] ${col} read failed (${e.code || e.message}) — using empty fallback`);
    return { docs: [] };
  }
}

async function safeGetDoc(ref) {
  try {
    return await getDoc(ref);
  } catch(e) {
    console.warn(`[loadSharedData] doc read failed (${e.code || e.message}) — using empty fallback`);
    return { exists: () => false };
  }
}

async function loadSharedData() {
  console.log('[loadSharedData] starting — isAdmin:', window.S.isAdmin);

  const [probSnap, postSnap, assignSnap, folderSnap, topicSnap, hpSnap, evSnap, ratingSnap, sectSnap] = await Promise.all([
    safeGetDocs('problems'),
    safeGetDocs('posts'),
    safeGetDocs('assignments'),
    safeGetDocs('folders'),
    safeGetDocs('topics'),
    safeGetDoc(doc(db, 'config', 'homepage')),
    safeGetDocs('events'),
    safeGetDocs('ratings'),
    window.S.isAdmin ? safeGetDocs('sections') : Promise.resolve({ docs: [] }),
  ]);

  window.DB.problems    = toArray(probSnap).sort((a,b) => (a.order ?? 999) - (b.order ?? 999));
  window.DB.posts       = toArray(postSnap);
  window.DB.assignments = toArray(assignSnap);
  window.DB.folders     = toArray(folderSnap).sort((a,b) => (a.order ?? 999) - (b.order ?? 999));
  window.DB.topics      = toArray(topicSnap);
  window.DB.homepage    = hpSnap.exists() ? hpSnap.data() : { banner:'', bannerEnabled:true };
  window.DB.events      = toArray(evSnap);
  window.DB.sections    = toArray(sectSnap);

  console.log('[loadSharedData] loaded — problems:', window.DB.problems.length,
              '| assignments:', window.DB.assignments.length,
              '| posts:', window.DB.posts.length,
              '| sections:', window.DB.sections.length);

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
  console.log('[loadUserProfile] fetching uid:', uid);
  let snap;
  try {
    snap = await getDoc(doc(db, 'users', uid));
  } catch(e) {
    console.error('[loadUserProfile] Firestore read FAILED:', e.code, e.message,
                  '— check Firestore rules for users collection');
    return null;
  }
  if (!snap.exists()) {
    console.warn('[loadUserProfile] no document found for uid:', uid,
                 '— profile may not have been created yet');
    return null;
  }
  const raw  = snap.data();
  console.log('[loadUserProfile] raw from Firestore — username:', raw.username,
              '| isAdmin:', raw.isAdmin,
              '| assignAttempts keys:', Object.keys(raw.assignAttempts || {}).length,
              '| assignSubmissions keys:', Object.keys(raw.assignSubmissions || {}).length);
  const data = sanitizeUser(raw);
  console.log('[loadUserProfile] after sanitizeUser — isAdmin:', data.isAdmin,
              '| assignAttempts keys:', Object.keys(data.assignAttempts || {}).length);
  window.DB.users[data.username] = data;
  return data;
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
  // IMPORTANT — assignAttempts is deliberately EXCLUDED from this payload.
  // The Cloud Function owns assignAttempts via atomic FieldValue.increment().
  // Writing the whole map here via setDoc({ merge:true }) replaces the entire
  // Firestore map field, stomping any increments the CF wrote between the last
  // page load and now. Instead we write assignAttempts keys individually via
  // updateDoc with dot-notation paths (see below), which is truly non-destructive.
  //
  // attemptLog is also excluded — it is written exclusively via logAttempt →
  // arrayUnion, which appends atomically.
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
    // probRatings — student difficulty ratings, written by ratings.js
    probRatings:       (u.probRatings && typeof u.probRatings === 'object')
                         ? u.probRatings : {},
  };

  try {
    await setDoc(doc(db, 'users', uid), safe, { merge: true });
  } catch(e) {
    console.error('saveUserOnly failed:', e.code, e.message);
    throw e;
  }

  // Write assignAttempts using dot-notation updateDoc so each key is written
  // independently. This is safe to do alongside the CF's increment() because
  // we only ever write keys the client already knows about — and we always
  // take the max so we can never reduce a count the CF has already advanced.
  if (u.assignAttempts && typeof u.assignAttempts === 'object') {
    const keys = Object.keys(u.assignAttempts);
    if (keys.length > 0) {
      const dotUpdates = {};
      for (const [k, v] of Object.entries(u.assignAttempts)) {
        if (typeof k !== 'string' || k.length > 200) continue;
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0 && n <= 9999) {
          dotUpdates[`assignAttempts.${k}`] = n;
        }
      }
      if (Object.keys(dotUpdates).length > 0) {
        try {
          await updateDoc(doc(db, 'users', uid), dotUpdates);
        } catch(e) {
          console.warn('saveUserOnly: assignAttempts dot-update failed:', e.code, e.message);
        }
      }
    }
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
window.logAdminAction = async function(action, details = {}) {
  try {
    await addDoc(collection(db, 'adminLog'), {
      ts:       Date.now(),
      admin:    window.S.user || '—',
      action,
      ...details,
    });
  } catch(e) {
    console.warn('logAdminAction failed:', e);
  }
};

// Write a document to the `mail` collection so the Firebase "Trigger Email"
// extension picks it up and sends it via your SMTP credentials.
// Plain scripts (notifications.js) call this since they can't import addDoc.
//
// Generates a per-recipient unsubscribe token (base64url of their email),
// adds List-Unsubscribe headers for Microsoft Defender / Gmail scoring,
// and includes both plain-text and HTML parts for best deliverability.
window._addMailDoc = async function(to, subject, bodyText) {
  // Token = base64url(email) — verified and acted on by the unsubscribe Cloud Function.
  const token      = btoa(to).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const unsubUrl   = `https://us-central1-circuitspractice-b4cb0.cloudfunctions.net/unsubscribe?token=${token}`;
  const profileUrl = 'https://circuitspractice.org/?tab=profile';

  // Plain-text part — required alongside HTML to avoid spam flags.
  const text = `${bodyText}\n\n---\nCircuits Practice · circuitspractice.org\nManage notifications: ${profileUrl}\nUnsubscribe from all emails: ${unsubUrl}`;

  // HTML part — branded, with safe-escaped body text.
  const safeBody = bodyText
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f0f1a;font-family:sans-serif">
<div style="max-width:580px;margin:32px auto;background:#1a1a2e;border:1px solid #2a2a4a;border-radius:8px;overflow:hidden">
  <div style="padding:20px 28px;border-bottom:1px solid #2a2a4a;background:#12122a">
    <span style="font-size:13px;font-weight:700;letter-spacing:.1em;color:#9d7de8">CIRCUITS PRACTICE</span>
  </div>
  <div style="padding:24px 28px;font-size:14px;line-height:1.8;color:#c8c8d8">${safeBody}</div>
  <div style="padding:16px 28px;border-top:1px solid #2a2a4a;font-size:11px;color:#555577;line-height:1.7">
    You're receiving this because you subscribed to notifications on
    <a href="https://circuitspractice.org" style="color:#9d7de8;text-decoration:none">circuitspractice.org</a>.<br>
    <a href="${profileUrl}" style="color:#9d7de8;text-decoration:none">Manage notification preferences</a> ·
    <a href="${unsubUrl}" style="color:#9d7de8;text-decoration:none">Unsubscribe from all emails</a>
  </div>
</div>
</body></html>`;

  try {
    await addDoc(collection(db, 'mail'), {
      to,
      message: {
        subject,
        text,
        html,
        headers: {
          'List-Unsubscribe':      `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      },
    });
    return { ok: true };
  } catch(e) {
    console.error('[mail] _addMailDoc failed:', e);
    return { ok: false, error: e.message };
  }
};

// Record a practice attempt using atomic server-side increment.
window.recordScore = async function(topicKey, correct) {
  const uid = window.S.uid;
  if (!uid) return;
  const field = `scores.${topicKey}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      [`${field}.attempted`]: increment(1),
      [`${field}.correct`]:   increment(correct ? 1 : 0),
      streak: increment(correct ? 1 : -999999),
    });
  } catch(e) {
    await setDoc(doc(db, 'users', uid), {
      scores: { [topicKey]: { attempted: 1, correct: correct ? 1 : 0 } },
    }, { merge: true });
  }
};

// Record streak atomically
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

// Delete a Firestore document
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

  let loginEmail;

  if (!idRaw.includes('@')) {
    const safePart = idRaw.replace(/\s+/g, '.').replace(/[^a-zA-Z0-9._%+\-]/g, '');
    loginEmail = safePart + '@circuitspractice.app';
  } else {
    const typedEmail = idRaw.toLowerCase();
    const cached = localStorage.getItem('cp_legacy_' + typedEmail);
    if (cached) {
      loginEmail = cached;
    } else {
      loginEmail = typedEmail;
    }
  }

  try {
    await signInWithEmailAndPassword(auth, loginEmail, pass);
    // onAuthStateChanged handles the rest
  } catch(e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' ||
        e.code === 'auth/wrong-password'  || e.code === 'auth/invalid-email') {
      if (idRaw.includes('@')) {
        localStorage.removeItem('cp_legacy_' + idRaw.toLowerCase());
      }
      showAuthErr('l-err', 'Email or password incorrect.');
    } else {
      showAuthErr('l-err', e.message);
    }
  }
};

// ── Self-serve password reset ─────────────────
window.toggleResetForm = function() {
  const box = document.getElementById('auth-reset');
  if (!box) return;
  const showing = !box.classList.contains('hidden');
  box.classList.toggle('hidden', showing);
  if (!showing) {
    const pre = document.getElementById('l-user').value.trim();
    const inp = document.getElementById('l-reset-email');
    if (inp && pre.includes('@')) inp.value = pre;
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
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-email') {
      showOk('If an account uses that email, a reset link is on its way. Check your inbox (and spam).');
    } else {
      console.error('sendPasswordReset failed:', e.code, e.message);
      showErr(e.message);
    }
  }
};

// ── One-time email migration prompt ───────────
window.maybePromptEmailMigration = function() {
  try {
    if (window._emailMigrateSkipped) return;
    const legacy = (window.S.authEmail || '').toLowerCase().endsWith('@circuitspractice.app');
    if (!legacy) return;
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
    const _safePart = (window.S.user || '').replace(/\s+/g, '.').replace(/[^a-zA-Z0-9._%+\-]/g, '');
    localStorage.setItem('cp_legacy_' + email, _safePart + '@circuitspractice.app');
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
  console.warn('[security] public registration is disabled — accounts are admin-created only');
  const err = document.getElementById('r-err');
  if (err) {
    const span = err.querySelector('span');
    if (span) span.textContent = 'Registration is disabled. Contact your instructor for an account.';
    err.classList.remove('hidden');
  } else {
    try { showAuthErr('l-err', 'Registration is disabled. Contact your instructor for an account.'); } catch(e) {}
  }
};

window.doLogout = async function() {
  await signOut(auth);
  // onAuthStateChanged handles UI reset
};

// ── Auth state observer ───────────────────────
window._suppressAuthObserver = false;

onAuthStateChanged(auth, async (firebaseUser) => {
  if (window._suppressAuthObserver) return;
  if (firebaseUser) {
    console.log('[authObserver] user signed in — uid:', firebaseUser.uid, '| email:', firebaseUser.email);

    // Load profile immediately regardless of app ready state
    const profile = await loadUserProfile(firebaseUser.uid);
    if (!profile) {
      console.error('[authObserver] loadUserProfile returned null — signing out');
      await signOut(auth);
      return;
    }

    window.S.uid     = firebaseUser.uid;
    window.S.user    = profile.username;
    window.S.isAdmin = !!profile.isAdmin;
    window.S.authEmail = firebaseUser.email || '';

    console.log('[authObserver] window.S set — user:', window.S.user,
                '| isAdmin:', window.S.isAdmin,
                '| uid:', window.S.uid);

    // Cache email → Firebase Auth address mapping for future logins.
    const _contactEmail = profile.notifPrefs?.email || '';
    if (_contactEmail && _contactEmail !== firebaseUser.email) {
      localStorage.setItem('cp_legacy_' + _contactEmail.toLowerCase(), firebaseUser.email);
    }

    if (analytics) {
      try {
        setUserId(analytics, firebaseUser.uid);
        setUserProperties(analytics, { is_admin: profile.isAdmin ? 'true' : 'false' });
      } catch(e) {}
    }
    track('login', { method: 'username' });

    console.log('[authObserver] calling loadSharedData…');
    await loadSharedData();
    console.log('[authObserver] loadSharedData complete — calling enterApp…');

    // enterApp() is defined in app.js which loads after firebase.js.
    const go = () => enterApp();
    if (window._appReady) {
      go();
    } else {
      window._pendingAuthUser = go;
    }

  } else {
    console.log('[authObserver] user signed out');
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
  const users = snap.docs.map(d => sanitizeUser({ uid: d.id, ...d.data() }));
  wrap.innerHTML = '';

  users.forEach(u => {
    const isSelf = u.username === window.S.user;
    const row = document.createElement('div');
    row.className = 'user-row';

    const unSpan = document.createElement('span');
    unSpan.className = 'un';
    unSpan.textContent = u.username;
    row.appendChild(unSpan);

    if (u.notifPrefs && typeof u.notifPrefs.email === 'string' && u.notifPrefs.email) {
      const em = document.createElement('span');
      em.style.cssText = 'font-size:11px;color:var(--text4);font-family:var(--mono)';
      em.textContent = u.notifPrefs.email;
      row.appendChild(em);
    }

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
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn btn-sm';
      toggleBtn.innerHTML = `<i class="ti ${u.isAdmin ? 'ti-shield-off' : 'ti-shield-check'}"></i>`;
      const toggleLabel = document.createTextNode(u.isAdmin ? ' Remove' : ' Make admin');
      toggleBtn.appendChild(toggleLabel);
      toggleBtn.addEventListener('click', () => toggleAdmin(u.uid, u.username, !u.isAdmin));
      row.appendChild(toggleBtn);

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
  logAdminAction(makeAdmin ? 'grant_admin' : 'revoke_admin', { targetUid: uid, targetUsername: username }).catch(() => {});
  renderUserMgmt();
};

window.deleteUser = async function(uid, username) {
  if (!window.S.isAdmin) {
    console.warn('[security] deleteUser blocked — caller is not admin');
    return;
  }
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  await deleteDoc(doc(db, 'users', uid));
  logAdminAction('delete_user', { targetUid: uid, targetUsername: username }).catch(() => {});
  renderUserMgmt();
};

// ── Admin: create account ─────────────────────
window.adminCreateUser = async function() {
  const username  = document.getElementById('mu-user').value.trim();
  const email     = document.getElementById('mu-email')?.value.trim() || '';
  const pass      = document.getElementById('mu-pass').value;
  const isAdmin   = document.getElementById('mu-admin').checked;
  const err       = document.getElementById('mu-err');
  const ok        = document.getElementById('mu-ok');
  const showErr   = msg => { err.querySelector('span').textContent = msg; err.classList.remove('hidden'); };

  err.classList.add('hidden'); ok.classList.add('hidden');

  if (!username) { showErr('Enter a username.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('Enter a valid email address.'); return; }
  if (pass.length < 6) { showErr('Password must be at least 6 characters.'); return; }

  const adminEmail = auth.currentUser?.email;
  const adminPass  = document.getElementById('mu-adminpass')?.value || '';
  if (!adminPass) { showErr('Re-enter your admin password to confirm account creation.'); return; }

  // Check username uniqueness
  try {
    const existingSnap = await getDocs(collection(db, 'users'));
    const taken = existingSnap.docs.some(d => d.data().username === username);
    if (taken) { showErr('A user with that username already exists.'); return; }
  } catch(e) { console.warn('username uniqueness check skipped:', e); }

  window._suppressAuthObserver = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, 'users', cred.user.uid), {
      username, isAdmin, scores:{}, probScores:{}, streak:0, assignSubmissions:{},
      notifPrefs: { email, posts:true, announcements:true, assignments:true },
    });
    const createdUid = cred.user.uid;
    await signInWithEmailAndPassword(auth, adminEmail, adminPass);
    window._suppressAuthObserver = false;
    logAdminAction('create_account', { uid: createdUid, username, isAdmin, hasEmail: true }).catch(() => {});
    ok.textContent = `"${username}" created. Email: ${email} — Password: ${pass}`;
    ok.classList.remove('hidden');
    ['mu-email','mu-user','mu-pass'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('mu-admin').checked = false;
    renderUserMgmt();
  } catch(e) {
    window._suppressAuthObserver = false;
    if (e.code === 'auth/email-already-in-use') {
      showErr('An account with that email already exists.');
    } else if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
      showErr('Account created but could not re-sign you in — admin password was wrong. Please sign in again.');
      await signOut(auth);
    } else {
      console.error('adminCreateUser failed:', e.code, e.message);
      showErr(e.message);
      await signOut(auth);
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

// ── Batch create accounts ─────────────────────
function _batchGenPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({length:10}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

window.batchCreateUsers = async function() {
  const raw = document.getElementById('batch-csv')?.value || '';
  const log = document.getElementById('batch-log');
  if (!log) return;
  const addLog = (msg, color='var(--text)') => {
    const line = document.createElement('div');
    line.style.color = color;
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  };
  log.innerHTML = '';

  const rows = raw.split('\n')
    .map(r => r.trim())
    .filter(Boolean)
    .map(r => {
      const [name, email] = r.split(',').map(s => s.trim());
      return { name, email };
    })
    .filter(r => r.name && r.email && r.email.includes('@'));

  if (!rows.length) { addLog('No valid rows found. Format: Full Name, email@example.com', 'var(--red)'); return; }

  const adminEmail = auth.currentUser?.email;
  const adminPass  = document.getElementById('batch-adminpass')?.value || '';
  if (!adminPass) { addLog('Enter your admin password first.', 'var(--red)'); return; }

  addLog(`Starting batch creation of ${rows.length} account(s)…`, 'var(--text3)');

  const created = [], skipped = [], failed = [];
  const existingSnap = await getDocs(collection(db, 'users'));
  const existingEmails = new Set(existingSnap.docs.map(d => d.data().notifPrefs?.email).filter(Boolean));

  window._suppressAuthObserver = true;
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

    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPass);
    } catch(e) {
      addLog(`FATAL: Could not re-authenticate as admin — stopping. (${e.message})`, 'var(--red)');
      break;
    }
  }
  window._suppressAuthObserver = false;

  addLog(`Done. ${created.length} created, ${skipped.length} skipped, ${failed.length} failed.`,
    failed.length ? 'var(--warn)' : 'var(--green)');

  if (created.length) {
    const csv = ['Name,Email,Temp Password', ...created.map(r => `${r.name},${r.email},${r.pass}`)].join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'new_accounts.csv';
    a.click();
  }
};
