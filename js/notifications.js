/* notifications.js — Email notifications via Firebase "Trigger Email" extension
   
   HOW IT WORKS:
   Writing a doc to the `mail` Firestore collection triggers the extension,
   which sends the email via your SMTP credentials (configured in Firebase Console).
   No client-side API key needed — just Firestore auth.

   SETUP REQUIRED (one-time, ~30 minutes):
   1. Upgrade Firebase project to Blaze plan (pay-as-you-go, free at this scale)
   2. Firebase Console → Extensions → install "Trigger Email from Firestore"
        • SMTP URI:              smtps://noreply%40circuitspractice.org:APP_PASSWORD@YOUR_SMTP_HOST:465
        • Email documents collection: mail
        • Default FROM address:  Circuits Practice <noreply@circuitspractice.org>
   3. Add Firestore rule for the mail collection:
        match /mail/{docId} {
          allow create: if request.auth != null;
          allow read, update, delete: if false;
        }

   Student notification preferences are saved in their profile
   (Profile tab → Email notifications). Admins send from the Notifications subtab.
*/

// ── Send one email ────────────────────────────
// Writes a doc to `mail`; the Firebase extension picks it up and sends it.
async function sendOneEmail(toEmail, subject, message) {
  if (typeof window._addMailDoc !== 'function') {
    console.error('[notifications] _addMailDoc not available — firebase.js may not be loaded');
    return { ok: false };
  }
  return window._addMailDoc(toEmail, subject, message);
}

// ── Resolve subscribers for a type ────────────
// Fetches all users (admin-only) so bulk sends reach every subscriber.
async function getAllSubscribers(type) {
  let users = [];
  try {
    if (window.S.isAdmin && typeof window._fetchAllUsers === 'function') {
      users = await window._fetchAllUsers();
    }
  } catch(e) {
    console.error('[notifications] getAllSubscribers fetch failed:', e);
  }
  if (!users.length) users = Object.values(window.DB.users || {});
  return users
    .filter(u => u.notifPrefs?.email && u.notifPrefs?.[type])
    .map(u => ({ email: u.notifPrefs.email, username: u.username }));
}

// ── Send bulk to all subscribers of a type ────
// type: 'posts' | 'announcements' | 'assignments'
async function sendBulkNotification(type, subject, message) {
  if (!window.S.isAdmin) { console.warn('[notifications] sendBulkNotification blocked — not admin'); return { sent:0, failed:0 }; }
  const recipients = await getAllSubscribers(type);
  if (!recipients.length) return { sent:0, failed:0 };
  let sent=0, failed=0;
  for (const r of recipients) {
    const res = await sendOneEmail(r.email, subject, message);
    if (res.ok) sent++; else failed++;
  }
  logAdminAction('send_notification', { type, subject, sent, failed });
  return { sent, failed };
}

// Wrapper used by auto-send hooks (blog.js, editor.js).
window.sendEmailNotification = async function sendEmailNotification(subject, message, type = 'posts') {
  return sendBulkNotification(type, subject, message);
};
window.sendBulkNotification = sendBulkNotification;

// ── Admin notification panel ──────────────────
window.renderAdminNotifPanel = async function renderAdminNotifPanel() {
  const wrap = document.getElementById('admin-notif-wrap');
  if (!wrap) return;

  // Count subscribers per type across ALL users
  let users = [];
  try { if (typeof window._fetchAllUsers === 'function') users = await window._fetchAllUsers(); }
  catch(e) { console.error('[notifications] subscriber count fetch failed:', e); }
  if (!users.length) users = Object.values(window.DB.users || {});
  const countPosts = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.posts).length;
  const countAnn   = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.announcements).length;
  const countAss   = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.assignments).length;

  wrap.innerHTML = `
    <div style="background:rgba(74,222,128,.08);border:0.5px solid rgba(74,222,128,.25);border-radius:var(--r2);padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--green);line-height:1.7">
      ✓ Sending via Firebase Trigger Email · <code style="font-size:11px">noreply@circuitspractice.org</code>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      ${subBadge('Posts', countPosts)}
      ${subBadge('Announcements', countAnn)}
      ${subBadge('Assignments', countAss)}
    </div>

    <div class="section-card" style="max-width:600px">
      <h4><i class="ti ti-send"></i> Send notification</h4>
      <div class="field" style="margin-bottom:10px">
        <label>Send to</label>
        <select id="notif-send-type" style="font-size:12px">
          <option value="posts">New post subscribers (${countPosts})</option>
          <option value="announcements">Announcement subscribers (${countAnn})</option>
          <option value="assignments">Assignment subscribers (${countAss})</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:10px">
        <label>Subject</label>
        <input type="text" id="notif-send-subject" placeholder="e.g. New blog post: KVL explained"/>
      </div>
      <div class="field" style="margin-bottom:10px">
        <label>Message</label>
        <textarea id="notif-send-body" rows="4" placeholder="Write your message here…"></textarea>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-sm btn-accent" id="notif-send-btn">
          <i class="ti ti-send"></i> Send email
        </button>
        <div class="ok-msg hidden" id="notif-send-ok"></div>
      </div>
    </div>`;

  document.getElementById('notif-send-btn').addEventListener('click', adminSendNotification);
}

function subBadge(label, count) {
  return `<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:8px 12px;text-align:center;min-width:100px">
    <div style="font-size:18px;font-family:var(--mono);font-weight:500;color:var(--accent2)">${count}</div>
    <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.1em;margin-top:2px">${label}</div>
  </div>`;
}

async function adminSendNotification() {
  if (!window.S.isAdmin) return;
  const type    = document.getElementById('notif-send-type')?.value;
  const subject = document.getElementById('notif-send-subject')?.value.trim();
  const body    = document.getElementById('notif-send-body')?.value.trim();
  const ok      = document.getElementById('notif-send-ok');

  if (!subject || !body) { alert('Enter a subject and message.'); return; }

  ok.textContent = 'Sending…';
  ok.classList.remove('hidden');

  const result = await sendBulkNotification(type, subject, body);
  ok.textContent = `Queued for ${result.sent} student${result.sent!==1?'s':''}${result.failed?' · '+result.failed+' failed':''}.`;
  setTimeout(() => ok.classList.add('hidden'), 5000);
}
