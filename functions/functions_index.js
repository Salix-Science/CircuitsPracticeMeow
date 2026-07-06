/* functions/index.js — CircuitsPractice Cloud Functions */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp }      = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth }                  = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();

function rnd(v, n = 4) {
  if (!Number.isFinite(v) || v === 0) return v;
  const d = Math.ceil(Math.log10(Math.abs(v)));
  const p = Math.pow(10, n - d);
  return Math.round(v * p) / p;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

function genSeededVariant(prob, seedKey) {
  const rand = mulberry32(hashString(seedKey));
  const vals = {};
  (prob.vars || []).forEach(v => {
    const min = parseFloat(v.min), max = parseFloat(v.max);
    vals[v.name] = Math.round((min + rand() * (max - min)) * 10) / 10;
  });
  const answerDefs = (prob.answers && prob.answers.length)
    ? prob.answers
    : [{ id: 'ans0', label: 'Answer', formula: prob.formula, unit: prob.unit, tol: prob.tol }];
  const answers = answerDefs.map(a => {
    let ans = null;
    try {
      const fn = new Function(...Object.keys(vals), `return (${a.formula})`); // eslint-disable-line no-new-func
      ans = rnd(fn(...Object.values(vals)), 4);
    } catch (e) {
      console.error('Formula eval failed:', a.formula, e.message);
    }
    return { id: a.id, label: a.label, answer: ans, unit: a.unit || '', tol: (parseFloat(a.tol) || 2) / 100 };
  });
  return { answers };
}

exports.submitAssignment = onCall({ enforceAppCheck: false, cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in to submit.');
  const uid = request.auth.uid;

  // ── Input validation ──
  const { assignId, probId, inputs } = request.data || {};
  if (typeof assignId !== 'string' || !assignId ||
      typeof probId   !== 'string' || !probId   ||
      !Array.isArray(inputs) || inputs.length === 0)
    throw new HttpsError('invalid-argument', 'assignId, probId, and inputs[] are required.');
  if (inputs.some(v => typeof v !== 'number' || !Number.isFinite(v)))
    throw new HttpsError('invalid-argument', 'All inputs must be finite numbers.');
  if (inputs.length > 20)
    throw new HttpsError('invalid-argument', 'Too many answer boxes.');

  // ── Load assignment and problem (outside transaction — these are read-only) ──
  const assignSnap = await db.collection('assignments').doc(assignId).get();
  if (!assignSnap.exists) throw new HttpsError('not-found', 'Assignment not found.');
  const assign = assignSnap.data();

  const due    = assign.due ? new Date(assign.due) : null;
  const isLate = due && Date.now() > due.getTime();
  if (isLate && assign.allowLate === false)
    throw new HttpsError('failed-precondition', 'This assignment is closed — the deadline has passed.');

  const ap = (assign.problems || []).find(p => p.probId === probId);
  if (!ap) throw new HttpsError('not-found', 'Problem not found in this assignment.');

  const probSnap = await db.collection('problems').doc(probId).get();
  if (!probSnap.exists) throw new HttpsError('not-found', 'Problem definition not found.');
  const prob = probSnap.data();

  const maxAtt = parseInt(prob.maxAttempts) || 0;

  // ── Grade answers (pure computation, no Firestore needed) ──
  // Done outside the transaction so the transaction body stays minimal.
  // We need username first — read it inside the transaction below.

  const userRef = db.collection('users').doc(uid);

  // ── Transaction: fresh read → check → grade → write ──
  // Running the attempt check and the increment inside a single transaction
  // guarantees the read is never served from cache. The Admin SDK always does
  // a strong (server) read inside a transaction, so concurrent rapid submits
  // can never both see existingAttempts=0 and both think they have attempts left.
  let result;
  try {
    result = await db.runTransaction(async (txn) => {
      const userSnap = await txn.get(userRef);
      if (!userSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
      const userData = userSnap.data();
      const username = userData.username || uid;

      // varKey must match client: assignId-probId-username
      const varKey           = `${assignId}-${probId}-${username}`;
      const existingAttempts = (userData.assignAttempts || {})[varKey] || 0;
      console.log('[submitAssignment] txn read — varKey:', varKey,
                  'existingAttempts:', existingAttempts, 'maxAtt:', maxAtt);

      if (maxAtt > 0 && existingAttempts >= maxAtt)
        throw new HttpsError('failed-precondition', `No attempts remaining (${maxAtt}/${maxAtt} used).`);

      // Already locked (correct or out of attempts on a previous submit)?
      const existingSub = (userData.assignSubmissions || {})[assignId]?.[probId];
      if (existingSub) {
        // Return without writing — txn.get() already happened, that's fine.
        return {
          allOk:        existingSub.correct,
          locked:       true,
          details:      (existingSub.details || []).map(d => ({ label: d.label, ok: d.ok, unit: d.unit })),
          attemptsUsed: existingAttempts,
          attemptsMax:  maxAtt,
          username,
          varKey,
          skippedWrite: true,
        };
      }

      // Grade
      const { answers } = genSeededVariant(prob, varKey);
      if (inputs.length !== answers.length)
        throw new HttpsError('invalid-argument', `Expected ${answers.length} answer(s), got ${inputs.length}.`);

      const details = answers.map((a, i) => {
        const raw = inputs[i];
        const tol = Math.abs(a.answer) * (a.tol || 0.02) + 0.001;
        const ok  = Math.abs(raw - a.answer) <= tol;
        return { label: a.label, ok, submitted: rnd(raw, 4), answer: a.answer, unit: a.unit };
      });
      const allOk  = details.every(d => d.ok);
      const used   = existingAttempts + 1;
      const noMore = maxAtt > 0 && used >= maxAtt;
      const locked = allOk || noMore;

      // Write inside the transaction — atomic with the read above
      const updates = { [`assignAttempts.${varKey}`]: FieldValue.increment(1) };
      if (locked) {
        updates[`assignSubmissions.${assignId}.${probId}`] = {
          correct: allOk, late: isLate || false, timestamp: Date.now(),
          details: details.map(d => ({ label: d.label, ok: d.ok, submitted: d.submitted, unit: d.unit, answer: d.answer })),
        };
      }
      txn.update(userRef, updates);
      console.log('[submitAssignment] txn write — varKey:', varKey, 'used:', used, 'locked:', locked);

      return { allOk, locked, details, used, maxAtt, username, varKey, skippedWrite: false };
    });
  } catch (e) {
    // Re-throw HttpsErrors as-is; wrap anything else
    if (e instanceof HttpsError) throw e;
    console.error('[submitAssignment] transaction failed:', e);
    throw new HttpsError('internal', 'Submission failed — please try again.');
  }

  // Already-submitted fast path
  if (result.skippedWrite) {
    return {
      allOk:        result.allOk,
      locked:       result.locked,
      details:      result.details,
      attemptsUsed: result.attemptsUsed,
      attemptsMax:  result.attemptsMax,
      late:         isLate || false,
    };
  }

  const responseDetails = result.details.map(d => ({
    label: d.label, ok: d.ok, unit: d.unit,
    ...(result.locked && !result.allOk ? { answer: d.answer } : {}),
  }));

  return {
    allOk:        result.allOk,
    locked:       result.locked,
    details:      responseDetails,
    attemptsUsed: result.used,
    attemptsMax:  result.maxAtt,
    late:         isLate || false,
  };
});


exports.postComment = onCall({ enforceAppCheck: false, cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in to comment.');
  const uid = request.auth.uid;

  // Load username from Firestore for consistency
  const userSnap = await db.collection('users').doc(uid).get();
  const username = userSnap.exists ? (userSnap.data().username || 'Anonymous') : 'Anonymous';

  const { postId, body } = request.data || {};
  if (typeof postId !== 'string' || !postId) throw new HttpsError('invalid-argument', 'postId is required.');
  if (typeof body !== 'string' || !body.trim()) throw new HttpsError('invalid-argument', 'Comment body cannot be empty.');

  const cleanBody = body.replace(/<[^>]*>/g, '').trim().slice(0, 2000);
  if (!cleanBody) throw new HttpsError('invalid-argument', 'Comment body cannot be empty after sanitization.');

  const postSnap = await db.collection('posts').doc(postId).get();
  if (!postSnap.exists || postSnap.data().status !== 'published')
    throw new HttpsError('not-found', 'Post not found or not published.');

  const cutoff = Date.now() - 60_000;
  const recentQSnap = await db.collection('posts').doc(postId).collection('comments')
    .where('uid', '==', uid).where('createdAt', '>', cutoff).get();
  if (recentQSnap.size >= 5) throw new HttpsError('resource-exhausted', 'You\'re posting too quickly — wait a moment.');

  const now = Date.now();
  const ref = await db.collection('posts').doc(postId).collection('comments').add(
    { uid, username, body: cleanBody, createdAt: now, approved: false });
  return { commentId: ref.id, createdAt: now };
});


/* ──────────────────────────────────────────────────────────────────────────
   Custom transactional email (verification / password reset)
   Firebase Auth's built-in templates are locked to a few fields, so instead we
   generate the action link with the Admin SDK (which SENDS nothing) and enqueue
   our own inline-HTML email into the `mail` collection. The Trigger Email
   extension delivers it via Zoho. Full control of subject + HTML.
   ────────────────────────────────────────────────────────────────────────── */

// Where the user lands AFTER completing the action.
// Must be listed under Auth → Settings → Authorized domains.
const ACTION_CONTINUE_URL = 'https://circuitspractice.org';

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emailShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:32px;background:#0f1115;font-family:'IBM Plex Sans',Arial,sans-serif">
  <table role="presentation" width="100%" style="max-width:520px;margin:auto;background:#161a20;border:1px solid #2a2f3a;border-radius:12px;overflow:hidden">
    <tr><td style="background:#b87333;height:4px"></td></tr>
    <tr><td style="padding:32px">
      <h1 style="margin:0 0 12px;color:#e8eaed;font-family:'Space Grotesk',sans-serif;font-size:22px">${esc(title)}</h1>
      ${bodyHtml}
    </td></tr>
  </table>
</body></html>`;
}

function ctaButton(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;margin:8px 0 4px;background:#b87333;color:#0f1115;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px">${esc(label)}</a>`;
}

function buildVerifyHtml(firstName, link) {
  return emailShell('Verify your email', `
      <p style="margin:0 0 20px;color:#aab1bd;font-size:15px;line-height:1.5">Hi ${esc(firstName)}, welcome to CircuitsPractice. Confirm your address to activate your account.</p>
      ${ctaButton(link, 'Verify email')}
      <p style="margin:20px 0 0;color:#6b7280;font-size:12px;word-break:break-all">If the button doesn't work, paste this link:<br>${esc(link)}</p>`);
}

function buildResetHtml(firstName, link) {
  return emailShell('Reset your password', `
      <p style="margin:0 0 20px;color:#aab1bd;font-size:15px;line-height:1.5">Hi ${esc(firstName)}, we received a request to reset your CircuitsPractice password. If this was you, click below. If not, you can safely ignore this email.</p>
      ${ctaButton(link, 'Reset password')}
      <p style="margin:20px 0 0;color:#6b7280;font-size:12px;word-break:break-all">If the button doesn't work, paste this link:<br>${esc(link)}</p>`);
}

async function firstNameFor(uid, email) {
  try {
    if (uid) {
      const snap = await db.collection('users').doc(uid).get();
      if (snap.exists) {
        const u = snap.data();
        return u.firstName || u.username || (email || 'there').split('@')[0];
      }
    }
  } catch (_) { /* fall back to email local part */ }
  return (email || 'there').split('@')[0];
}

// Verification — caller must be the signed-in, just-registered user.
exports.sendCustomVerification = onCall({ enforceAppCheck: false, cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const uid   = request.auth.uid;
  const email = request.auth.token.email;
  if (!email) throw new HttpsError('failed-precondition', 'No email is set on this account.');

  const link      = await getAuth().generateEmailVerificationLink(email, { url: ACTION_CONTINUE_URL });
  const firstName = await firstNameFor(uid, email);

  await db.collection('mail').add({
    to: [email],
    message: {
      subject: 'Verify your CircuitsPractice email',
      html: buildVerifyHtml(firstName, link),
      text: `Hi ${firstName}, verify your CircuitsPractice account: ${link}`,
    },
  });
  console.log('[sendCustomVerification] enqueued for', email);
  return { ok: true };
});

// Password reset — unauthenticated by design (the user forgot their password).
// Enumeration-safe: always returns { ok: true } and never reveals whether the
// account exists.
exports.sendCustomPasswordReset = onCall({ enforceAppCheck: false, cors: true }, async (request) => {
  const email = String((request.data && request.data.email) || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new HttpsError('invalid-argument', 'A valid email is required.');

  try {
    const link      = await getAuth().generatePasswordResetLink(email, { url: ACTION_CONTINUE_URL });
    const firstName = email.split('@')[0] || 'there';
    await db.collection('mail').add({
      to: [email],
      message: {
        subject: 'Reset your CircuitsPractice password',
        html: buildResetHtml(firstName, link),
        text: `Hi ${firstName}, reset your CircuitsPractice password: ${link}`,
      },
    });
    console.log('[sendCustomPasswordReset] enqueued for', email);
  } catch (e) {
    // Stay silent on unknown accounts to prevent enumeration.
    if (e.code !== 'auth/user-not-found') console.error('[sendCustomPasswordReset]', e);
  }
  return { ok: true };
});
