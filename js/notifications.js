/* notifications.js — Email notification opt-in + sending via EmailJS
   
   SETUP REQUIRED (one-time, takes ~5 minutes):
   1. Create a free account at https://emailjs.com
   2. Add an Email Service (Gmail recommended) — copy the Service ID
   3. Create an Email Template with these variables:
        {{to_email}}   — recipient address
        {{subject}}    — email subject
        {{message}}    — email body
        {{from_name}}  — "Circuits Practice"
   4. Copy your Template ID and Public Key
   5. Replace the three placeholders below with your real values.
   
   Free tier: 200 emails/month, no credit card required.
*/

const EMAILJS_SERVICE_ID  = 'YOUR_SERVICE_ID';   // e.g. 'service_abc123'
const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';  // e.g. 'template_xyz789'
const EMAILJS_PUBLIC_KEY  = 'YOUR_PUBLIC_KEY';   // e.g. 'abcDEFghiJKL'

// ── Check if EmailJS is configured ────────────
function emailjsConfigured() {
  return !EMAILJS_SERVICE_ID.startsWith('YOUR_') &&
         !EMAILJS_TEMPLATE_ID.startsWith('YOUR_') &&
         !EMAILJS_PUBLIC_KEY.startsWith('YOUR_');
}

// ── Send one email via EmailJS ─────────────────
async function sendOneEmail(toEmail, subject, message) {
  if (!emailjsConfigured()) {
    console.info('[notifications] EmailJS not configured — skipping send');
    return;
  }
  if (typeof emailjs === 'undefined') {
    console.warn('[notifications] EmailJS SDK not loaded');
    return;
  }
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email:  toEmail,
      subject,
      message,
      from_name: 'Circuits Practice',
    }, EMAILJS_PUBLIC_KEY);
  } catch(e) {
    console.warn('[notifications] EmailJS send failed:', e);
  }
}

// ── Send notification to all subscribed students ──
// Called by blog.js when a new post is published.
window.sendEmailNotification = async function(subject, message) {
  if (!emailjsConfigured()) return;

  // Collect all users who have opted in and have an email address
  const subscribers = [];
  try {
    const snap = await window._fetchAllUsers();
    snap.forEach(u => {
      if (u.notifEmail && u.notifOptIn) {
        subscribers.push(u.notifEmail);
      }
    });
  } catch(e) {
    console.warn('[notifications] Could not fetch subscribers:', e);
    return;
  }

  if (!subscribers.length) return;

  // Send in sequence to avoid hammering EmailJS rate limits
  for (const email of subscribers) {
    await sendOneEmail(email, subject, message);
  }

  console.info(`[notifications] Sent to ${subscribers.length} subscriber(s)`);
};

// ── Student notification settings UI ─────────
// Rendered inside the account/settings section.
function renderNotifSettings() {
  const wrap = document.getElementById('notif-settings-wrap');
  if (!wrap) return;

  const u    = window.DB.users[window.S.user] || {};
  const optIn = !!u.notifOptIn;
  const email  = u.notifEmail || '';
  const configured = emailjsConfigured();

  wrap.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-top:16px">
      <div style="padding:10px 16px;border-bottom:0.5px solid var(--border);background:var(--bg3);font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;gap:6px">
        <i class="ti ti-mail" style="font-size:13px"></i> Email notifications
        ${!configured ? '<span class="pill pill-warn" style="font-size:9px;margin-left:auto">Not set up yet</span>' : ''}
      </div>
      <div style="padding:14px 16px">
        ${!configured ? `
          <p style="font-size:12px;color:var(--text3);margin-bottom:12px;line-height:1.7">
            Email notifications aren't configured yet — ask your instructor to set up EmailJS.
          </p>` : ''}
        <p style="font-size:12px;color:var(--text3);margin-bottom:12px;line-height:1.7">
          Get emailed when a new post or announcement is published.
        </p>
        <div class="field" style="margin-bottom:10px">
          <label>Your email address</label>
          <input type="email" id="notif-email-input" value="${email}"
            placeholder="you@example.com" style="max-width:320px"
            ${!configured ? 'disabled' : ''}/>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div class="toggle-wrap" onclick="${configured ? 'toggleNotifOptIn()' : 'void(0)'}">
            <div class="toggle-track ${optIn ? 'on' : ''}" id="notif-toggle-track" style="${!configured ? 'opacity:.4' : ''}">
              <div class="toggle-thumb"></div>
            </div>
          </div>
          <span style="font-size:13px;color:var(--text2)" id="notif-toggle-label">
            ${optIn ? 'Subscribed' : 'Not subscribed'}
          </span>
        </div>
        <button class="btn btn-sm btn-accent" onclick="saveNotifSettings()" ${!configured ? 'disabled' : ''}>
          <i class="ti ti-device-floppy"></i> Save preferences
        </button>
        <div class="ok-msg hidden" id="notif-ok" style="margin-top:8px">Saved!</div>
      </div>
    </div>`;
}

function toggleNotifOptIn() {
  const track = document.getElementById('notif-toggle-track');
  const label = document.getElementById('notif-toggle-label');
  if (!track) return;
  const nowOn = !track.classList.contains('on');
  track.classList.toggle('on', nowOn);
  label.textContent = nowOn ? 'Subscribed' : 'Not subscribed';
}

async function saveNotifSettings() {
  const email  = document.getElementById('notif-email-input')?.value.trim();
  const optIn  = document.getElementById('notif-toggle-track')?.classList.contains('on');
  const ok     = document.getElementById('notif-ok');

  if (optIn && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('Please enter a valid email address.');
    return;
  }

  const u = window.DB.users[window.S.user];
  if (!u) return;
  u.notifEmail = email;
  u.notifOptIn = optIn;
  await saveUserOnly();

  if (ok) { ok.classList.remove('hidden'); setTimeout(() => ok.classList.add('hidden'), 2000); }
}
