
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
  if(t==='sections') renderSections?.();
  if(t==='account') renderNotificationSettings?.();
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
