+// ── One-click unsubscribe landing ────────────
+// If the page is opened with ?unsubscribe=TOKEN (from an email footer link),
+// call the Cloud Function and show a confirmation overlay without requiring login.
+(async function() {
+  const params = new URLSearchParams(window.location.search);
+  const token  = params.get('unsubscribe');
+  if (!token) return;
+
+  // Show an overlay immediately so the user sees feedback
+  const overlay = document.createElement('div');
+  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center';
+  overlay.innerHTML = `
+    <div style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:10px;padding:36px 40px;max-width:420px;text-align:center;font-family:sans-serif">
+      <div style="font-size:13px;font-weight:700;letter-spacing:.1em;color:#9d7de8;margin-bottom:16px">CIRCUITS PRACTICE</div>
+      <div id="unsub-msg" style="font-size:14px;color:#c8c8d8;line-height:1.7">Unsubscribing…</div>
+      <button onclick="this.closest('div[style]').remove();history.replaceState({},'',location.pathname)"
+        style="display:none;margin-top:20px;padding:8px 20px;background:#9d7de8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px"
+        id="unsub-close">Close</button>
+    </div>`;
+  document.body.appendChild(overlay);
+
+  try {
+    const resp = await fetch(
+      `https://us-central1-circuitspractice-b4cb0.cloudfunctions.net/unsubscribe?token=${encodeURIComponent(token)}`
+    );
+    const msg = document.getElementById('unsub-msg');
+    if (resp.ok) {
+      msg.textContent = "You've been unsubscribed from all Circuits Practice emails. You can re-enable notifications anytime from your profile.";
+    } else {
+      msg.textContent = 'Something went wrong. Please contact your instructor to unsubscribe.';
+    }
+  } catch(e) {
+    document.getElementById('unsub-msg').textContent = 'Could not reach the server. Please try again later.';
+  }
+
+  document.getElementById('unsub-close').style.display = 'inline-block';
+  // Clean the URL so refreshing doesn't re-trigger
+  history.replaceState({}, '', location.pathname);
+})();
+
 // ── MathJax typeset helper ────────────────────
// ── MathJax typeset helper ────────────────────
// Call after rendering any content that may contain LaTeX ($...$ or $$...$$).
window.typeset = function(el) {
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise(el ? [el] : undefined).catch(e => console.warn('MathJax:', e));
  }
};

/* app.js — Last script to load. Exposes all routing functions globally,
   then signals firebase.js that the app is ready to receive auth events. */

function _requireAdmin(context) {
  if (!window.S.isAdmin) {
    console.warn(`[security] Non-admin attempted to access: ${context}`);
    return false;
  }
  return true;
}

window.showView = function(v) {
  if ((v==='editor' || v==='admin') && !_requireAdmin(`showView(${v})`)) return;
  // Close the calendar modal if open — it's position:fixed and blocks all clicks if left open
  const calModal = document.getElementById('cal-modal');
  if (calModal) calModal.style.display = 'none';

  ['home','practice','blog','assignments','progress','calendar','profile','editor','admin'].forEach(id=>{
    document.getElementById(`view-${id}`)?.classList.add('hidden');
    document.getElementById(`navt-${id}`)?.classList.remove('active');
  });
  document.getElementById(`view-${v}`)?.classList.remove('hidden');
  document.getElementById(`navt-${v}`)?.classList.add('active');
  window.track?.('page_view', { page: v });
  if(v==='home')renderHomepage();
  if(v==='admin'){renderAnalytics();renderUserMgmt();renderGradeBtns();} // both async, fire-and-forget is fine here
  if(v==='editor'){showEdTab('problems',document.querySelector('.editor-top-tab'));renderPmList();renderFolderList();renderAssignAdmin();renderBlogPostList();}
  if(v==='assignments')renderStudentAssignments();
  if(v==='blog')renderBlogList();
  if(v==='progress')renderProgress();
  if(v==='calendar')renderCalendar();
  if(v==='profile')renderProfile();
};

// Render notification settings when user opens the account tab
window.showAccountTab = function() {
  if (typeof renderNotifSettings === 'function') renderNotifSettings();
};

window.showAdminTab = function(t, el) {
  if (!_requireAdmin(`showAdminTab(${t})`)) return;
  document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.admin-subtab').forEach(d=>d.classList.remove('active'));
  document.getElementById(`atab-${t}`)?.classList.add('active');
  if(t==='notifications') renderAdminNotifPanel?.();
  if(t==='problem-analysis') renderProblemAnalysis?.();
  if(t==='coursegrades') renderCourseGrades?.();
  if(t==='sections') renderSections?.();
  if(t==='account') window.renderNotificationSettings?.();
  if(t==='auditlog') renderAuditLog?.();
};

window.showEdTab = function(t, el) {
  if (!_requireAdmin(`showEdTab(${t})`)) return;
  document.querySelectorAll('.editor-top-tab').forEach(b=>b.classList.remove('active'));
  el?.classList.add('active');
  document.querySelectorAll('.editor-view').forEach(v=>v.classList.remove('active'));
  document.getElementById(`etab-${t}`)?.classList.add('active');
  if(t==='topics')renderFolderList();
  if(t==='labels')renderTopicManager();
  if(t==='homepage')renderHomepageEditor();
  if(t==='categories')renderCategoryEditor();
  if(t==='assignments'){renderAssignAdmin();renderAssignProbPicker();}
  if(t==='blog')renderBlogPostList();
  if(t==='problems')renderPmList();
};

window.enterApp = function() {
  document.getElementById('screen-auth').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');
  const u = window.S.user;
  document.getElementById('topbar-name').textContent = u;
  const av = document.getElementById('topbar-av');
  av.textContent = u.slice(0,2).toUpperCase();
  if(window.S.isAdmin){
    av.classList.add('admin-av');
    document.getElementById('topbar-admin-badge').classList.remove('hidden');
  } else {
    av.classList.remove('admin-av');
    document.getElementById('topbar-admin-badge').classList.add('hidden');
  }
  document.getElementById('navt-editor').classList.toggle('hidden', !window.S.isAdmin);
  document.getElementById('navt-admin').classList.toggle('hidden', !window.S.isAdmin);
  document.getElementById('streak-val').textContent = parseInt(window.DB.users[u]?.streak) || 0;
  buildPracticeSidebar();
  window.showView('home');
  // Restore persisted assignment attempt counts so limits survive page refreshes.
  if (window.syncAssignAttempts) window.syncAssignAttempts();
  // Offer legacy accounts a one-time prompt to set a real email (for reset).
  if (window.maybePromptEmailMigration) window.maybePromptEmailMigration();
};

// Attach Enter-key listeners to auth form inputs
['l-user','l-pass'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
});
['r-user','r-pass','r-pass2'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doRegister(); });
});

// Initialize var insert chips in editor
renderVarInsertChips();

// Tell firebase.js the app shell is ready — it can now safely process auth events.
// firebase.js holds any pending auth state in window._pendingAuthUser and runs
// enterApp() once this flag is set.
window._appReady = true;
if (window._pendingAuthUser) {
  window._pendingAuthUser();
}
