/* app.js — View routing, tab management, bootstrap */

function showView(v){
  ['practice','blog','assignments','editor','admin'].forEach(id=>{
    document.getElementById(`view-${id}`)?.classList.add('hidden');
    document.getElementById(`navt-${id}`)?.classList.remove('active');
  });
  document.getElementById(`view-${v}`)?.classList.remove('hidden');
  document.getElementById(`navt-${v}`)?.classList.add('active');
  if(v==='admin'){renderAnalytics();renderUserMgmt();renderGradeBtns();}
  if(v==='editor'){showEdTab('problems',document.querySelector('.editor-top-tab'));renderPmList();renderFolderList();renderAssignAdmin();renderBlogPostList();}
  if(v==='assignments')renderStudentAssignments();
  if(v==='blog')renderBlogList();
}

function showAdminTab(t,el){
  document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));el.classList.add('active');
  document.querySelectorAll('.admin-subtab').forEach(d=>d.classList.remove('active'));
  document.getElementById(`atab-${t}`)?.classList.add('active');
}

function showEdTab(t,el){
  document.querySelectorAll('.editor-top-tab').forEach(b=>b.classList.remove('active'));el?.classList.add('active');
  document.querySelectorAll('.editor-view').forEach(v=>v.classList.remove('active'));
  document.getElementById(`etab-${t}`)?.classList.add('active');
  if(t==='topics')renderFolderList();
  if(t==='assignments'){renderAssignAdmin();renderAssignProbPicker();}
  if(t==='blog')renderBlogPostList();
  if(t==='problems')renderPmList();
}

function enterApp(){
  document.getElementById('screen-auth').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');
  const u=window.S.user;
  document.getElementById('topbar-name').textContent=u;
  const av=document.getElementById('topbar-av');av.textContent=u.slice(0,2).toUpperCase();
  if(window.S.isAdmin){av.classList.add('admin-av');document.getElementById('topbar-admin-badge').classList.remove('hidden');}
  else{av.classList.remove('admin-av');document.getElementById('topbar-admin-badge').classList.add('hidden');}
  document.getElementById('navt-editor').classList.toggle('hidden',!window.S.isAdmin);
  document.getElementById('navt-admin').classList.toggle('hidden',!window.S.isAdmin);
  document.getElementById('streak-val').textContent=window.DB.users[u]?.streak||0;
  buildPracticeSidebar();
  showView('practice');
}

// Keyboard enter on auth forms
document.addEventListener('DOMContentLoaded',()=>{
  ['l-user','l-pass'].forEach(id=>{
    document.getElementById(id)?.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  });
  ['r-user','r-pass','r-pass2'].forEach(id=>{
    document.getElementById(id)?.addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();});
  });
  renderVarInsertChips();
});
