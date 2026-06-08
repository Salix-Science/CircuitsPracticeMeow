/* ═══════════════════════════════════════════
   blog.js — Blog reader and rich text editor
   ═══════════════════════════════════════════ */

// ── Category pills ────────────────────────────
// catPill() and the category colour map now live in firebase.js so the blog
// page and the home page render identical pills from one editable source.
// (window.catPill is defined before this file loads.)

// ── Search / author filter handlers ───────────
window.onBlogSearch = function onBlogSearch(val) {
  window.S.blogSearch = val || '';
  const clearBtn = document.getElementById('blog-search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !window.S.blogSearch);
  renderBlogList();
};
window.clearBlogSearch = function clearBlogSearch() {
  window.S.blogSearch = '';
  const input = document.getElementById('blog-search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('blog-search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderBlogList();
};
window.onBlogAuthor = function onBlogAuthor(val) {
  window.S.blogAuthor = val || 'All';
  renderBlogList();
};
window.resetBlogFilters = function resetBlogFilters() {
  window.S.blogSearch = '';
  window.S.blogAuthor = 'All';
  window.S.blogFilter = 'All';
  const input = document.getElementById('blog-search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('blog-search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderBlogList();
};

// Strip HTML tags so post body text is searchable as plain text
function _blogPlainText(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ');
}

// ── Blog list (reader) ────────────────────────
window.renderBlogList = function renderBlogList() {
  document.getElementById('blog-list-view').classList.remove('hidden');
  document.getElementById('blog-post-view').classList.add('hidden');

  // Default state (in case S wasn't initialised with these keys)
  if (window.S.blogSearch == null) window.S.blogSearch = '';
  if (window.S.blogAuthor == null) window.S.blogAuthor = 'All';

  // Visible posts: published always, drafts only for admin
  const posts = window.DB.posts
    .filter(p => p.status === 'published' || (window.S.isAdmin && p.status === 'draft'))
    .sort((a, b) => b.createdAt - a.createdAt);

  // Build category filter chips
  const cats = ['All', ...new Set(posts.map(p => p.category))];
  const bar  = document.getElementById('blog-filter-bar');
  bar.innerHTML = '';
  cats.forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (window.S.blogFilter === c ? ' active' : '');
    chip.textContent = c;
    chip.onclick = () => { window.S.blogFilter = c; renderBlogList(); };
    bar.appendChild(chip);
  });

  // Build author (poster) dropdown from the visible posts
  const authorSel = document.getElementById('blog-author-filter');
  if (authorSel) {
    const authors = ['All', ...[...new Set(posts.map(p => p.author).filter(Boolean))].sort()];
    // If the currently selected author no longer exists, fall back to All
    if (!authors.includes(window.S.blogAuthor)) window.S.blogAuthor = 'All';
    authorSel.innerHTML = authors.map(a =>
      `<option value="${escHtml(a)}">${a === 'All' ? 'All authors' : escHtml(a)}</option>`
    ).join('');
    authorSel.value = window.S.blogAuthor;
  }

  // Apply filters: category → author → text search
  let filtered = window.S.blogFilter === 'All'
    ? posts
    : posts.filter(p => p.category === window.S.blogFilter);

  if (window.S.blogAuthor !== 'All') {
    filtered = filtered.filter(p => p.author === window.S.blogAuthor);
  }

  const q = window.S.blogSearch.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(p => {
      const haystack = [
        p.title, p.excerpt, p.author, p.category, _blogPlainText(p.content)
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  const grid  = document.getElementById('blog-grid');
  const empty = document.getElementById('blog-empty');
  grid.innerHTML = '';

  if (!filtered.length) {
    // Distinguish "no posts at all" from "no matches for this search/filter"
    const filtering = q || window.S.blogAuthor !== 'All' || window.S.blogFilter !== 'All';
    if (filtering) {
      empty.classList.add('hidden');
      grid.innerHTML = `<div class="blog-no-results">
        <i class="ti ti-search-off" style="font-size:28px;display:block;margin-bottom:8px;color:var(--text4)"></i>
        No posts match your search or filters.
        <div style="margin-top:10px"><button class="btn btn-sm" onclick="resetBlogFilters()"><i class="ti ti-rotate"></i> Clear filters</button></div>
      </div>`;
    } else {
      empty.classList.remove('hidden');
    }
    return;
  }
  empty.classList.add('hidden');

  filtered.forEach(post => {
    const card = document.createElement('div');
    card.className = 'blog-card';
    const date = new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    card.innerHTML = `
      <div class="blog-card-inner">
        <div class="blog-card-meta">
          ${window.categoryPill(post.category)}
          ${post.status === 'draft' ? `<span class="pill pill-warn">Draft</span>` : ''}
          <span class="blog-card-date">${date}</span>
        </div>
        <div class="blog-card-title">${post.title}</div>
        ${post.excerpt ? `<div class="blog-card-excerpt">${post.excerpt}</div>` : ''}
        <div class="blog-card-footer">
          <span class="blog-card-author">by ${post.author}</span>
          <span class="blog-read-more">Read more →</span>
        </div>
      </div>`;
    card.onclick = () => openBlogPost(post.id);
    grid.appendChild(card);
  });
}

window.openBlogPost = function openBlogPost(id) {
  const post = window.DB.posts.find(p => p.id === id);
  if (!post) return;
  document.getElementById('blog-list-view').classList.add('hidden');
  document.getElementById('blog-post-view').classList.remove('hidden');
  const date = new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('post-title-el').textContent = post.title;
  document.getElementById('post-meta-el').innerHTML =
    `${window.categoryPill(post.category)}<span class="post-date">${date}</span><span class="post-date">by ${post.author}</span>
    ${post.status === 'draft' ? '<span class="pill pill-warn">Draft</span>' : ''}`;
  document.getElementById('post-content-el').innerHTML = post.content;
  document.getElementById('view-blog').scrollTop = 0;

  // Load comments (only for published posts)
  if (post.status === 'published') {
    loadComments(post.id);
  } else {
    const el = document.getElementById('post-comments');
    if (el) el.style.display = 'none';
  }
}

// ── Comments ──────────────────────────────────

window.loadComments = async function loadComments(postId) {
  const el = document.getElementById('post-comments');
  if (!el) return;

  el.style.display = 'block';
  el.innerHTML = `<div class="comment-loading"><i class="ti ti-loader-2"></i> Loading comments…</div>`;

  let comments = [];
  try {
    // Read directly from Firestore — no Cloud Function needed for reads.
    const db2    = window._getFirestoreDb();
    const { query: fsQuery, collection: fsCol, orderBy: fsOrderBy, getDocs: fsGetDocs } =
      window._firestoreQuery;
    const snap = await fsGetDocs(
      fsQuery(fsCol(db2, 'posts', postId, 'comments'), fsOrderBy('createdAt', 'asc'))
    );
    comments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.approved);   // only show approved comments
  } catch(e) {
    console.error('[loadComments] failed:', e);
    el.innerHTML = `<div class="comment-empty">Could not load comments.</div>`;
    return;
  }

  _renderComments(postId, comments);
};

function _renderComments(postId, comments) {
  const el = document.getElementById('post-comments');
  if (!el) return;

  const isLoggedIn = !!window.S.uid;
  const isAdmin    = !!window.S.isAdmin;
  const myUid      = window.S.uid;

  // Heading
  let html = `<div class="post-comments-heading">
    Comments <span class="comment-count">${comments.length}</span>
  </div>`;

  // Comment list
  html += `<div class="comment-list" id="comment-list-${escPostId(postId)}">`;
  if (comments.length === 0) {
    html += `<div class="comment-empty">No comments yet. Be the first!</div>`;
  } else {
    for (const c of comments) {
      const isMe  = c.uid === myUid;
      const date  = new Date(c.createdAt).toLocaleDateString('en-US',
        { month: 'short', day: 'numeric', year: 'numeric' });
      const deleteBtn = (isAdmin || isMe)
        ? `<button class="comment-delete-btn" title="Delete comment"
             onclick="deleteComment('${escPostId(postId)}','${window.escHtml(c.id)}')"
           ><i class="ti ti-trash"></i></button>`
        : '';
      const reportBtn = (!isAdmin && !isMe)
        ? (c.reported
            ? `<button class="comment-report-btn reported" title="Already reported" disabled><i class="ti ti-flag-filled"></i></button>`
            : `<button class="comment-report-btn" title="Report comment"
                 onclick="reportComment('${escPostId(postId)}','${window.escHtml(c.id)}')"
               ><i class="ti ti-flag"></i></button>`)
        : '';
      const reportedBadge = isAdmin && c.reported
        ? `<span class="comment-reported-badge"><i class="ti ti-flag-filled"></i> Reported</span>`
        : '';
      html += `<div class="comment-item${c.reported ? ' is-reported' : ''}" id="comment-${window.escHtml(c.id)}">
        ${deleteBtn}${reportBtn}
        <div class="comment-meta">
          <span class="comment-author${isMe ? ' is-you' : ''}">${window.escHtml(c.username || 'Anonymous')}${isMe ? ' (you)' : ''}</span>
          <span class="comment-date">${date}</span>
          ${reportedBadge}
        </div>
        <div class="comment-body">${window.escHtml(c.body)}</div>
      </div>`;
    }
  }
  html += `</div>`;

  // Compose box (logged-in users only)
  if (isLoggedIn) {
    html += `<div class="comment-compose">
      <div class="comment-compose-label"><i class="ti ti-message-2"></i> Leave a comment</div>
      <textarea id="comment-input-${escPostId(postId)}" placeholder="Write your comment…" maxlength="2000" rows="3"></textarea>
      <div id="comment-err-${escPostId(postId)}" class="comment-err" style="display:none"></div>
      <div class="comment-compose-row">
        <span class="comment-compose-hint">Max 2000 characters</span>
        <button class="btn btn-sm btn-accent comment-submit-btn"
          onclick="submitComment('${escPostId(postId)}')">
          <i class="ti ti-send"></i> Post comment
        </button>
      </div>
    </div>`;
  } else {
    html += `<div class="comment-compose" style="text-align:center;color:var(--text4);font-size:13px">
      Log in to leave a comment.
    </div>`;
  }

  el.innerHTML = html;
}

// Safe post-ID for use in DOM IDs — strip non-alphanumeric to prevent injection
function escPostId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

window.submitComment = async function submitComment(safePostId) {
  // Recover the real post ID from the currently open post
  const post = window.DB.posts.find(p => escPostId(p.id) === safePostId);
  if (!post) return;

  const textarea = document.getElementById(`comment-input-${safePostId}`);
  const errEl    = document.getElementById(`comment-err-${safePostId}`);
  if (!textarea) return;

  const body = textarea.value.trim();
  if (!body) {
    if (errEl) { errEl.textContent = 'Comment cannot be empty.'; errEl.style.display = 'block'; }
    return;
  }
  if (errEl) errEl.style.display = 'none';

  // Disable button during flight
  const btn = textarea.closest('.comment-compose')?.querySelector('.comment-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Posting…'; }

  try {
    const { getFunctions, httpsCallable } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js'
    );
    const fns  = getFunctions(window._firebaseApp, 'us-central1');
    const call = httpsCallable(fns, 'postComment');
    await call({ postId: post.id, body });
    // Reload comments to show the new one
    await loadComments(post.id);
  } catch(e) {
    console.error('[submitComment] error:', e);
    const msg = e?.message || 'Could not post comment. Try again.';
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Post comment'; }
  }
};

window.deleteComment = async function deleteComment(safePostId, commentId) {
  if (!confirm('Delete this comment?')) return;

  const post = window.DB.posts.find(p => escPostId(p.id) === safePostId);
  if (!post) return;

  // Delete directly from Firestore (admin or own comment — rules will enforce)
  try {
    const db2 = window._getFirestoreDb();
    const { deleteDoc, doc } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
    );
    await deleteDoc(doc(db2, 'posts', post.id, 'comments', commentId));
    // Remove from DOM immediately
    document.getElementById(`comment-${window.escHtml(commentId)}`)?.remove();
    // Update count
    const list    = document.getElementById(`comment-list-${safePostId}`);
    const count   = list ? list.querySelectorAll('.comment-item').length : 0;
    const heading = document.querySelector('.post-comments-heading .comment-count');
    if (heading) heading.textContent = count;
    if (count === 0 && list) {
      list.innerHTML = `<div class="comment-empty">No comments yet. Be the first!</div>`;
    }
  } catch(e) {
    console.error('[deleteComment] error:', e);
    alert('Could not delete comment: ' + (e?.message || 'Unknown error'));
  }
};

window.reportComment = async function reportComment(safePostId, commentId) {
  if (!confirm('Report this comment to the instructor?')) return;
  const post = window.DB.posts.find(p => escPostId(p.id) === safePostId);
  if (!post) return;
  try {
    const db2 = window._getFirestoreDb();
    const { updateDoc, doc } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
    );
    await updateDoc(doc(db2, 'posts', post.id, 'comments', commentId), {
      reported:   true,
      reportedBy: window.S.uid,
      reportedAt: Date.now(),
    });
    const btn = document.querySelector(`#comment-${window.escHtml(commentId)} .comment-report-btn`);
    if (btn) {
      btn.disabled = true;
      btn.classList.add('reported');
      btn.title = 'Already reported';
      btn.innerHTML = '<i class="ti ti-flag-filled"></i>';
    }
  } catch(e) {
    console.error('[reportComment] error:', e);
    alert('Could not report comment: ' + (e?.message || 'Unknown error'));
  }
};

// ── Admin: reported comments panel ───────────
window.renderReportedComments = async function renderReportedComments() {
  if (!window.S.isAdmin) return;
  const wrap = document.getElementById('reported-comments-list');
  if (!wrap) return;
  wrap.innerHTML = `<div class="comment-loading"><i class="ti ti-loader-2"></i> Loading...</div>`;

  try {
    const db2 = window._getFirestoreDb();
    const { query: fsQ, collectionGroup, where, orderBy: fsOrd, getDocs: fsGet } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
    );
    const snap = await fsGet(
      fsQ(collectionGroup(db2, 'comments'), where('reported', '==', true), fsOrd('reportedAt', 'desc'))
    );

    if (snap.empty) {
      wrap.innerHTML = `<div class="comment-empty" style="padding:2rem">No reported comments.</div>`;
      return;
    }

    let html = '';
    snap.docs.forEach(d => {
      const c       = { id: d.id, ...d.data() };
      const postId  = d.ref.parent.parent.id;
      const post    = window.DB.posts.find(p => p.id === postId);
      const postTitle = post ? window.escHtml(post.title) : window.escHtml(postId);
      const date    = new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const repDate = c.reportedAt
        ? new Date(c.reportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      html += `<div class="reported-comment-row" id="rc-${window.escHtml(c.id)}">
        <div class="reported-comment-meta">
          <span class="comment-author">${window.escHtml(c.username || 'Anonymous')}</span>
          <span class="comment-date">${date}</span>
          <span class="reported-in-post">in <em>${postTitle}</em></span>
          <span class="comment-reported-badge"><i class="ti ti-flag-filled"></i> Reported ${repDate}</span>
        </div>
        <div class="comment-body" style="margin:8px 0 10px">${window.escHtml(c.body)}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-red" onclick="deleteReportedComment('${window.escHtml(postId)}','${window.escHtml(c.id)}')">
            <i class="ti ti-trash"></i> Delete comment
          </button>
          <button class="btn btn-sm" onclick="dismissReport('${window.escHtml(postId)}','${window.escHtml(c.id)}')">
            <i class="ti ti-circle-check"></i> Dismiss report
          </button>
        </div>
      </div>`;
    });
    wrap.innerHTML = html;
  } catch(e) {
    console.error('[renderReportedComments] error:', e);
    wrap.innerHTML = `<div class="comment-empty" style="color:var(--red)">Failed to load: ${window.escHtml(e.message)}</div>`;
  }
};

window.deleteReportedComment = async function deleteReportedComment(postId, commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    const db2 = window._getFirestoreDb();
    const { deleteDoc, doc } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
    );
    await deleteDoc(doc(db2, 'posts', postId, 'comments', commentId));
    document.getElementById(`rc-${window.escHtml(commentId)}`)?.remove();
    _checkReportedEmpty();
  } catch(e) {
    alert('Could not delete: ' + (e?.message || 'Unknown error'));
  }
};

window.dismissReport = async function dismissReport(postId, commentId) {
  try {
    const db2 = window._getFirestoreDb();
    const { updateDoc, doc, deleteField } = await import(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
    );
    await updateDoc(doc(db2, 'posts', postId, 'comments', commentId), {
      reported:   deleteField(),
      reportedBy: deleteField(),
      reportedAt: deleteField(),
    });
    document.getElementById(`rc-${window.escHtml(commentId)}`)?.remove();
    _checkReportedEmpty();
  } catch(e) {
    alert('Could not dismiss: ' + (e?.message || 'Unknown error'));
  }
};

function _checkReportedEmpty() {
  const wrap = document.getElementById('reported-comments-list');
  if (wrap && !wrap.querySelector('.reported-comment-row')) {
    wrap.innerHTML = `<div class="comment-empty" style="padding:2rem">No reported comments.</div>`;
  }
}

window.showBlogList = function showBlogList() {
  document.getElementById('blog-list-view').classList.remove('hidden');
  document.getElementById('blog-post-view').classList.add('hidden');
  const commentsEl = document.getElementById('post-comments');
  if (commentsEl) { commentsEl.style.display = 'none'; commentsEl.innerHTML = ''; }
}

// ── Rich text editor ──────────────────────────
window.rteExec = function rteExec(cmd) {
  document.getElementById('rte-body').focus();
  document.execCommand(cmd, false, null);
}

window.rteBlock = function rteBlock(tag) {
  document.getElementById('rte-body').focus();
  document.execCommand('formatBlock', false, tag);
}

window.rteInsertCode = function rteInsertCode() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const code = document.createElement('code');
  code.textContent = sel.toString() || 'code';
  sel.deleteFromDocument();
  sel.getRangeAt(0).insertNode(code);
}

window.rteInsertHR = function rteInsertHR() {
  document.getElementById('rte-body').focus();
  document.execCommand('insertHTML', false, '<hr/><p><br></p>');
}

// Category custom tag toggle
window.toggleCustomTag = function toggleCustomTag(sel) {
  const w = document.getElementById('bp-custom-wrap');
  if (w) w.style.display = sel.value === 'custom' ? 'block' : 'none';
}

// ── Blog editor form ──────────────────────────
// Fill the category <select> from the editable category list (+ a custom option)
window.populateBpCategory = function populateBpCategory(selected) {
  const sel = document.getElementById('bp-category');
  if (!sel) return;
  const cats = (window.DB.categories && window.DB.categories.length)
    ? window.DB.categories : (window.DEFAULT_CATEGORIES || []);
  sel.innerHTML = cats.map(c =>
    `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`
  ).join('') + `<option value="custom">Custom…</option>`;
  if (selected != null) sel.value = selected;
};

window.resetBlogForm = function resetBlogForm() {
  window.S.editingPostId = null;
  ['bp-title', 'bp-excerpt', 'bp-custom-tag'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  populateBpCategory();
  const firstCat = (window.DB.categories && window.DB.categories[0]?.name) || 'Tutorial';
  document.getElementById('bp-category').value = firstCat;
  document.getElementById('bp-status').value   = 'published';
  document.getElementById('bp-custom-wrap').style.display = 'none';
  document.getElementById('rte-body').innerHTML = '';
  document.getElementById('blog-form-label').textContent = 'New post';
}

window.saveBlogPost = async function saveBlogPost() {
  if(!window.S.isAdmin){console.warn("[security] saveBlogPost blocked");return;}
  const title = document.getElementById('bp-title').value.trim();
  if (!title) { alert('Enter a title.'); return; }

  const catSel   = document.getElementById('bp-category').value;
  const category = catSel === 'custom'
    ? (document.getElementById('bp-custom-tag').value.trim() || 'Custom')
    : catSel;

  const content = document.getElementById('rte-body').innerHTML;
  if (!content.replace(/<[^>]*>/g, '').trim()) { alert('Write some content first.'); return; }

  const existing = window.DB.posts.find(p => p.id === window.S.editingPostId);
  const post = {
    id:           window.S.editingPostId || `post-${Date.now()}`,
    title,
    category,
    excerpt:      document.getElementById('bp-excerpt').value.trim(),
    content,
    status:       document.getElementById('bp-status').value,
    author:       window.S.user,
    createdAt:    existing?.createdAt || Date.now(),
    updatedAt:    Date.now(),
  };

  const idx = window.DB.posts.findIndex(p => p.id === post.id);
  if (idx >= 0) window.DB.posts[idx] = post;
  else          window.DB.posts.unshift(post);

  const _pIsNew = idx < 0;
  window.S.editingPostId = post.id;
  document.getElementById('blog-form-label').textContent = `Editing: ${post.title}`;
  await saveDB();
  logAdminAction(_pIsNew ? 'create_post' : 'edit_post', { id: post.id, title: post.title, category: post.category, status: post.status });
  renderBlogPostList();
  // Send email notification when a new post is published (not drafts, not edits).
  // Announcements go to announcement subscribers; everything else to post subscribers.
  if (_pIsNew && post.status === 'published' && typeof sendEmailNotification === 'function') {
    const _type = post.category === 'Announcement' ? 'announcements' : 'posts';
    sendEmailNotification(
      `New ${post.category}: ${post.title}`,
      `A new ${post.category} post has been published on Circuits Practice.\n\n"${post.title}"\n\n${post.excerpt || 'Log in to read the full post.'}\n\n— ${post.author}`,
      _type
    ).then(r => { if (r && r.sent > 0) console.log(`Notified ${r.sent} student(s).`); })
     .catch(e => console.error('[notifications] post auto-send failed:', e));
  }
  alert(`"${post.title}" ${post.status === 'draft' ? 'saved as draft' : 'published'}!`);
}

window.loadPostToEditor = function loadPostToEditor(post) {
  window.S.editingPostId = post.id;
  document.getElementById('bp-title').value   = post.title   || '';
  document.getElementById('bp-excerpt').value = post.excerpt || '';

  const known = (window.DB.categories && window.DB.categories.length)
    ? window.DB.categories.map(c => c.name)
    : ['Tutorial', 'Update', 'Announcement', 'Resource'];
  populateBpCategory();
  if (known.includes(post.category)) {
    document.getElementById('bp-category').value        = post.category;
    document.getElementById('bp-custom-wrap').style.display = 'none';
  } else {
    document.getElementById('bp-category').value        = 'custom';
    document.getElementById('bp-custom-tag').value      = post.category;
    document.getElementById('bp-custom-wrap').style.display = 'block';
  }

  document.getElementById('bp-status').value   = post.status || 'published';
  document.getElementById('rte-body').innerHTML = post.content || '';
  document.getElementById('blog-form-label').textContent = `Editing: ${post.title}`;

  // Switch to blog editor tab
  showEdTab('blog', document.querySelectorAll('.editor-top-tab')[3]);
}

window.deletePost = async function deletePost(id) {
  if(!window.S.isAdmin){console.warn("[security] deletePost blocked");return;}
  if (!confirm('Delete this post?')) return;
  const _dp = window.DB.posts.find(p => p.id === id);
  logAdminAction('delete_post', { id, title: _dp?.title, category: _dp?.category });
  window.DB.posts = window.DB.posts.filter(p => p.id !== id);
  if (window.S.editingPostId === id) resetBlogForm();
  await deleteFromDB('posts', id);
  renderBlogPostList();
}

// ── Blog post list (editor sidebar) ──────────
window.renderBlogPostList = function renderBlogPostList() {
  // Keep the category dropdown in sync with the current category list
  populateBpCategory(document.getElementById('bp-category')?.value);
  const list  = document.getElementById('blog-post-list');
  const empty = document.getElementById('blog-post-list-empty');
  document.getElementById('post-count').textContent = `(${window.DB.posts.length})`;

  list.innerHTML = '';
  empty.style.display = window.DB.posts.length ? 'none' : 'block';

  window.DB.posts.forEach(post => {
    const row = document.createElement('div');
    row.className = 'blog-post-row' + (post.id === window.S.editingPostId ? ' selected' : '');
    const date = new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    row.innerHTML = `
      <div class="blog-post-row-body">
        <div class="blog-post-row-title">${post.title}</div>
        <div class="blog-post-row-meta">${post.category} · ${date}${post.status === 'draft' ? ' · draft' : ''}</div>
      </div>
      <div class="blog-post-row-actions">
        <button class="pm-icon-btn" title="Edit"   onclick="event.stopPropagation(); loadPostToEditor(window.DB.posts.find(p=>p.id==='${post.id}'))"><i class="ti ti-edit"></i></button>
        <button class="pm-icon-btn del" title="Delete" onclick="event.stopPropagation(); deletePost('${post.id}')"><i class="ti ti-trash"></i></button>
      </div>`;
    row.onclick = () => loadPostToEditor(window.DB.posts.find(p => p.id === post.id));
    list.appendChild(row);
  });
}
