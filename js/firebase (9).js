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
  collection, getDocs, deleteDoc, arrayUnion, addDoc
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

// ── Analytics helpers ─────────────────────────
function track(eventName, params = {}) {
  if (!analytics) return;
  try { logEvent(analytics, eventName, params); } catch(e) {}
}
// Expose globally so other modules (practice.js, assignments.js) can call it
window.track = track;

// ── In-memory DB mirror ───────────────────────
window.DB = { users:{}, problems:[], folders:[], assignments:[], posts:[], topics:[], homepage:{} };
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
  const [probSnap, postSnap, assignSnap, folderSnap, topicSnap, hpSnap] = await Promise.all([
    getDocs(collection(db, 'problems')),
    getDocs(collection(db, 'posts')),
    getDocs(collection(db, 'assignments')),
    getDocs(collection(db, 'folders')),
    getDocs(collection(db, 'topics')),
    getDoc(doc(db, 'config', 'homepage')),
  ]);
  window.DB.problems    = toArray(probSnap);
  window.DB.posts       = toArray(postSnap);
  window.DB.assignments = toArray(assignSnap);
  window.DB.folders     = toArray(folderSnap).sort((a,b) => (a.order ?? 999) - (b.order ?? 999));
  window.DB.topics      = toArray(topicSnap);
  window.DB.homepage    = hpSnap.exists() ? hpSnap.data() : { banner:'', bannerEnabled:true };
  window.DB.problems.forEach(p => { if (p.enabled === undefined) p.enabled = true; });
}

// ── Load this user's profile ──────────────────
async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) {
    const data = snap.data();
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
  window.DB.folders.forEach((f, i) => { f.order = i; });
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
  if (!uid) return;
  const u = window.DB.users[window.S.user];
  if (u) await setDoc(doc(db, 'users', uid), u, { merge: true });
};

// Append a single attempt record to the user's attemptLog array in Firestore.
// Uses arrayUnion so it's a non-destructive append — never overwrites other fields.
// Called on every answer submission (correct OR wrong) so you get the full history.
window.logAttempt = async function(entry) {
  const uid = window.S.uid;
  if (!uid) return;
  try {
    await updateDoc(doc(db, 'users', uid), {
      attemptLog: arrayUnion(entry)
    });
  } catch(e) {
    // Non-critical — don't surface to student
    console.warn('logAttempt failed:', e);
  }
};

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
import { addDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// Fetch all user docs fresh from Firestore (used by grade table — admin only)
window._fetchAllUsers = async function() {
  if (!window.S.isAdmin) {
    console.warn('[security] _fetchAllUsers blocked — caller is not admin');
    return [];
  }
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
};

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
    // Show loading state
    document.getElementById('screen-auth').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');
    document.getElementById('topbar-name').textContent = 'Loading…';

    // Load user profile
    const profile = await loadUserProfile(firebaseUser.uid);
    if (!profile) {
      await signOut(auth);
      document.getElementById('screen-auth').classList.remove('hidden');
      document.getElementById('screen-app').classList.add('hidden');
      return;
    }

    window.S.uid     = firebaseUser.uid;
    window.S.user    = profile.username;
    window.S.isAdmin = !!profile.isAdmin;

    // ── Analytics: identify user and log login ──
    if (analytics) {
      setUserId(analytics, firebaseUser.uid);
      setUserProperties(analytics, { is_admin: profile.isAdmin ? 'true' : 'false' });
    }
    track('login', { method: 'username' });

    // Load all shared content
    await loadSharedData();

    // Enter app
    enterApp();

  } else {
    // Signed out
    window.S.user    = null;
    window.S.isAdmin = false;
    window.S.uid     = null;
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
    row.innerHTML = `
      <span class="un">${u.username}</span>
      ${u.isAdmin
        ? '<span class="pill pill-admin">admin</span>'
        : '<span class="pill" style="background:rgba(255,255,255,.04);color:var(--text3)">student</span>'}
      ${!isSelf
        ? `<button class="btn btn-sm" onclick="toggleAdmin('${u.uid}','${u.username}',${!u.isAdmin})">
             <i class="ti ${u.isAdmin ? 'ti-shield-off' : 'ti-shield-check'}"></i>
             ${u.isAdmin ? 'Remove' : 'Make admin'}
           </button>
           <button class="btn btn-sm btn-red" onclick="deleteUser('${u.uid}','${u.username}')">
             <i class="ti ti-trash"></i>
           </button>`
        : '<span style="font-size:11px;color:var(--text4)">(you)</span>'}`;
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
  if (!confirm(`Delete "${username}"? This cannot be undone.`)) return;
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
