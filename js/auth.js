// auth.js (Firebase version)

// ── Register ──────────────────────────────────
async function doRegister() {
  const username = document.getElementById('r-user').value.trim();
  const email    = username + '@circuits.local'; // or use real email field
  const pass     = document.getElementById('r-pass').value;
  const pass2    = document.getElementById('r-pass2').value;
  if (pass !== pass2) { showAuthErr('r-err', 'Passwords do not match.'); return; }
  if (pass.length < 6) { showAuthErr('r-err', 'Password needs 6+ characters.'); return; }
  try {
    const cred = await createUserWithEmailAndPassword(window._auth, email, pass);
    // Write the user profile to Firestore
    await setDoc(doc(window._db, 'users', cred.user.uid), {
      username,
      isAdmin: false,
      streak: 0,
      scores: {},
      assignSubmissions: {},
      createdAt: Date.now(),
    });
    // onAuthStateChanged fires automatically → enterApp()
  } catch (e) {
    showAuthErr('r-err', e.message);
  }
}

// ── Login ─────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('l-user').value.trim();
  const email    = username + '@circuits.local';
  const pass     = document.getElementById('l-pass').value;
  try {
    await signInWithEmailAndPassword(window._auth, email, pass);
    // onAuthStateChanged fires → enterApp()
  } catch (e) {
    showAuthErr('l-err', 'Username or password incorrect.');
  }
}

// ── Logout ────────────────────────────────────
async function doLogout() {
  await signOut(window._auth);
  // onAuthStateChanged fires → shows auth screen
}

// ── Save a user's progress ────────────────────
async function saveUserData() {
  const uid = window._auth.currentUser?.uid;
  if (!uid) return;
  await setDoc(doc(window._db, 'users', uid), window.DB.users[window.S.user], { merge: true });
}

// ── Load shared content (problems, posts, etc.) ──
async function loadSharedDB() {
  // Problems
  const probSnap = await getDocs(collection(window._db, 'problems'));
  window.DB.problems = probSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Posts
  const postSnap = await getDocs(collection(window._db, 'posts'));
  window.DB.posts = postSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Assignments
  const assignSnap = await getDocs(collection(window._db, 'assignments'));
  window.DB.assignments = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Folders
  const folderSnap = await getDocs(collection(window._db, 'folders'));
  window.DB.folders = folderSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Save a problem ─────────────────────────────
async function saveDB() {
  // Each collection is saved separately
  for (const p of window.DB.problems) {
    await setDoc(doc(window._db, 'problems', p.id), p);
  }
  for (const p of window.DB.posts) {
    await setDoc(doc(window._db, 'posts', p.id), p);
  }
  for (const a of window.DB.assignments) {
    await setDoc(doc(window._db, 'assignments', a.id), a);
  }
  for (const f of window.DB.folders) {
    await setDoc(doc(window._db, 'folders', f.id), f);
  }
  await saveUserData();
}
