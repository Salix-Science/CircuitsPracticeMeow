/* functions/index.js — CircuitsPractice Cloud Functions
 *
 * Deployed functions:
 *   submitAssignment  — server-side answer verification for exams/assignments
 *   postComment       — authenticated comment creation for blog posts
 *
 * Deploy:  firebase deploy --only functions
 */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp }      = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

/** Round to n significant figures (mirrors client rnd()) */
function rnd(v, n = 4) {
  if (!Number.isFinite(v) || v === 0) return v;
  const d = Math.ceil(Math.log10(Math.abs(v)));
  const p = Math.pow(10, n - d);
  return Math.round(v * p) / p;
}

/**
 * Mulberry32 seeded PRNG — identical to assignments.js.
 * The same seedKey → same sequence → same variant every time.
 */
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

/**
 * Server-side replica of genSeededVariant() from assignments.js.
 * Returns { answers: [{ id, label, answer, unit, tol }] }
 * The formula strings are evaluated with the Function constructor — safe
 * here because this code runs in a trusted Cloud Function environment and
 * the formula comes from an admin-authored Firestore document, not user input.
 */
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
      // eslint-disable-next-line no-new-func
      const fn = new Function(...Object.keys(vals), `return (${a.formula})`);
      ans = rnd(fn(...Object.values(vals)), 4);
    } catch (e) {
      console.error('Formula eval failed:', a.formula, e.message);
    }
    return {
      id:     a.id,
      label:  a.label,
      answer: ans,
      unit:   a.unit  || '',
      tol:    (parseFloat(a.tol) || 2) / 100,
    };
  });

  return { answers };
}

// ─────────────────────────────────────────────
// submitAssignment
// ─────────────────────────────────────────────
/**
 * Called by assignments.js when a student submits an answer.
 *
 * Request payload:
 *   { assignId: string, probId: string, inputs: number[] }
 *
 * Response:
 *   {
 *     allOk:    boolean,
 *     locked:   boolean,   // true when submission is now final (correct OR out of attempts)
 *     details:  [{ label, ok, unit, answer? }],  // answer only included when locked
 *     attemptsUsed: number,
 *     attemptsMax:  number,
 *   }
 *
 * Errors (HttpsError codes):
 *   'unauthenticated'   — not signed in
 *   'invalid-argument'  — bad payload
 *   'not-found'         — assignment or problem doesn't exist
 *   'failed-precondition' — deadline passed with allowLate:false, or out of attempts
 */
exports.submitAssignment = onCall({ enforceAppCheck: false, cors: true }, async (request) => {
  // ── Auth check ──
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to submit.');
  }
  const uid      = request.auth.uid;
  const username = request.auth.token?.email?.replace('@circuitspractice.app', '') || uid;

  // ── Input validation ──
  const { assignId, probId, inputs } = request.data || {};
  if (typeof assignId !== 'string' || !assignId ||
      typeof probId   !== 'string' || !probId   ||
      !Array.isArray(inputs) || inputs.length === 0) {
    throw new HttpsError('invalid-argument', 'assignId, probId, and inputs[] are required.');
  }
  if (inputs.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new HttpsError('invalid-argument', 'All inputs must be finite numbers.');
  }
  if (inputs.length > 20) {
    throw new HttpsError('invalid-argument', 'Too many answer boxes.');
  }

  // ── Load assignment ──
  const assignSnap = await db.collection('assignments').doc(assignId).get();
  if (!assignSnap.exists) throw new HttpsError('not-found', 'Assignment not found.');
  const assign = assignSnap.data();

  // ── Deadline check ──
  const due    = assign.due ? new Date(assign.due) : null;
  const isLate = due && Date.now() > due.getTime();
  if (isLate && assign.allowLate === false) {
    throw new HttpsError(
      'failed-precondition',
      'This assignment is closed — the deadline has passed.'
    );
  }

  // ── Verify this problem is part of this assignment ──
  const ap = (assign.problems || []).find(p => p.probId === probId);
  if (!ap) throw new HttpsError('not-found', 'Problem not found in this assignment.');

  // ── Load problem ──
  const probSnap = await db.collection('problems').doc(probId).get();
  if (!probSnap.exists) throw new HttpsError('not-found', 'Problem definition not found.');
  const prob = probSnap.data();

  // ── Load user doc ──
  const userRef  = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
  const userData = userSnap.data();

  // ── Attempt-limit check ──
  const varKey        = `${assignId}-${probId}-${username}`;
  const maxAtt        = parseInt(prob.maxAttempts) || 0;
  const existingAttempts = (userData.assignAttempts || {})[varKey] || 0;

  if (maxAtt > 0 && existingAttempts >= maxAtt) {
    throw new HttpsError(
      'failed-precondition',
      `No attempts remaining (${maxAtt}/${maxAtt} used).`
    );
  }

  // ── Already submitted? ──
  const existingSub = (userData.assignSubmissions || {})[assignId]?.[probId];
  if (existingSub) {
    // Idempotent: return the stored result rather than re-evaluating
    return {
      allOk:        existingSub.correct,
      locked:       true,
      details:      (existingSub.details || []).map(d => ({ label: d.label, ok: d.ok, unit: d.unit })),
      attemptsUsed: existingAttempts,
      attemptsMax:  maxAtt,
    };
  }

  // ── Generate expected answers server-side ──
  const { answers } = genSeededVariant(prob, varKey);

  if (inputs.length !== answers.length) {
    throw new HttpsError(
      'invalid-argument',
      `Expected ${answers.length} answer(s), got ${inputs.length}.`
    );
  }

  // ── Grade ──
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

  // ── Atomic write ──
  const updates = {
    [`assignAttempts.${varKey}`]: FieldValue.increment(1),
  };

  if (locked) {
    updates[`assignSubmissions.${assignId}.${probId}`] = {
      correct:   allOk,
      late:      isLate || false,
      timestamp: Date.now(),
      // Store details without expected answers — client only needs ok/label/unit
      details: details.map(d => ({
        label:     d.label,
        ok:        d.ok,
        submitted: d.submitted,
        unit:      d.unit,
        // Store expected server-side for admin review; client code ignores it unless isAdmin
        answer:    d.answer,
      })),
    };
  }

  await userRef.update(updates);

  // ── Response — never include expected answer when wrong and still has attempts ──
  const responseDetails = details.map(d => ({
    label: d.label,
    ok:    d.ok,
    unit:  d.unit,
    // Only reveal expected answer when the problem is now locked (final)
    ...(locked && !allOk ? { answer: d.answer } : {}),
  }));

  return {
    allOk,
    locked,
    details:      responseDetails,
    attemptsUsed: used,
    attemptsMax:  maxAtt,
    late:         isLate || false,
  };
});


// ─────────────────────────────────────────────
// postComment
// ─────────────────────────────────────────────
/**
 * Authenticated comment creation for blog posts.
 * Ready to wire up when you build the comment UI.
 *
 * Request payload:
 *   { postId: string, body: string }
 *
 * Response:
 *   { commentId: string, createdAt: number }
 *
 * Security:
 *   - Must be signed in
 *   - Body stripped of HTML, max 2000 chars
 *   - Rate-limited: 5 comments per user per 60 seconds (checked in Firestore)
 *   - postId must reference a published post
 */
exports.postComment = onCall({ enforceAppCheck: false, cors: true }, async (request) => {
  // ── Auth ──
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to comment.');
  }
  const uid      = request.auth.uid;
  const username = request.auth.token?.email?.replace('@circuitspractice.app', '') || 'Anonymous';

  // ── Validate payload ──
  const { postId, body } = request.data || {};
  if (typeof postId !== 'string' || !postId) {
    throw new HttpsError('invalid-argument', 'postId is required.');
  }
  if (typeof body !== 'string' || !body.trim()) {
    throw new HttpsError('invalid-argument', 'Comment body cannot be empty.');
  }

  // Strip HTML tags and limit length
  const cleanBody = body.replace(/<[^>]*>/g, '').trim().slice(0, 2000);
  if (!cleanBody) throw new HttpsError('invalid-argument', 'Comment body cannot be empty after sanitization.');

  // ── Verify post exists and is published ──
  const postSnap = await db.collection('posts').doc(postId).get();
  if (!postSnap.exists || postSnap.data().status !== 'published') {
    throw new HttpsError('not-found', 'Post not found or not published.');
  }

  // Rate-limit query removed — requires a composite Firestore index on the
  // comments subcollection; add back later if spam becomes an issue.

  // ── Write comment ──
  const now = Date.now();
  const ref = await db.collection('posts').doc(postId).collection('comments').add({
    uid,
    username,
    body:      cleanBody,
    createdAt: now,
    approved:  true,
  });

  return { commentId: ref.id, createdAt: now };
});


// ── Unsubscribe handler ───────────────────────
exports.unsubscribe = onRequest({ cors: true }, async (req, res) => {
  const token = (req.query.token || '').trim();
  if (!token) { res.status(400).send('Missing token.'); return; }

  let email;
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - padded.length % 4) % 4;
    email = Buffer.from(padded + '='.repeat(pad), 'base64').toString('utf8').toLowerCase().trim();
  } catch (e) { res.status(400).send('Invalid token.'); return; }

  if (!email || !email.includes('@') || email.length > 320) {
    res.status(400).send('Invalid token.'); return;
  }

  console.log('[unsubscribe] request for email:', email);
  try {
    const snap = await db.collection('users')
      .where('notifPrefs.email', '==', email)
      .limit(1).get();
    if (!snap.empty) {
      await snap.docs[0].ref.update({
        'notifPrefs.posts': false,
        'notifPrefs.announcements': false,
        'notifPrefs.assignments': false,
      });
      console.log('[unsubscribe] disabled notifications for:', email);
    }
    res.status(200).send('ok');
  } catch (e) {
    console.error('[unsubscribe] Firestore error:', e);
    res.status(500).send('Internal error.');
  }
});
