/* notifications.js — Email via SendPulse (server-side Netlify function)
   All sends go to /api/send-email which holds the API secret.
   No email credentials are exposed in client-side code.

   Email types handled here:
     - Bulk notifications  (new post, announcement, assignment)
     - Welcome email       (account creation)
     - Password reset      (custom branded email)

   Student notification preferences are saved in their Firestore profile
   under notifPrefs: { email, posts, announcements, assignments }
*/

const EMAIL_ENDPOINT = '/api/send-email';

// ── Core send function ────────────────────────────────────────────────────────
// to: string (single) | Array of { email, name } (bulk)
async function callSendEmail(to, subject, html) {
  try {
    const res = await fetch(EMAIL_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ to, subject, html }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[notifications] send-email function error:', data.error);
      return { ok: false, error: data.error };
    }
    return data; // { ok, sent, failed }
  } catch(e) {
    console.error('[notifications] fetch failed:', e);
    return { ok: false, error: e.message };
  }
}

// ── Email templates ───────────────────────────────────────────────────────────
function baseTemplate(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
        <!-- Header -->
        <tr>
          <td style="background:#161b27;border-radius:12px 12px 0 0;padding:24px 32px;border-bottom:1px solid #2a3040">
            <span style="font-size:15px;font-weight:700;color:#7dd3fc;letter-spacing:.02em">
              ⚡ Circuits Practice
            </span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#161b27;padding:28px 32px;color:#e2e8f0;font-size:14px;line-height:1.7">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#0f1117;border-radius:0 0 12px 12px;padding:16px 32px;border-top:1px solid #2a3040">
            <p style="margin:0;font-size:11px;color:#4a5568;line-height:1.6">
              You're receiving this because you're enrolled in a course using
              <a href="https://circuitspractice.org" style="color:#7dd3fc;text-decoration:none">circuitspractice.org</a>.
              Update your email preferences in your
              <a href="https://circuitspractice.org" style="color:#7dd3fc;text-decoration:none">profile settings</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function notificationTemplate(title, message) {
  return baseTemplate(title, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#f1f5f9">${title}</h2>
    <div style="color:#cbd5e1">${message}</div>
    <div style="margin-top:24px">
      <a href="https://circuitspractice.org"
         style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;
                padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">
        Open Circuits Practice →
      </a>
    </div>
  `);
}

function welcomeTemplate(username) {
  return baseTemplate('Welcome to Circuits Practice', `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#f1f5f9">
      Welcome, ${username}! ⚡
    </h2>
    <p style="margin:0 0 12px;color:#cbd5e1">
      Your Circuits Practice account is ready. You can now access practice problems,
      assignments, and course resources.
    </p>
    <p style="margin:0 0 20px;color:#94a3b8;font-size:13px">
      Sign in with the email address this was sent to and the temporary password
      your instructor provided.
    </p>
    <div style="margin-top:8px">
      <a href="https://circuitspractice.org"
         style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;
                padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">
        Get Started →
      </a>
    </div>
  `);
}

function passwordResetTemplate(resetLink) {
  return baseTemplate('Reset your password', `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#f1f5f9">
      Password reset requested
    </h2>
    <p style="margin:0 0 12px;color:#cbd5e1">
      We received a request to reset your Circuits Practice password.
      Click the button below to set a new one.
    </p>
    <div style="margin:24px 0">
      <a href="${resetLink}"
         style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;
                padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">
        Reset Password →
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6">
      If you didn't request this, you can safely ignore this email.
      This link expires in 1 hour.
    </p>
  `);
}

// ── Resolve subscribers for a notification type ───────────────────────────────
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
    .map(u => ({ email: u.notifPrefs.email, name: u.username || u.notifPrefs.email }));
}

// ── Public API ────────────────────────────────────────────────────────────────

// Bulk notification to all subscribers of a type.
// type: 'posts' | 'announcements' | 'assignments'
async function sendBulkNotification(type, subject, message) {
  if (!window.S.isAdmin) {
    console.warn('[notifications] sendBulkNotification blocked — not admin');
    return { sent: 0, failed: 0 };
  }
  const recipients = await getAllSubscribers(type);
  if (!recipients.length) {
    console.info('[notifications] no subscribers for type:', type);
    return { sent: 0, failed: 0 };
  }
  const html = notificationTemplate(subject, message);
  const result = await callSendEmail(recipients, subject, html);
  logAdminAction('send_notification', { type, subject, sent: result.sent || 0, failed: result.failed || 0 });
  return { sent: result.sent || 0, failed: result.failed || 0 };
}

// Send a welcome email to a newly created student account.
window.sendWelcomeEmail = async function sendWelcomeEmail(toEmail, username) {
  if (!window.S.isAdmin) return;
  const subject = 'Welcome to Circuits Practice';
  const html    = welcomeTemplate(username);
  const result  = await callSendEmail(toEmail, subject, html);
  if (!result.ok) console.warn('[notifications] welcome email failed:', result.error);
  return result;
};

// Send a password reset email (custom branded, wraps Firebase reset link).
window.sendPasswordResetEmail = async function sendPasswordResetEmail(toEmail, resetLink) {
  const subject = 'Reset your Circuits Practice password';
  const html    = passwordResetTemplate(resetLink);
  const result  = await callSendEmail(toEmail, subject, html);
  if (!result.ok) console.warn('[notifications] password reset email failed:', result.error);
  return result;
};

// Wrapper used by auto-send hooks in blog.js and editor.js
window.sendEmailNotification = async function sendEmailNotification(subject, message, type = 'posts') {
  return sendBulkNotification(type, subject, message);
};
window.sendBulkNotification = sendBulkNotification;

// ── Admin notification panel ──────────────────────────────────────────────────
window.renderAdminNotifPanel = async function renderAdminNotifPanel() {
  const wrap = document.getElementById('admin-notif-wrap');
  if (!wrap) return;

  let users = [];
  try {
    if (typeof window._fetchAllUsers === 'function') users = await window._fetchAllUsers();
  } catch(e) {
    console.error('[notifications] subscriber count fetch failed:', e);
  }
  if (!users.length) users = Object.values(window.DB.users || {});

  const countPosts = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.posts).length;
  const countAnn   = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.announcements).length;
  const countAss   = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.assignments).length;

  wrap.innerHTML = `
    <div style="background:rgba(74,222,128,.08);border:0.5px solid rgba(74,222,128,.25);
                border-radius:var(--r2);padding:10px 14px;margin-bottom:14px;
                font-size:12px;color:var(--green)">
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
};

function subBadge(label, count) {
  return `<div style="background:var(--bg3);border:0.5px solid var(--border);
                      border-radius:var(--r2);padding:8px 12px;text-align:center;min-width:100px">
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
  ok.textContent = `Sent to ${result.sent} student${result.sent !== 1 ? 's' : ''}${result.failed ? ' · ' + result.failed + ' failed' : ''}.`;
  setTimeout(() => ok.classList.add('hidden'), 6000);
};
