/* notifications.js — Email via SendPulse (Netlify function /api/send-email)
   API credentials live server-side only — nothing sensitive is exposed here.

   Student notification preferences are saved in their profile
   (Profile tab → Email notifications). Admins send from here.
*/

const EMAIL_ENDPOINT = '/api/send-email';

// ── Email templates ───────────────────────────
function _baseTemplate(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
        <tr><td style="background:#161b27;border-radius:12px 12px 0 0;padding:24px 32px;border-bottom:1px solid #2a3040">
          <span style="font-size:15px;font-weight:700;color:#7dd3fc">⚡ Circuits Practice</span>
        </td></tr>
        <tr><td style="background:#161b27;padding:28px 32px;color:#e2e8f0;font-size:14px;line-height:1.7">
          ${bodyHtml}
        </td></tr>
        <tr><td style="background:#0f1117;border-radius:0 0 12px 12px;padding:16px 32px;border-top:1px solid #2a3040">
          <p style="margin:0;font-size:11px;color:#4a5568;line-height:1.6">
            You're receiving this because you're enrolled in a course using
            <a href="https://circuitspractice.org" style="color:#7dd3fc;text-decoration:none">circuitspractice.org</a>.
            Update your preferences in your <a href="https://circuitspractice.org" style="color:#7dd3fc;text-decoration:none">profile settings</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ── Send one email via Netlify function ────────
// to: string (single address) or Array of { email, name } for bulk
async function sendOneEmail(toEmail, subject, message) {
  const html = _baseTemplate(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#f1f5f9">${subject}</h2>
    <div style="color:#cbd5e1">${message}</div>
    <div style="margin-top:24px">
      <a href="https://circuitspractice.org"
         style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;
                padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">
        Open Circuits Practice →
      </a>
    </div>
  `);
  try {
    const res  = await fetch(EMAIL_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ to: toEmail, subject, html }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('[notifications] send failed:', data.error); return { ok: false }; }
    return { ok: true };
  } catch(e) {
    console.error('[notifications] fetch failed:', e);
    return { ok: false, error: e.message };
  }
}

// Welcome email sent on account creation
window.sendWelcomeEmail = async function sendWelcomeEmail(toEmail, username) {
  const subject = 'Welcome to Circuits Practice';
  const html = _baseTemplate(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#f1f5f9">Welcome, ${username}! ⚡</h2>
    <p style="margin:0 0 12px;color:#cbd5e1">Your Circuits Practice account is ready.</p>
    <p style="margin:0 0 20px;color:#94a3b8;font-size:13px">Sign in with this email address and the temporary password your instructor provided.</p>
    <a href="https://circuitspractice.org"
       style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;
              padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">Get Started →</a>
  `);
  try {
    const res  = await fetch(EMAIL_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ to: toEmail, subject, html }),
    });
    const data = await res.json();
    return data;
  } catch(e) {
    console.error('[notifications] welcome email failed:', e);
    return { ok: false };
  }
};

// ── Resolve subscribers for a type ────────────
// IMPORTANT: window.DB.users only holds the *current* session's user, so the
// old code could never reach other students. We fetch all users (admin-only)
// so auto-sends and bulk sends actually reach every subscriber.
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

// Wrapper used by auto-send hooks (blog.js, editor.js). Was previously
// referenced but never defined, so auto-emails silently did nothing.
window.sendEmailNotification = async function sendEmailNotification(subject, message, type = 'posts') {
  return sendBulkNotification(type, subject, message);
};
window.sendBulkNotification = sendBulkNotification;

// ── Admin notification panel ──────────────────
window.renderAdminNotifPanel = async function renderAdminNotifPanel() {
  const wrap = document.getElementById('admin-notif-wrap');
  if (!wrap) return;
  const configured = true; // SendPulse configured via Netlify env vars

  // Count subscribers per type across ALL users (not just the loaded session user)
  let users = [];
  try { if (typeof window._fetchAllUsers === 'function') users = await window._fetchAllUsers(); }
  catch(e) { console.error('[notifications] subscriber count fetch failed:', e); }
  if (!users.length) users = Object.values(window.DB.users || {});
  const countPosts = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.posts).length;
  const countAnn   = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.announcements).length;
  const countAss   = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.assignments).length;

  wrap.innerHTML = `
    <div style="background:rgba(74,222,128,.08);border:0.5px solid rgba(74,222,128,.25);border-radius:var(--r2);padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--green)">
      ✓ SendPulse configured — sending from noreply@circuitspractice.org
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
        <button class="btn btn-sm btn-accent" onclick="adminSendNotification()">
          <i class="ti ti-send"></i> Send email
        </button>
        <div class="ok-msg hidden" id="notif-send-ok"></div>
      </div>
    </div>`;
}

function subBadge(label, count) {
  return `<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:var(--r2);padding:8px 12px;text-align:center;min-width:100px">
    <div style="font-size:18px;font-family:var(--mono);font-weight:500;color:var(--accent2)">${count}</div>
    <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.1em;margin-top:2px">${label}</div>
  </div>`;
}

window.adminSendNotification = async function adminSendNotification() {
  if (!window.S.isAdmin) return;
  const type    = document.getElementById('notif-send-type')?.value;
  const subject = document.getElementById('notif-send-subject')?.value.trim();
  const body    = document.getElementById('notif-send-body')?.value.trim();
  const ok      = document.getElementById('notif-send-ok');

  if (!subject || !body) { alert('Enter a subject and message.'); return; }

  ok.textContent = 'Sending…';
  ok.classList.remove('hidden');

  const result = await sendBulkNotification(type, subject, body);
  ok.textContent = `Sent to ${result.sent} student${result.sent!==1?'s':''}${result.failed?' · '+result.failed+' failed':''}.`;
  setTimeout(() => ok.classList.add('hidden'), 5000);
}
