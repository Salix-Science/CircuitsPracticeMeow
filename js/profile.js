/* profile.js — Student profile page: notification prefs + password change
   Notification preferences stored in the user's Firestore doc under `notifPrefs`.
   Email sending is handled by the existing notifications.js / EmailJS setup.
*/

// ── Render profile view ───────────────────────
window.renderProfile = function renderProfile() {
  const u    = window.S.user;
  const data = window.DB.users[u] || {};

  // Avatar + name
  const av = document.getElementById('profile-av');
  const nm = document.getElementById('profile-name');
  const rl = document.getElementById('profile-role');
  if (av) av.textContent = u.slice(0, 2).toUpperCase();
  if (nm) nm.textContent = u;
  if (rl) rl.textContent = data.isAdmin ? 'Instructor' : 'Student';

  // Load saved notification prefs
  const prefs = data.notifPrefs || {};
  const emailEl = document.getElementById('profile-email');
  const postsEl = document.getElementById('notif-posts');
  const annEl   = document.getElementById('notif-announcements');
  const assEl   = document.getElementById('notif-assignments');

  if (emailEl) emailEl.value    = prefs.email    || '';
  if (postsEl) postsEl.checked  = !!prefs.posts;
  if (annEl)   annEl.checked    = !!prefs.announcements;
  if (assEl)   assEl.checked    = !!prefs.assignments;

  // Clear any leftover ok/err messages
  ['notif-ok','profile-pw-ok','profile-pw-err'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

// ── Save notification preferences ────────────
window.saveNotifPrefs = async function saveNotifPrefs() {
  const email         = document.getElementById('profile-email')?.value.trim() || '';
  const posts         = document.getElementById('notif-posts')?.checked || false;
  const announcements = document.getElementById('notif-announcements')?.checked || false;
  const assignments   = document.getElementById('notif-assignments')?.checked || false;

  if (email && !isValidEmail(email)) {
    // Soft warning — don't block saving
    const ok = document.getElementById('notif-ok');
    if (ok) { ok.textContent = '⚠ Check your email address.'; ok.classList.remove('hidden'); }
    return;
  }

  const u = window.DB.users[window.S.user];
  if (!u) return;

  u.notifPrefs = { email, posts, announcements, assignments };
  await saveUserOnly();

  const ok = document.getElementById('notif-ok');
  if (ok) {
    ok.textContent = 'Preferences saved!';
    ok.classList.remove('hidden');
    setTimeout(() => ok.classList.add('hidden'), 3000);
  }
}

// ── Change password from profile page ─────────
window.profileChangePassword = async function profileChangePassword() {
  const newP  = document.getElementById('profile-pw-new')?.value  || '';
  const newP2 = document.getElementById('profile-pw-new2')?.value || '';
  const err   = document.getElementById('profile-pw-err');
  const ok    = document.getElementById('profile-pw-ok');

  err?.classList.add('hidden');
  ok?.classList.add('hidden');

  if (newP.length < 6) {
    if (err) { err.querySelector('span').textContent = 'Password must be at least 6 characters.'; err.classList.remove('hidden'); }
    return;
  }
  if (newP !== newP2) {
    if (err) { err.querySelector('span').textContent = 'Passwords do not match.'; err.classList.remove('hidden'); }
    return;
  }

  try {
    const { updatePassword } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const { getAuth }        = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    await updatePassword(getAuth().currentUser, newP);
    if (ok) { ok.classList.remove('hidden'); setTimeout(() => ok?.classList.add('hidden'), 3000); }
    document.getElementById('profile-pw-new').value  = '';
    document.getElementById('profile-pw-new2').value = '';
  } catch(e) {
    const msg = e.code === 'auth/requires-recent-login'
      ? 'Please sign out and sign back in first, then try again.'
      : e.message;
    if (err) { err.querySelector('span').textContent = msg; err.classList.remove('hidden'); }
  }
}

// ── Helper ────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Expose to notification system ─────────────
// Returns list of users subscribed to a given notification type.
// Used by notifications.js when admin triggers a send.
window.getSubscribedEmails = function(type) {
  return Object.values(window.DB.users)
    .filter(u => u.notifPrefs?.email && u.notifPrefs?.[type])
    .map(u => ({ email: u.notifPrefs.email, username: u.username }));
};
