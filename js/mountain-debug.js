/* mountain-debug.js — TEMPORARY diagnostic instrumentation for the mountain trail.
   BUILD TAG: MDBG-2026-07-28-a

   Purpose: find out why solving a practice problem does not advance the student
   on the mountain. Instruments the whole solve → record → persist → render chain
   without modifying any existing file.

   Install: add 'js/mountain-debug.js' to featureScripts in main.js (anywhere in
   the array — it self-defers its hooks until the other scripts have loaded).
   Remove the entry once the bug is fixed.

   Console API:
     MDBG.report()          full timeline + current state fingerprint
     MDBG.snapshot()        current mountain-relevant user state
     MDBG.probe('probId')   search the entire user object for that problem id
     MDBG.mountainGlobals() list every window.* that looks mountain-related
     MDBG.diffLast()        what changed on the user object across the last solve
     MDBG.panel()           toggle the on-screen event panel
     MDBG.swInfo()          service worker / cache state check (stale-JS suspect)
*/
(function () {
  'use strict';

  const TAG = 'MDBG-2026-07-28-a';
  const log = (...a) => console.log('%c[MDBG]', 'color:#e0a458;font-weight:700', ...a);
  const warn = (...a) => console.warn('%c[MDBG]', 'color:#e0a458;font-weight:700', ...a);
  const err = (...a) => console.error('%c[MDBG]', 'color:#e0a458;font-weight:700', ...a);

  const MDBG = (window.MDBG = {
    tag: TAG,
    events: [],
    hooked: [],
    missing: [],
    lastSolve: null,
    _before: null,
    _after: null,
  });

  log('loaded', TAG);

  // ── Fields sanitizeUser is known to whitelist. Anything on the user object
  //    NOT in this list is either a new field (good — mountain state?) or a
  //    field that will be silently dropped on the next Firestore read.
  const KNOWN_USER_KEYS = new Set([
    'name', 'username', 'email', 'role', 'isAdmin', 'section', 'scores',
    'assignSubmissions', 'assignAttempts', 'attemptLog', 'streak', 'diffRatings',
    'notifPrefs', 'selfRegistered', 'manualGrades', 'created', 'lastSeen',
    'uid', 'photo', 'bio',
  ]);

  function user() {
    try { return window.DB?.users?.[window.S?.user] || null; } catch (e) { return null; }
  }

  function push(type, data) {
    const e = { t: new Date().toISOString().slice(11, 23), type, data };
    MDBG.events.push(e);
    if (MDBG.events.length > 500) MDBG.events.shift();
    paintPanel(e);
    return e;
  }

  // ── State fingerprint ──────────────────────────────────────────────────────
  MDBG.snapshot = function snapshot(quiet) {
    const u = user();
    if (!u) { if (!quiet) warn('no user loaded (window.DB.users[window.S.user] is empty)'); return null; }

    const scores = u.scores || {};
    const alog = Array.isArray(u.attemptLog) ? u.attemptLog : [];
    const correctIds = [...new Set(alog.filter(e => e && e.correct).map(e => e.probId).filter(Boolean))];
    const practiceIds = [...new Set(alog.filter(e => e && !e.assignId).map(e => e.probId).filter(Boolean))];

    const snap = {
      username: window.S?.user,
      uid: window.S?.uid,
      totalCorrect: Object.values(scores).reduce((s, v) => s + (v.correct || 0), 0),
      totalAttempted: Object.values(scores).reduce((s, v) => s + (v.attempted || 0), 0),
      scoreKeys: Object.keys(scores),
      attemptLogLen: alog.length,
      attemptLogLast: alog.slice(-3),
      distinctCorrectProbIds: correctIds,
      practiceOnlyProbIds: practiceIds,
      assignSubmissionCount: Object.keys(u.assignSubmissions || {}).length,
      // Any field on the user object that sanitizeUser doesn't whitelist. If the
      // mountain persists its own state (e.g. u.trail / u.mountain / u.solved),
      // it will show up here — and it will be WIPED on the next page load unless
      // it's added to sanitizeUser AND saveUserOnly.
      unknownUserFields: Object.keys(u).filter(k => !KNOWN_USER_KEYS.has(k)),
    };
    if (!quiet) {
      log('snapshot:', snap);
      if (snap.unknownUserFields.length) {
        warn('user fields NOT in the sanitizeUser whitelist (will be dropped on reload):',
          snap.unknownUserFields);
      }
      if (!snap.distinctCorrectProbIds.length && snap.totalCorrect > 0) {
        warn('scores show ' + snap.totalCorrect + ' correct, but attemptLog contains ZERO ' +
          'correct entries with a probId. If the mountain keys nodes by problem id, ' +
          'it has nothing to light up. <-- prime suspect');
      }
    }
    return snap;
  };

  MDBG.probe = function probe(probId) {
    const u = user();
    if (!u) return warn('no user');
    const hits = [];
    (function walk(o, path, depth) {
      if (depth > 6 || o == null) return;
      if (typeof o === 'string') { if (o === probId) hits.push(path); return; }
      if (typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        if (k === probId) hits.push(path + '.' + k + '  (as KEY)');
        walk(o[k], path + '.' + k, depth + 1);
      }
    })(u, 'user', 0);
    if (hits.length) log('probId "' + probId + '" found at:', hits);
    else warn('probId "' + probId + '" appears NOWHERE in the user object. ' +
      'Nothing persisted per-problem for this solve.');
    return hits;
  };

  MDBG.mountainGlobals = function () {
    const keys = Object.keys(window).filter(k => /mountain|trail|climb|summit|peak/i.test(k));
    log('mountain-ish globals:', keys.length ? keys : '(none — is mountain.js loaded? check main.js featureScripts)');
    return keys;
  };

  // ── Hooking ────────────────────────────────────────────────────────────────
  function wrap(name, opts) {
    opts = opts || {};
    const fn = window[name];
    if (typeof fn !== 'function') { MDBG.missing.push(name); return false; }
    if (fn.__mdbg) return true;
    const wrapped = function (...args) {
      const before = opts.solve ? MDBG.snapshot(true) : null;
      push('call:' + name, { args: args.map(safeArg) });
      let out;
      try {
        out = fn.apply(this, args);
      } catch (e) {
        err(name + ' THREW:', e);
        push('throw:' + name, { message: String(e && e.message) });
        throw e;
      }
      if (out && typeof out.then === 'function') {
        out.then(
          v => { push('resolve:' + name, {}); if (opts.solve) afterSolve(name, before); },
          e => { err(name + ' rejected:', e); push('reject:' + name, { message: String(e && e.message) }); }
        );
      } else if (opts.solve) {
        afterSolve(name, before);
      }
      return out;
    };
    wrapped.__mdbg = true;
    window[name] = wrapped;
    MDBG.hooked.push(name);
    return true;
  }

  function safeArg(a) {
    try {
      if (a == null) return a;
      if (typeof a === 'function') return '[fn]';
      if (typeof a === 'object') return JSON.parse(JSON.stringify(a, (k, v) =>
        (typeof v === 'string' && v.length > 120) ? v.slice(0, 120) + '…' : v));
      return a;
    } catch (e) { return '[unserializable]'; }
  }

  function afterSolve(source, before) {
    const after = MDBG.snapshot(true);
    MDBG._before = before; MDBG._after = after;
    MDBG.lastSolve = { at: Date.now(), source };
    const changed = diff(before, after);
    push('solve-effect', { source, changed });
    log('solve recorded via ' + source + ' — state delta:', changed);

    // The core check: did anything re-render the mountain afterwards?
    const seenBefore = MDBG._renderCount || 0;
    setTimeout(() => {
      const seenAfter = MDBG._renderCount || 0;
      if (seenAfter === seenBefore) {
        warn('No mountain render function fired within 1500ms of the solve. ' +
          'Either mountain.js exposes no hooked render fn, or nothing calls it ' +
          'after a solve (it only runs on showView). <-- suspect #2');
      }
    }, 1500);
  }

  function diff(a, b) {
    if (!a || !b) return '(no baseline)';
    const out = {};
    ['totalCorrect', 'totalAttempted', 'attemptLogLen', 'assignSubmissionCount'].forEach(k => {
      if (a[k] !== b[k]) out[k] = a[k] + ' → ' + b[k];
    });
    const newIds = (b.distinctCorrectProbIds || []).filter(x => !(a.distinctCorrectProbIds || []).includes(x));
    if (newIds.length) out.newCorrectProbIds = newIds;
    const newFields = (b.unknownUserFields || []).filter(x => !(a.unknownUserFields || []).includes(x));
    if (newFields.length) out.newUserFields = newFields;
    if (!Object.keys(out).length) {
      out['**NOTHING CHANGED**'] = 'the solve produced no observable change in ' +
        'user state — the mountain has nothing to read. <-- suspect #1';
    }
    return out;
  }

  MDBG.diffLast = () => diff(MDBG._before, MDBG._after);

  // ── Install hooks (retry: feature scripts load in parallel) ────────────────
  let tries = 0;
  const installer = setInterval(install, 400);
  install();

  function install() {
    tries++;
    // Solve-path writers
    wrap('recordCorrect', { solve: true });
    wrap('recordAttempt', {});
    wrap('recordStreak', {});
    wrap('logAttempt', {});
    wrap('saveUserOnly', {});
    wrap('saveUser', {});
    wrap('checkAnswer', {});
    wrap('checkMainAnswer', {});
    wrap('submitAssignmentProblem', {});
    wrap('showView', {});

    // Mountain renderers — discovered dynamically, whatever they're called.
    Object.keys(window).forEach(k => {
      if (!/mountain|trail/i.test(k)) return;
      if (typeof window[k] !== 'function' || window[k].__mdbg) return;
      const orig = window[k];
      const w = function (...args) {
        MDBG._renderCount = (MDBG._renderCount || 0) + 1;
        const snap = MDBG.snapshot(true);
        push('mountain:' + k, {
          renderNo: MDBG._renderCount,
          correctProbIds: snap && snap.distinctCorrectProbIds,
          totalCorrect: snap && snap.totalCorrect,
        });
        log('mountain fn ' + k + '() called — it sees ' +
          ((snap && snap.distinctCorrectProbIds.length) || 0) + ' distinct solved probIds, ' +
          ((snap && snap.totalCorrect) || 0) + ' total correct');
        try { return orig.apply(this, args); }
        catch (e) { err('mountain fn ' + k + ' THREW:', e); throw e; }
      };
      w.__mdbg = true;
      window[k] = w;
      MDBG.hooked.push(k + ' (mountain)');
      log('hooked mountain fn:', k);
    });

    if (tries > 40) { // ~16s
      clearInterval(installer);
      const stillMissing = [...new Set(MDBG.missing)].filter(n => typeof window[n] !== 'function');
      log('hook install finished. hooked:', MDBG.hooked);
      if (stillMissing.length) warn('never appeared on window:', stillMissing);
      if (!MDBG.hooked.some(h => /mountain/i.test(h))) {
        err('NO mountain function was ever found on window. mountain.js is either ' +
          'not in featureScripts in main.js, failed to load (check Network tab for 404), ' +
          'or defines its functions with const/let instead of window.*  <-- suspect #0');
      }
    }
  }

  // ── Service worker / stale JS check ────────────────────────────────────────
  MDBG.swInfo = async function () {
    if (!('serviceWorker' in navigator)) return log('no service worker support');
    const regs = await navigator.serviceWorker.getRegistrations();
    log('SW registrations:', regs.map(r => ({ scope: r.scope, active: r.active && r.active.scriptURL })));
    if (window.caches) {
      const names = await caches.keys();
      log('cache names:', names);
      for (const n of names) {
        const c = await caches.open(n);
        const keys = await c.keys();
        const js = keys.map(k => k.url).filter(u => /\.js(\?|$)/.test(u));
        if (js.length) log('cached JS in "' + n + '":', js);
      }
    }
    log('controlled by SW:', !!navigator.serviceWorker.controller);
    log('To rule out stale JS: MDBG.nukeSW() then hard-reload.');
  };

  MDBG.nukeSW = async function () {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
    log('service workers unregistered and caches cleared — now hard-reload.');
  };

  // ── Report ─────────────────────────────────────────────────────────────────
  MDBG.report = function () {
    console.group('%c[MDBG] report ' + TAG, 'color:#e0a458;font-weight:700');
    log('hooked:', MDBG.hooked);
    log('never found:', [...new Set(MDBG.missing)].filter(n => typeof window[n] !== 'function'));
    MDBG.mountainGlobals();
    MDBG.snapshot();
    console.table(MDBG.events.map(e => ({ time: e.t, type: e.type })));
    log('full events:', MDBG.events);
    console.groupEnd();
  };

  // ── Optional on-screen panel ───────────────────────────────────────────────
  let panelEl = null;
  MDBG.panel = function () {
    if (panelEl) { panelEl.remove(); panelEl = null; return; }
    panelEl = document.createElement('div');
    panelEl.style.cssText = 'position:fixed;bottom:8px;right:8px;width:340px;max-height:40vh;' +
      'overflow:auto;background:#111;color:#e0a458;font:11px/1.4 monospace;padding:8px;' +
      'border:1px solid #444;border-radius:6px;z-index:99999;white-space:pre-wrap';
    panelEl.textContent = '[MDBG ' + TAG + '] ctrl+shift+M to toggle\n';
    document.body.appendChild(panelEl);
    MDBG.events.slice(-40).forEach(paintPanel);
  };
  function paintPanel(e) {
    if (!panelEl) return;
    panelEl.textContent += e.t + '  ' + e.type + '\n';
    panelEl.scrollTop = panelEl.scrollHeight;
  }
  window.addEventListener('keydown', ev => {
    if (ev.ctrlKey && ev.shiftKey && (ev.key === 'M' || ev.key === 'm')) MDBG.panel();
  });

  log('ready. Solve a problem, then run MDBG.report()');
})();
