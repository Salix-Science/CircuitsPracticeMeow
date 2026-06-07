/* netlify/functions/send-email.js
   Server-side email sending via SendPulse REST API.
   Called by notifications.js for all outbound mail:
     - Bulk notifications (posts, announcements, assignments)
     - Welcome email on account creation
     - Password reset emails

   Environment variables (set in Netlify dashboard → Site config → Env vars):
     SENDPULSE_CLIENT_ID
     SENDPULSE_CLIENT_SECRET
     SENDPULSE_FROM_EMAIL    (e.g. noreply@circuitspractice.org)
     SENDPULSE_FROM_NAME     (e.g. Circuits Practice)

   Request body (JSON POST from client):
     { to, subject, html, type }
     to      — string email OR array of { email, name } objects
     subject — string
     html    — HTML string (plain text fallback auto-generated)
     type    — 'single' | 'bulk' (default: 'single')
*/

const SENDPULSE_API = 'https://api.sendpulse.com';

// ── OAuth token (cached per function instance lifetime) ───────────────────────
let _tokenCache = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;

  const res = await fetch(`${SENDPULSE_API}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     process.env.SENDPULSE_CLIENT_ID,
      client_secret: process.env.SENDPULSE_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendPulse auth failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  _tokenCache  = data.access_token;
  // expires_in is in seconds; refresh 60s early to avoid edge-case expiry
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _tokenCache;
}

// ── Send one email via SendPulse SMTP API ─────────────────────────────────────
async function sendOne(token, to, subject, html, fromEmail, fromName) {
  // Strip HTML tags for plain-text fallback
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  const recipient = typeof to === 'string'
    ? [{ email: to, name: to }]
    : Array.isArray(to) ? to : [to];

  const body = {
    email: {
      html:    Buffer.from(html).toString('base64'),
      text,
      subject,
      from:    { name: fromName, email: fromEmail },
      to:      recipient,
    },
  };

  const res = await fetch(`${SENDPULSE_API}/smtp/emails`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendPulse send failed: ${res.status} ${text}`);
  }

  return res.json();
}

// ── Netlify handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CORS — only allow requests from the site itself
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowed = ['https://circuitspractice.org', 'https://www.circuitspractice.org'];
  if (origin && !allowed.includes(origin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { to, subject, html } = body;

  // Validate required fields
  if (!to || !subject || !html) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: to, subject, html' }) };
  }

  const fromEmail = process.env.SENDPULSE_FROM_EMAIL || 'noreply@circuitspractice.org';
  const fromName  = process.env.SENDPULSE_FROM_NAME  || 'Circuits Practice';

  // Validate env vars are configured
  if (!process.env.SENDPULSE_CLIENT_ID || !process.env.SENDPULSE_CLIENT_SECRET) {
    console.error('[send-email] Missing SENDPULSE_CLIENT_ID or SENDPULSE_CLIENT_SECRET env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  try {
    const token = await getToken();

    // Bulk: array of recipients — send individually so each gets a personalised To header
    if (Array.isArray(to)) {
      let sent = 0, failed = 0, errors = [];
      for (const recipient of to) {
        try {
          await sendOne(token, recipient, subject, html, fromEmail, fromName);
          sent++;
        } catch(e) {
          failed++;
          errors.push({ recipient, error: e.message });
          console.error('[send-email] failed for', recipient, e.message);
        }
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, sent, failed, errors }),
      };
    }

    // Single recipient
    await sendOne(token, to, subject, html, fromEmail, fromName);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, sent: 1, failed: 0 }),
    };

  } catch(e) {
    console.error('[send-email] error:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
};
