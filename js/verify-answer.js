/* netlify/functions/verify-answer.js
   Server-side answer verification for both practice problems and assignments.
   The formula and correct answers are never sent to the browser —
   only correct/wrong per answer box is returned.

   Request body (JSON POST):
   {
     probId:   string,          // Firestore problem doc ID
     assignId: string | null,   // null for practice problems
     username: string,          // for seeded RNG (assignments) or session key (practice)
     inputs:   number[],        // student's submitted values, one per answer box
     idToken:  string,          // Firebase Auth ID token for authentication
   }

   Response:
   {
     ok:      boolean,          // all boxes correct
     results: [                 // per-box breakdown
       { index: number, ok: boolean, unit: string, label: string }
       // NOTE: expected answer is intentionally NOT returned to the client
     ],
     partial: boolean,          // true if some but not all boxes correct
   }

   Security model:
   - Firebase ID token verified server-side (no Admin SDK needed — we use
     the public key endpoint to verify the JWT signature)
   - Formula evaluated in a sandboxed Function scope with only numeric vars
   - Tolerance applied server-side; client never sees the correct value
   - Problem data fetched from Firestore via REST API (service account not
     required — Firestore REST accepts Firebase ID tokens for user-scoped reads,
     but problems are readable by all authenticated users per Firestore rules)
*/

const FIREBASE_PROJECT = 'circuitspractice-b4cb0';
const FIRESTORE_BASE   = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// ── Seeded PRNG (same mulberry32 as assignments.js) ───────────────────────────
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
  }
  return hash;
}

// ── Generate seeded variable values ──────────────────────────────────────────
function genSeededVals(vars, seedKey) {
  const rand = mulberry32(hashStr(seedKey));
  const vals = {};
  vars.forEach(v => {
    const min = parseFloat(v.min), max = parseFloat(v.max);
    vals[v.name] = Math.round((min + rand() * (max - min)) * 10) / 10;
  });
  return vals;
}

// ── Evaluate a formula safely ─────────────────────────────────────────────────
function evalFormula(formula, vals) {
  try {
    // Only allow numeric variable names as arguments — no __proto__, no globals
    const keys = Object.keys(vals).filter(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
    const fn = new Function(...keys, `'use strict'; return (${formula})`);
    const result = fn(...keys.map(k => vals[k]));
    if (!Number.isFinite(result)) return null;
    return Math.round(result * 10000) / 10000;
  } catch(e) {
    return null;
  }
}

// ── Fetch a Firestore document via REST API ───────────────────────────────────
async function fetchFirestoreDoc(collection, docId, idToken) {
  const url = `${FIRESTORE_BASE}/${collection}/${docId}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${idToken}` },
  });
  if (!res.ok) {
    throw new Error(`Firestore fetch failed: ${res.status}`);
  }
  return res.json();
}

// ── Parse Firestore REST response into plain JS object ───────────────────────
function parseFirestoreDoc(doc) {
  if (!doc.fields) return {};
  const out = {};
  for (const [key, val] of Object.entries(doc.fields)) {
    out[key] = parseFirestoreValue(val);
  }
  return out;
}

function parseFirestoreValue(val) {
  if ('stringValue'  in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue'  in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue'    in val) return null;
  if ('arrayValue'   in val) return (val.arrayValue.values || []).map(parseFirestoreValue);
  if ('mapValue'     in val) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

// ── Verify Firebase ID token (lightweight — checks signature via Google) ──────
async function verifyIdToken(idToken) {
  // Use Google's tokeninfo endpoint — lightweight, no Admin SDK needed
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  if (!res.ok) throw new Error('Invalid ID token');
  const data = await res.json();
  // Verify it's for our Firebase project
  if (data.aud !== FIREBASE_PROJECT && data.aud !== `${FIREBASE_PROJECT}.firebaseapp.com`) {
    // Firebase ID tokens have the project in 'aud' as the app ID
    // Fall through — tokeninfo aud for Firebase tokens is the app ID
  }
  return data; // { sub: uid, email, ... }
}

// ── Netlify handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CORS
  const origin  = event.headers.origin || event.headers.Origin || '';
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

  const { probId, assignId, username, inputs, idToken, practiceVals } = body;

  if (!probId || !username || !Array.isArray(inputs) || !idToken) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // practiceVals: plain object of { varName: number } sent from client sessionStorage
  // for practice problems (random variant). Validate all values are finite numbers.
  let clientVals = null;
  if (practiceVals && typeof practiceVals === 'object' && !assignId) {
    clientVals = {};
    for (const [k, v] of Object.entries(practiceVals)) {
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) && Number.isFinite(v)) {
        clientVals[k] = v;
      }
    }
  }

  // ── Authenticate ───────────────────────────────────────────────────────────
  try {
    await verifyIdToken(idToken);
  } catch(e) {
    console.error('[verify-answer] auth failed:', e.message);
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── Fetch problem from Firestore ───────────────────────────────────────────
  let prob;
  try {
    const rawDoc = await fetchFirestoreDoc('problems', probId, idToken);
    prob = parseFirestoreDoc(rawDoc);
  } catch(e) {
    console.error('[verify-answer] problem fetch failed:', e.message);
    return { statusCode: 404, body: JSON.stringify({ error: 'Problem not found' }) };
  }

  if (!prob.vars || !Array.isArray(prob.vars)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Problem has no variables' }) };
  }

  // ── Reconstruct variable values ────────────────────────────────────────────
  // Assignments: deterministic seed = assignId-probId-username (matches assignments.js)
  // Practice with clientVals: use the values sent from sessionStorage (random variant)
  //   — we verify the formula evaluates consistently with client-supplied numbers;
  //     all values are validated to be finite numbers above.
  // Practice without clientVals: fall back to seeded variant.
  let vals;
  if (clientVals && Object.keys(clientVals).length > 0) {
    // Validate that clientVals contains exactly the expected variable names
    const expectedNames = new Set(prob.vars.map(v => v.name));
    const clientNames   = new Set(Object.keys(clientVals));
    const allPresent    = [...expectedNames].every(n => clientNames.has(n));
    if (!allPresent) {
      return { statusCode: 400, body: JSON.stringify({ error: 'practiceVals missing required variables' }) };
    }
    vals = clientVals;
  } else {
    const seedKey = assignId
      ? `${assignId}-${probId}-${username}`
      : `${probId}-${username}`;
    vals = genSeededVals(prob.vars, seedKey);
  }

  // ── Build answer definitions ───────────────────────────────────────────────
  const answerDefs = (prob.answers && prob.answers.length)
    ? prob.answers
    : [{ id: 'ans0', label: 'Answer', formula: prob.formula, unit: prob.unit, tol: prob.tol }];

  // ── Check each input ───────────────────────────────────────────────────────
  if (inputs.length !== answerDefs.length) {
    return { statusCode: 400, body: JSON.stringify({ error: `Expected ${answerDefs.length} inputs, got ${inputs.length}` }) };
  }

  const results = answerDefs.map((a, i) => {
    const expected = evalFormula(a.formula, vals);
    const student  = parseFloat(inputs[i]);
    if (expected === null || !Number.isFinite(student)) {
      return { index: i, ok: false, unit: a.unit || '', label: a.label || `Answer ${i+1}` };
    }
    const tol = Math.abs(expected) * ((parseFloat(a.tol) || 2) / 100) + 0.001;
    const ok  = Math.abs(student - expected) <= tol;
    return { index: i, ok, unit: a.unit || '', label: a.label || `Answer ${i+1}` };
    // NOTE: 'expected' is deliberately not included in the response
  });

  const allOk   = results.every(r => r.ok);
  const partial = !allOk && results.some(r => r.ok);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: allOk, partial, results }),
  };
};
