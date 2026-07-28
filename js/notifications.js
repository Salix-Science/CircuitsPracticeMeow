/* notifications.js — Email notifications via Firebase "Trigger Email" extension
   
   HOW IT WORKS:
   Writing a doc to the `mail` Firestore collection triggers the extension,
   which sends the email via your SMTP credentials (configured in Firebase Console).
   No client-side API key needed — just Firestore auth.

   SETUP REQUIRED (one-time, ~30 minutes):
   1. Upgrade Firebase project to Blaze plan (pay-as-you-go, free at this scale)
   2. Firebase Console → Extensions → install "Trigger Email from Firestore"
        • SMTP URI:              smtp://admin%40circuitspractice.org:APP_PASSWORD@smtppro.zoho.com:587
                                 (the @ in the username MUST be %40-encoded, or the
                                  URI mis-parses and Zoho returns 535 Authentication Failed)
        • Email documents collection: mail
        • Default FROM address:  Circuits Practice <admin@circuitspractice.org>
                                 (must match the authenticated SMTP user — a mismatch
                                  is rejected at send time, not at auth time)

      NOTE: the password must be a Zoho *app password* (16 chars, generated under
      Zoho Mail → Settings → Security → App Passwords). The account password is
      rejected with 535 whenever 2FA is enabled. App passwords are also revoked
      silently by any account-password change or 2FA toggle.
   3. Add Firestore rule for the mail collection:
        match /mail/{docId} {
          allow create: if request.auth != null;
          allow read:   if request.auth != null &&
                        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
          allow update, delete: if false;
        }
      The admin read is what makes failures diagnosable: the extension writes a
      `delivery` map back onto each mail doc containing state (PENDING →
      PROCESSING → SUCCESS/ERROR), the raw SMTP error string, attempts, and
      info.accepted/rejected. Without read access, a failed send is invisible
      from the client — _addMailDoc returns ok:true as soon as the *write*
      succeeds, which says nothing about whether the mail actually left.

   Student notification preferences are saved in their profile
   (Profile tab → Email notifications). Admins send from the Notifications subtab.
*/

// ── Branded HTML email template ───────────────
// Converts a plain-text message into a styled HTML email that mirrors the
// CircuitsPractice site aesthetic. All styles are inline (email clients
// strip <style> blocks). Fonts fall back to system serif/monospace.
//
// type: 'posts' | 'announcements' | 'assignments' | 'general'
// opts.recipient — optional name to personalise the greeting
// opts.ctaLabel  — optional CTA button label (default: 'Visit Circuits Practice →')
// opts.ctaUrl    — optional CTA button URL   (default: 'https://circuitspractice.org')
function buildEmailHtml(subject, message, type = 'general', opts = {}) {
  const SITE     = 'https://circuitspractice.org';
  const ctaUrl   = opts.ctaUrl   || SITE;
  const ctaLabel = opts.ctaLabel || 'Visit Circuits Practice →';
  const recipient = opts.recipient ? opts.recipient.split(' ')[0] : null; // first name only

  // Badge label + emoji per notification type
  const badges = {
    posts:         { label: 'New Post',         emoji: '📄' },
    announcements: { label: 'Announcement',     emoji: '📢' },
    assignments:   { label: 'New Assignment',   emoji: '📋' },
    general:       { label: 'Notification',     emoji: '🔔' },
  };
  const badge = badges[type] || badges.general;

  // Convert plain-text message to HTML paragraphs
  // Each double-newline becomes a paragraph break; single newlines become <br>
  const bodyHtml = message
    .split(/\n{2,}/)
    .map(para => `<p style="font-size:14px;color:#b7ab93;line-height:1.85;margin:0 0 14px">${
      para.replace(/\n/g, '<br>').trim()
    }</p>`)
    .join('\n');

  const greeting = recipient
    ? `<p style="font-size:14px;color:#b7ab93;line-height:1.85;margin:0 0 14px">Hi ${recipient},</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#1d242c;font-family:Georgia,'Times New Roman',serif">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1d242c;padding:32px 16px">
    <tr><td align="center">

      <!-- Card -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:580px;background:#161c23;border-radius:10px;overflow:hidden;border:1px solid #323b44;box-shadow:0 4px 40px rgba(0,0,0,0.6)">

        <!-- ── Header ── -->
        <tr>
          <td style="background:linear-gradient(135deg,#161c23 0%,#242c35 100%);padding:30px 36px 26px;text-align:center;border-bottom:1px solid #323b44">
            <!-- Circuit line decoration -->
            <div style="font-size:10px;color:#323b44;letter-spacing:.3em;margin-bottom:10px">
              ─────── ◈ ───────
            </div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:.20em;color:#e8a866;text-transform:uppercase;margin-bottom:5px">
              Circuits Practice
            </div>
            <div style="font-size:10px;color:#7d7461;letter-spacing:.18em;text-transform:uppercase;font-family:Courier,'Courier New',monospace">
              circuitspractice.org
            </div>
            <div style="font-size:10px;color:#323b44;letter-spacing:.3em;margin-top:10px">
              ─────── ◈ ───────
            </div>
          </td>
        </tr>

        <!-- ── Type badge ── -->
        <tr>
          <td style="background:#1d242c;padding:12px 36px;border-bottom:1px solid #262e36">
            <span style="display:inline-block;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#cf8a45;background:rgba(207,138,69,.12);border:1px solid rgba(207,138,69,.28);border-radius:99px;padding:4px 12px;font-family:Courier,'Courier New',monospace">
              ${badge.emoji}&nbsp; ${badge.label}
            </span>
          </td>
        </tr>

        <!-- ── Subject ── -->
        <tr>
          <td style="background:#161c23;padding:24px 36px 8px">
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:600;color:#ece3d3;margin:0;line-height:1.4;letter-spacing:.01em">
              ${subject}
            </h1>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="background:#161c23;padding:12px 36px 8px">
            <!-- Subtle divider -->
            <div style="height:1px;background:linear-gradient(90deg,transparent,#323b44,transparent);margin-bottom:20px"></div>

            ${greeting}
            ${bodyHtml}
          </td>
        </tr>

        <!-- ── CTA button ── -->
        <tr>
          <td style="background:#161c23;padding:8px 36px 28px;text-align:center">
            <a href="${ctaUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#7a4a20,#cf8a45);color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:12px 30px;border-radius:6px;letter-spacing:.05em;font-family:Georgia,'Times New Roman',serif">
              ${ctaLabel}
            </a>
          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td style="background:#11161c;padding:20px 36px;border-top:1px solid #323b44;text-align:center">
            <p style="font-size:11px;color:#4f493c;margin:0 0 5px;line-height:1.7;font-family:Courier,'Courier New',monospace">
              You're receiving this because you subscribed to notifications on Circuits Practice.
            </p>
            <p style="font-size:11px;color:#4f493c;margin:0;line-height:1.7;font-family:Courier,'Courier New',monospace">
              <a href="${SITE}" style="color:#7d7461;text-decoration:none">circuitspractice.org</a>
              &nbsp;·&nbsp;
              To unsubscribe, update your preferences under <strong style="color:#4a5560">Profile → Email notifications</strong>.
            </p>
          </td>
        </tr>

      </table>
      <!-- End card -->

    </td></tr>
  </table>
  <!-- End outer wrapper -->

</body>
</html>`;
}

// ── Send one email ────────────────────────────
// Writes a doc to `mail`; the Firebase extension picks it up and sends it.
// `message` may be plain text — it is automatically wrapped in the branded template.
async function sendOneEmail(toEmail, subject, message, type = 'general', opts = {}) {
  if (typeof window._addMailDoc !== 'function') {
    console.error('[notifications] _addMailDoc not available — firebase.js may not be loaded');
    return { ok: false };
  }
  const html = buildEmailHtml(subject, message, type, opts);
  return window._addMailDoc(toEmail, subject, html);
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
// Each recipient gets a personalised greeting using their stored username.
async function sendBulkNotification(type, subject, message) {
  if (!window.S.isAdmin) { console.warn('[notifications] sendBulkNotification blocked — not admin'); return { sent:0, failed:0 }; }
  const recipients = await getAllSubscribers(type);
  if (!recipients.length) return { sent:0, failed:0 };
  let sent=0, failed=0;
  for (const r of recipients) {
    const res = await sendOneEmail(r.email, subject, message, type, { recipient: r.username });
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
      ✓ Sending via Firebase Trigger Email · <code style="font-size:11px">admin@circuitspractice.org</code>
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
