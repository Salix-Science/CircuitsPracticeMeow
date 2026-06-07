/* functions/index.js — CircuitsPractice Cloud Functions */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp }      = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

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

  // ── Load user doc first — username comes from Firestore, NOT from Auth email ──
  // Real-email accounts (dtp23003@uconn.edu) don't have @circuitspractice.app
  // to strip, so deriving username from the token email gives the wrong varKey.
  const userRef  = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
  const userData = userSnap.data();
  const username = userData.username || uid;
  console.log('[submitAssignment] uid:', uid, 'username:', username);

  // ── Load assignment ──
  const assignSnap = await db.collection('assignments').doc(assignId).get();
  if (!assignSnap.exists) throw new HttpsError('not-found', 'Assignment not found.');
  const assign = assignSnap.data();

  // ── Deadline check ──
  const due    = assign.due ? new Date(assign.due) : null;
  const isLate = due && Date.now() > due.getTime();
  if (isLate && assign.allowLate === false)
    throw new HttpsError('failed-precondition', 'This assignment is closed — the deadline has passed.');

  // ── Verify problem is in assignment ──
  const ap = (assign.problems || []).find(p => p.probId === probId);
  if (!ap) throw new HttpsError('not-found', 'Problem not found in this assignment.');

  // ── Load problem ──
  const probSnap = await db.collection('problems').doc(probId).get();
  if (!probSnap.exists) throw new HttpsError('not-found', 'Problem definition not found.');
  const prob = probSnap.data();

  // ── varKey must match client: assignId-probId-username ──
  const varKey           = `${assignId}-${probId}-${username}`;
  const maxAtt           = parseInt(prob.maxAttempts) || 0;
  const existingAttempts = (userData.assignAttempts || {})[varKey] || 0;
  console.log('[submitAssignment] varKey:', varKey, 'existingAttempts:', existingAttempts, 'maxAtt:', maxAtt);

  if (maxAtt > 0 && existingAttempts >= maxAtt)
    throw new HttpsError('failed-precondition', `No attempts remaining (${maxAtt}/${maxAtt} used).`);

  // ── Already submitted? ──
  const existingSub = (userData.assignSubmissions || {})[assignId]?.[probId];
  if (existingSub) {
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
  if (inputs.length !== answers.length)
    throw new HttpsError('invalid-argument', `Expected ${answers.length} answer(s), got ${inputs.length}.`);

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

  // ── Atomic Firestore write ──
  const updates = { [`assignAttempts.${varKey}`]: FieldValue.increment(1) };
  if (locked) {
    updates[`assignSubmissions.${assignId}.${probId}`] = {
      correct: allOk, late: isLate || false, timestamp: Date.now(),
      details: details.map(d => ({ label: d.label, ok: d.ok, submitted: d.submitted, unit: d.unit, answer: d.answer })),
    };
  }
  await userRef.update(updates);
  console.log('[submitAssignment] wrote varKey:', varKey, 'used:', used, 'locked:', locked);

  const responseDetails = details.map(d => ({
    label: d.label, ok: d.ok, unit: d.unit,
    ...(locked && !allOk ? { answer: d.answer } : {}),
  }));

  return { allOk, locked, details: responseDetails, attemptsUsed: used, attemptsMax: maxAtt, late: isLate || false };
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
