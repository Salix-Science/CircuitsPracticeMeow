/* auth.js — Storage (localStorage), DB, auth */

const ADMIN_USER = 'WillowPichardo';
const ADMIN_PASS = 'WillowPichardo';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

window.DB = { users:{}, problems:[], folders:[], assignments:[], posts:[] };

function saveDB() {
  try { localStorage.setItem('cpdb_v6', JSON.stringify(window.DB)); }
  catch(e) { console.warn('saveDB failed:', e); }
}

async function loadDB() {
  try { const r = localStorage.getItem('cpdb_v6'); if (r) window.DB = JSON.parse(r); } catch(e) {}
  // migrate from older keys
  if (!window.DB.users || !Object.keys(window.DB.users).length) {
    for (const key of ['cpdb_v5','cpdb_v4','cpdb_v3']) {
      try { const r = localStorage.getItem(key); if(r){const d=JSON.parse(r);if(d.users&&Object.keys(d.users).length){window.DB.users=d.users;window.DB.problems=d.problems||[];window.DB.folders=d.folders||[];window.DB.assignments=d.assignments||[];break;}}} catch(e){}
    }
  }
  if (!window.DB.folders)     window.DB.folders     = [];
  if (!window.DB.assignments) window.DB.assignments = [];
  if (!window.DB.problems)    window.DB.problems    = [];
  if (!window.DB.posts)       window.DB.posts       = [];
  window.DB.problems.forEach(p => { if (p.enabled === undefined) p.enabled = true; });
  Object.values(window.DB.users).forEach(u => { if (!u.assignSubmissions) u.assignSubmissions = {}; });
  if (!window.DB.users[ADMIN_USER]) {
    window.DB.users[ADMIN_USER] = {
      passwordHash: await sha256(ADMIN_PASS), isAdmin:true,
      scores:{}, probScores:{}, streak:0, assignSubmissions:{}
    };
    saveDB();
  }
}

window.S = {
  user:null, isAdmin:false, activeFolderId:null, activeBuiltin:null,
  currentBuiltinProb:null, folderProblems:[], folderIdx:0,
  editingId:null, editorVars:[], editorImg:null, formEnabled:true,
  editingAssignId:null, editingPostId:null, blogFilter:'All'
};

let _varCtr = 0;
function nextVarId() { return _varCtr++; }

let _authMode = 'login';
function setAuthTab(t, el) {
  _authMode = t;
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('auth-login').classList.toggle('hidden', t !== 'login');
  document.getElementById('auth-register').classList.toggle('hidden', t !== 'register');
}
function showAuthErr(id, msg) { const e=document.getElementById(id); e.querySelector('span').textContent=msg; e.classList.remove('hidden'); }
function hideAuthErr(id) { document.getElementById(id).classList.add('hidden'); }

async function doLogin() {
  hideAuthErr('l-err');
  const user=document.getElementById('l-user').value.trim(), pass=document.getElementById('l-pass').value;
  if (!user||!pass){showAuthErr('l-err','Enter username and password.');return;}
  const rec=window.DB.users[user];
  if (!rec){showAuthErr('l-err','Username not found.');return;}
  if (await sha256(pass)!==rec.passwordHash){showAuthErr('l-err','Incorrect password.');return;}
  window.S.user=user; window.S.isAdmin=!!rec.isAdmin; enterApp();
}

async function doRegister() {
  hideAuthErr('r-err'); document.getElementById('r-ok').classList.add('hidden');
  const user=document.getElementById('r-user').value.trim(), pass=document.getElementById('r-pass').value, pass2=document.getElementById('r-pass2').value;
  if (!user||user.length<3){showAuthErr('r-err','At least 3 characters.');return;}
  if (window.DB.users[user]){showAuthErr('r-err','Username already taken.');return;}
  if (pass.length<6){showAuthErr('r-err','Password needs 6+ characters.');return;}
  if (pass!==pass2){showAuthErr('r-err','Passwords do not match.');return;}
  window.DB.users[user]={passwordHash:await sha256(pass),isAdmin:false,scores:{},probScores:{},streak:0,assignSubmissions:{}};
  saveDB();
  const ok=document.getElementById('r-ok'); ok.textContent='Account created! Sign in now.'; ok.classList.remove('hidden');
  ['r-user','r-pass','r-pass2'].forEach(id=>document.getElementById(id).value='');
}

function doLogout() {
  window.S.user=null; window.S.isAdmin=false;
  document.getElementById('screen-app').classList.add('hidden');
  document.getElementById('screen-auth').classList.remove('hidden');
  ['l-user','l-pass'].forEach(id=>document.getElementById(id).value='');
  hideAuthErr('l-err');
}

function enterApp() {
  document.getElementById('screen-auth').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');
  const u=window.S.user;
  document.getElementById('topbar-name').textContent=u;
  const av=document.getElementById('topbar-av'); av.textContent=u.slice(0,2).toUpperCase();
  if(window.S.isAdmin){av.classList.add('admin-av');document.getElementById('topbar-admin-badge').classList.remove('hidden');}
  else{av.classList.remove('admin-av');document.getElementById('topbar-admin-badge').classList.add('hidden');}
  document.getElementById('navt-editor').classList.toggle('hidden',!window.S.isAdmin);
  document.getElementById('navt-admin').classList.toggle('hidden',!window.S.isAdmin);
  document.getElementById('streak-val').textContent=window.DB.users[u]?.streak||0;
  buildPracticeSidebar();
  showView('practice');
}

function renderUserMgmt() {
  const wrap=document.getElementById('user-mgmt-list'); wrap.innerHTML='';
  Object.entries(window.DB.users).forEach(([name,u])=>{
    const isSelf=name===window.S.user, row=document.createElement('div'); row.className='user-row';
    row.innerHTML=`<span class="un">${name}</span>
      ${u.isAdmin?'<span class="pill pill-admin">admin</span>':'<span class="pill" style="background:rgba(255,255,255,.04);color:var(--text3)">student</span>'}
      ${!isSelf?`<button class="btn btn-sm" onclick="toggleAdmin('${name}')"><i class="ti ${u.isAdmin?'ti-shield-off':'ti-shield-check'}"></i> ${u.isAdmin?'Remove':'Make admin'}</button>
        <button class="btn btn-sm btn-red" onclick="deleteUser('${name}')"><i class="ti ti-trash"></i></button>`
      :'<span style="font-size:11px;color:var(--text4)">(you)</span>'}`;
    wrap.appendChild(row);
  });
}

function toggleAdmin(name){if(!window.DB.users[name])return;window.DB.users[name].isAdmin=!window.DB.users[name].isAdmin;saveDB();renderUserMgmt();renderAnalytics();}
function deleteUser(name){if(!confirm(`Delete "${name}"?`))return;delete window.DB.users[name];saveDB();renderUserMgmt();renderAnalytics();}

async function adminCreateUser(){
  const user=document.getElementById('mu-user').value.trim(),pass=document.getElementById('mu-pass').value,isAdmin=document.getElementById('mu-admin').checked;
  const err=document.getElementById('mu-err'),ok=document.getElementById('mu-ok');
  err.classList.add('hidden');ok.classList.add('hidden');
  if(!user){err.querySelector('span').textContent='Enter a username.';err.classList.remove('hidden');return;}
  if(window.DB.users[user]){err.querySelector('span').textContent='Username exists.';err.classList.remove('hidden');return;}
  if(pass.length<6){err.querySelector('span').textContent='6+ characters required.';err.classList.remove('hidden');return;}
  window.DB.users[user]={passwordHash:await sha256(pass),isAdmin,scores:{},probScores:{},streak:0,assignSubmissions:{}};
  saveDB();ok.textContent=`"${user}" created.`;ok.classList.remove('hidden');
  document.getElementById('mu-user').value='';document.getElementById('mu-pass').value='';document.getElementById('mu-admin').checked=false;
  renderUserMgmt();
}

async function changePassword(){
  const oldP=document.getElementById('cp-old').value,newP=document.getElementById('cp-new').value,newP2=document.getElementById('cp-new2').value;
  const err=document.getElementById('cp-err'),ok=document.getElementById('cp-ok');
  err.classList.add('hidden');ok.classList.add('hidden');
  const u=window.DB.users[window.S.user];
  if(await sha256(oldP)!==u.passwordHash){err.querySelector('span').textContent='Wrong password.';err.classList.remove('hidden');return;}
  if(newP.length<6){err.querySelector('span').textContent='6+ characters required.';err.classList.remove('hidden');return;}
  if(newP!==newP2){err.querySelector('span').textContent='Passwords do not match.';err.classList.remove('hidden');return;}
  u.passwordHash=await sha256(newP);saveDB();ok.textContent='Password updated.';ok.classList.remove('hidden');
  ['cp-old','cp-new','cp-new2'].forEach(id=>document.getElementById(id).value='');
}
