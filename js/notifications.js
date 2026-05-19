/* notifications.js — Email notification sending via EmailJS
   
   SETUP REQUIRED (one-time, ~5 minutes):
   1. Create a free account at https://emailjs.com
   2. Add an Email Service (Gmail works) — copy the Service ID
   3. Create an Email Template with these variables:
        {{to_email}}   — recipient address
        {{subject}}    — email subject
        {{message}}    — email body (HTML ok)
        {{from_name}}  — "Circuits Practice"
   4. Copy your Template ID and Public Key
   5. Replace the three placeholders below with your real values.

   Free tier: 200 emails/month, no credit card required.

   Student notification preferences are saved in their profile
   (Profile tab → Email notifications). Admins send from here.
*/

const EMAILJS_SERVICE_ID  = 'service_vj8344b';
const EMAILJS_TEMPLATE_ID = 'template_r5jq4ed';
const EMAILJS_PUBLIC_KEY  = '6v4OZ7JLX_TuXeLws';

function emailjsConfigured() {
  return !EMAILJS_SERVICE_ID.startsWith('YOUR_') &&
         !EMAILJS_TEMPLATE_ID.startsWith('YOUR_') &&
         !EMAILJS_PUBLIC_KEY.startsWith('YOUR_');
}

// ── Send one email ────────────────────────────
async function sendOneEmail(toEmail, subject, message) {
  if (!emailjsConfigured()) { console.info('[notifications] EmailJS not configured'); return { ok:false }; }
  if (typeof emailjs === 'undefined') { console.warn('[notifications] EmailJS SDK not loaded'); return { ok:false }; }
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email:  toEmail,
      subject,
      message,
      from_name: 'Circuits Practice',
    }, EMAILJS_PUBLIC_KEY);
    return { ok: true };
  } catch(e) {
    console.error('[notifications] send failed:', e);
    return { ok: false, error: e.message };
  }
}

// ── Send bulk to all subscribers of a type ────
// type: 'posts' | 'announcements' | 'assignments'
async function sendBulkNotification(type, subject, message) {
  if (!window.S.isAdmin) return;
  const recipients = window.getSubscribedEmails(type);
  if (!recipients.length) return { sent:0, failed:0 };
  let sent=0, failed=0;
  for (const r of recipients) {
    const res = await sendOneEmail(r.email, subject, message);
    if (res.ok) sent++; else failed++;
  }
  logAdminAction('send_notification', { type, subject, sent, failed });
  return { sent, failed };
}

// ── Admin notification panel ──────────────────
function renderAdminNotifPanel() {
  const wrap = document.getElementById('admin-notif-wrap');
  if (!wrap) return;
  const configured = emailjsConfigured();

  // Count subscribers per type
  const users      = Object.values(window.DB.users);
  const countPosts = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.posts).length;
  const countAnn   = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.announcements).length;
  const countAss   = users.filter(u => u.notifPrefs?.email && u.notifPrefs?.assignments).length;

  wrap.innerHTML = `
    ${!configured ? `
      <div style="background:rgba(251,191,36,.08);border:0.5px solid rgba(251,191,36,.3);border-radius:var(--r2);padding:12px 14px;margin-bottom:14px;font-size:12px;color:var(--warn);line-height:1.7">
        <strong>EmailJS not configured.</strong> Replace the three placeholders at the top of <code>js/notifications.js</code>
        with your EmailJS Service ID, Template ID, and Public Key.
        Get them free at <a href="https://emailjs.com" target="_blank" style="color:var(--accent2)">emailjs.com</a>.
      </div>` : `
      <div style="background:rgba(74,222,128,.08);border:0.5px solid rgba(74,222,128,.25);border-radius:var(--r2);padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--green)">
        ✓ EmailJS configured and ready to send.
      </div>`}

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
        <button class="btn btn-sm btn-accent" onclick="adminSendNotification()" ${!configured?'disabled':''}>
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
  ok.textContent = `Sent to ${result.sent} student${result.sent!==1?'s':''}${result.failed?' · '+result.failed+' failed':''}.`;
  setTimeout(() => ok.classList.add('hidden'), 5000);
}
