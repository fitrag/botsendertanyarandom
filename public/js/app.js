// ===== API =====
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ===== TOAST =====
function toast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const cls = { success: 'bg-emerald-50 dark:bg-emerald-900/80 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-300',
    error: 'bg-rose-50 dark:bg-rose-900/80 border-rose-200 dark:border-rose-700/40 text-rose-700 dark:text-rose-300',
    info: 'bg-blue-50 dark:bg-blue-900/80 border-blue-200 dark:border-blue-700/40 text-blue-700 dark:text-blue-300' };
  const el = document.createElement('div');
  el.className = `toast-enter px-4 py-2.5 rounded-xl border shadow-sm text-xs font-medium ${cls[type] || cls.info}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.classList.replace('toast-enter', 'toast-exit'); setTimeout(() => el.remove(), 300); }, 2700);
}

// ===== THEME =====
document.getElementById('themeToggle').addEventListener('click', () => {
  const html = document.documentElement;
  html.classList.add('theme-transition');
  html.classList.toggle('dark');
  localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
  setTimeout(() => html.classList.remove('theme-transition'), 400);
  // Re-render charts with correct colors
  if (currentPage === 'dashboard') loadDashboard();
});

// ===== NAV =====
let currentPage = 'dashboard';
const titles = { dashboard: 'Dashboard', messages: 'Kiriman Pesan', users: 'Pengguna', settings: 'Pengaturan', support: 'Support', announcement: 'Pengumuman', challenge: 'Challenge', avatars: 'Avatar' };
const navActive = 'bg-violet-50 dark:bg-violet-600/10 text-violet-600 dark:text-violet-400';
const navInactive = 'text-slate-500 dark:text-zinc-400';

document.querySelectorAll('.nav-item[data-page]').forEach(b => b.addEventListener('click', () => {
  navigateTo(b.dataset.page);
  document.getElementById('sidebar').classList.add('-translate-x-full');
}));
document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('-translate-x-full'));

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(page + 'Page').classList.add('active');
  document.querySelectorAll('.nav-item[data-page]').forEach(n => { n.className = n.className.replace(/bg-violet-50|dark:bg-violet-600\/10|text-violet-600|dark:text-violet-400/g, '').trim(); if (!n.className.includes(navInactive.split(' ')[0])) n.className += ' ' + navInactive; });
  const a = document.querySelector(`.nav-item[data-page="${page}"]`);
  a.className = a.className.replace(/text-slate-500|dark:text-zinc-400/g, '').trim() + ' ' + navActive;
  document.getElementById('pageTitle').textContent = titles[page] || page;
  if (page === 'dashboard') loadDashboard();
  else if (page === 'messages') loadMessages();
  else if (page === 'users') loadUsers();
  else if (page === 'settings') loadSettings();
  else if (page === 'support') loadSupport();
  else if (page === 'announcement') resetAnnouncement();
  else if (page === 'challenge') loadChallenges();
  else if (page === 'avatars') loadAvatarsAdmin();
}

// ===== LOGOUT =====
document.getElementById('logoutBtn').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); window.location.href = '/login'; });

// ===== UTILS =====
function fmtDate(d) { if (!d) return '-'; const ds = String(d); return new Date(ds.endsWith('Z') ? ds : ds + 'Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function timeAgo(d) { if (!d) return '-'; const s = (Date.now() - new Date(d + 'Z').getTime()) / 1000; if (s < 60) return 'Baru saja'; if (s < 3600) return Math.floor(s / 60) + 'm lalu'; if (s < 86400) return Math.floor(s / 3600) + 'j lalu'; return Math.floor(s / 86400) + 'h lalu'; }
function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function isDark() { return document.documentElement.classList.contains('dark'); }

// ===== DASHBOARD =====
let dailyChart = null, statusChart = null;

async function loadDashboard() {
  try {
    const data = await api('/api/stats');
    const s = data.stats;
    const badge = document.getElementById('pendingBadge');
    if (s.pendingMessages > 0) { badge.textContent = s.pendingMessages; badge.classList.remove('hidden'); } else badge.classList.add('hidden');

    const cards = [
      { l: 'Total Pesan', v: s.totalMessages, i: 'mail', c: 'violet' },
      { l: 'Pending', v: s.pendingMessages, i: 'clock', c: 'amber' },
      { l: 'Disetujui', v: s.approvedMessages, i: 'check-circle', c: 'emerald' },
      { l: 'Pengguna', v: s.totalUsers, i: 'users', c: 'blue' },
    ];
    const cm = { violet: 'bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400', amber: 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400', emerald: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', blue: 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' };

    document.getElementById('statsGrid').innerHTML = cards.map(c => `
      <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/60 rounded-2xl p-5 shadow-sm dark:shadow-none">
        <div class="w-9 h-9 rounded-xl ${cm[c.c]} flex items-center justify-center mb-3"><i data-lucide="${c.i}" class="w-4 h-4"></i></div>
        <div class="text-2xl font-bold">${c.v}</div>
        <div class="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5">${c.l}</div>
      </div>`).join('');

    // Charts
    const dark = isDark();
    const gridC = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
    const tickC = dark ? '#71717a' : '#94a3b8';

    if (dailyChart) dailyChart.destroy();
    const ctx = document.getElementById('dailyChart').getContext('2d');
    const gr = ctx.createLinearGradient(0, 0, 0, 200);
    gr.addColorStop(0, dark ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.08)');
    gr.addColorStop(1, 'rgba(139,92,246,0)');
    dailyChart = new Chart(ctx, {
      type: 'line',
      data: { labels: data.dailyStats.map(d => new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })),
        datasets: [{ data: data.dailyStats.map(d => d.count), borderColor: '#8b5cf6', backgroundColor: gr, borderWidth: 1.5, fill: true, tension: 0.4, pointRadius: 2, pointBackgroundColor: '#8b5cf6', pointHoverRadius: 5 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { color: gridC }, ticks: { color: tickC, font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: gridC }, ticks: { color: tickC, font: { size: 10 } } } } }
    });

    if (statusChart) statusChart.destroy();
    const sd = { pending: 0, approved: 0, rejected: 0 };
    data.statusDistribution.forEach(d => sd[d.status] = d.count);
    statusChart = new Chart(document.getElementById('statusChart'), {
      type: 'doughnut',
      data: { labels: ['Pending', 'Approved', 'Rejected'], datasets: [{ data: [sd.pending, sd.approved, sd.rejected], backgroundColor: ['#f59e0b', '#10b981', '#ef4444'], borderWidth: 0, hoverOffset: 4 }] },
      options: { responsive: true, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: tickC, padding: 14, font: { size: 10 } } } } }
    });

    // Activity
    const list = document.getElementById('activityList');
    if (!data.recentMessages.length) list.innerHTML = '<div class="text-center py-10 text-slate-400 dark:text-zinc-600 text-xs">Belum ada pesan masuk</div>';
    else list.innerHTML = data.recentMessages.map(m => `
      <div class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-800/40 transition-colors">
        <div class="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center flex-shrink-0">
          <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
        </div>
        <div class="flex-1 min-w-0 text-xs text-slate-500 dark:text-zinc-400 truncate"><span class="font-medium text-slate-800 dark:text-zinc-200">${esc(m.first_name || 'User')}</span> — ${esc((m.content || '').substring(0, 60))}</div>
        <div class="text-[10px] text-slate-300 dark:text-zinc-600 flex-shrink-0">${timeAgo(m.created_at)}</div>
      </div>`).join('');
    lucide.createIcons();
  } catch (e) { toast('Gagal memuat: ' + e.message, 'error'); }
}

// ===== MESSAGES =====
let msgPage = 1, msgStatus = 'all', msgSearch = '', msgLimit = 15, selectedMsgs = new Set();
const ftActive = 'bg-violet-100 dark:bg-violet-600/10 text-violet-700 dark:text-violet-400';
const ftInactive = 'text-slate-500 dark:text-zinc-400';

document.querySelectorAll('#msgFilters .filter-tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('#msgFilters .filter-tab').forEach(b => { b.className = b.className.replace(/bg-violet-100|dark:bg-violet-600\/10|text-violet-700|dark:text-violet-400/g, '').trim(); if (!b.className.includes('text-slate-500')) b.className += ' ' + ftInactive; });
  btn.className = btn.className.replace(/text-slate-500|dark:text-zinc-400/g, '').trim() + ' ' + ftActive;
  msgStatus = btn.dataset.status; msgPage = 1; loadMessages();
}));

let msgT; document.getElementById('msgSearch').addEventListener('input', e => { clearTimeout(msgT); msgT = setTimeout(() => { msgSearch = e.target.value; msgPage = 1; loadMessages(); }, 400); });
document.getElementById('bulkApprove').addEventListener('click', () => bulkAction('approve'));
document.getElementById('bulkReject').addEventListener('click', () => bulkAction('reject'));
document.getElementById('msgPerPage').addEventListener('change', e => { msgLimit = +e.target.value; msgPage = 1; loadMessages(); });

async function loadMessages() {
  selectedMsgs.clear(); updateBulkUI();
  const el = document.getElementById('messagesList');
  el.innerHTML = '<div class="flex justify-center py-16"><div class="w-5 h-5 border-2 border-slate-200 dark:border-zinc-700 border-t-violet-500 rounded-full animate-spin"></div></div>';
  try {
    const data = await api(`/api/messages?page=${msgPage}&limit=${msgLimit}&status=${msgStatus}&search=${encodeURIComponent(msgSearch)}`);
    if (!data.messages.length) { el.innerHTML = '<div class="text-center py-20 text-slate-400 dark:text-zinc-600 text-xs">Tidak ada pesan</div>'; document.getElementById('msgPagination').innerHTML = ''; return; }

    el.innerHTML = data.messages.map(m => {
      const p = m.status === 'pending';
      const sc = { pending: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400', approved: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', rejected: 'bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400' };
      const initial = (m.first_name || 'U').charAt(0).toUpperCase();
      const cmtCount = m.comment_count || 0;

      return `
        <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/60 rounded-2xl shadow-sm dark:shadow-none overflow-hidden" id="post-${m.id}">
          <!-- Post Header -->
          <div class="px-5 pt-4 pb-2">
            <div class="flex items-start gap-3">
              ${p ? `<input type="checkbox" class="mt-3 w-4 h-4 accent-violet-500 cursor-pointer flex-shrink-0" onchange="toggleSelect(${m.id}, this.checked)">` : ''}
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">${initial}</div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-bold text-slate-900 dark:text-zinc-100">${esc(m.first_name || 'User')}</span>
                  ${m.username ? `<span class="text-xs text-slate-400 dark:text-zinc-500">@${esc(m.username)}</span>` : ''}
                  <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${sc[m.status] || ''}">${m.status}</span>
                </div>
                <div class="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5">${fmtDate(m.created_at)}</div>
              </div>
            </div>
          </div>

          <!-- Post Content -->
          <div class="px-5 pb-3">
            <p class="text-[14px] text-slate-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">${esc(m.content || '')}</p>
          </div>

          <!-- Post Stats Bar -->
          ${cmtCount > 0 ? `
          <div class="px-5 pb-2">
            <div class="text-[11px] text-slate-400 dark:text-zinc-500">${cmtCount} komentar</div>
          </div>` : ''}

          ${p ? `
          <!-- Hashtag Input -->
          <div class="px-5 pb-2">
            <div class="flex items-center gap-2">
              <i data-lucide="hash" class="w-3.5 h-3.5 text-violet-500 flex-shrink-0"></i>
              <input type="text" id="hashtag-${m.id}" placeholder="Tambahkan hashtag... (cth: #CurhatMalam #Random)" 
                class="flex-1 px-3 py-1.5 bg-violet-50 dark:bg-violet-600/5 border border-violet-200 dark:border-violet-600/20 rounded-lg text-xs text-slate-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition">
            </div>
          </div>
          ` : ''}

          <!-- Action Bar -->
          <div class="px-5 py-2 border-t border-slate-100 dark:border-zinc-800/50 flex items-center gap-1 flex-wrap">
            ${p ? `
              <button onclick="approveMsg(${m.id})" class="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-600/20 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5"><i data-lucide="check" class="w-3.5 h-3.5"></i> Approve</button>
              <button onclick="rejectMsg(${m.id})" class="px-3 py-1.5 bg-rose-50 dark:bg-rose-600/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-600/20 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5"><i data-lucide="x" class="w-3.5 h-3.5"></i> Reject</button>
            ` : ''}
            <button onclick="toggleComments(${m.id})" class="px-3 py-1.5 text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5"><i data-lucide="message-circle" class="w-3.5 h-3.5"></i> Komentar${cmtCount ? ' (' + cmtCount + ')' : ''}</button>
            <button onclick="deleteMsg(${m.id})" class="px-3 py-1.5 text-slate-400 dark:text-zinc-500 hover:bg-rose-50 dark:hover:bg-rose-600/10 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 ml-auto"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Hapus</button>
          </div>

          <!-- Comments Section (hidden by default) -->
          <div id="comments-${m.id}" class="hidden border-t border-slate-100 dark:border-zinc-800/50 bg-slate-50/50 dark:bg-zinc-950/30">
            <div class="px-5 py-3 space-y-3" id="comments-list-${m.id}">
              <div class="flex justify-center py-4"><div class="w-4 h-4 border-2 border-slate-200 dark:border-zinc-700 border-t-violet-500 rounded-full animate-spin"></div></div>
            </div>
          </div>
        </div>`;
    }).join('');
    renderPagination('msgPagination', data, p => { msgPage = p; loadMessages(); });
    lucide.createIcons();
  } catch (e) { el.innerHTML = `<div class="text-center py-12 text-rose-500 text-xs">${e.message}</div>`; }
}

function toggleSelect(id, c) { c ? selectedMsgs.add(id) : selectedMsgs.delete(id); updateBulkUI(); }
function updateBulkUI() { const el = document.getElementById('bulkActions'); if (selectedMsgs.size) { el.classList.remove('hidden'); el.classList.add('flex'); document.getElementById('bulkCount').textContent = selectedMsgs.size + ' dipilih'; } else { el.classList.add('hidden'); el.classList.remove('flex'); } }

async function approveMsg(id) {
  const hashtagInput = document.getElementById(`hashtag-${id}`);
  const hashtag = hashtagInput ? hashtagInput.value.trim() : '';
  try { await api(`/api/messages/${id}/approve`, { method: 'POST', body: { hashtag } }); toast('Pesan disetujui!'); loadMessages(); loadDashboard(); } catch (e) { toast(e.message, 'error'); }
}
async function rejectMsg(id) { try { await api(`/api/messages/${id}/reject`, { method: 'POST' }); toast('Pesan ditolak'); loadMessages(); loadDashboard(); } catch (e) { toast(e.message, 'error'); } }
async function deleteMsg(id) { if (!confirm('Hapus pesan ini? Jika sudah dipost, juga akan dihapus dari channel.')) return; try { await api(`/api/messages/${id}`, { method: 'DELETE' }); toast('Pesan dihapus!'); loadMessages(); loadDashboard(); } catch (e) { toast(e.message, 'error'); } }
async function bulkAction(action) { if (!selectedMsgs.size) return; if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} ${selectedMsgs.size} pesan?`)) return; try { const d = await api('/api/messages/bulk', { method: 'POST', body: { ids: [...selectedMsgs], action } }); toast(`${d.processed} pesan diproses`); loadMessages(); loadDashboard(); } catch (e) { toast(e.message, 'error'); } }

// ===== COMMENTS =====
async function toggleComments(msgId) {
  const section = document.getElementById(`comments-${msgId}`);
  if (!section) return;

  if (section.classList.contains('hidden')) {
    section.classList.remove('hidden');
    await loadComments(msgId);
  } else {
    section.classList.add('hidden');
  }
}

async function loadComments(msgId) {
  const list = document.getElementById(`comments-list-${msgId}`);
  try {
    const data = await api(`/api/messages/${msgId}/comments`);

    let html = '';

    if (!data.comments.length) {
      html += '<div class="text-center py-4 text-xs text-slate-400 dark:text-zinc-600">Belum ada komentar</div>';
    } else {
      html += data.comments.map(c => {
        const ci = (c.commenter_name || 'A').charAt(0).toUpperCase();
        const isAdmin = c.commenter_telegram_id === 'admin';
        const colors = isAdmin ? 'from-violet-500 to-purple-600' : ['from-blue-500 to-cyan-500', 'from-emerald-500 to-teal-500', 'from-orange-500 to-amber-500', 'from-pink-500 to-rose-500', 'from-indigo-500 to-violet-500'][(c.commenter_telegram_id || '0').charCodeAt(0) % 5];
        return `
          <div class="flex gap-2.5 group">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br ${colors} flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0 mt-0.5">${ci}</div>
            <div class="flex-1 min-w-0">
              <div class="bg-white dark:bg-zinc-800 border border-slate-100 dark:border-zinc-700/40 rounded-2xl rounded-tl-md px-3.5 py-2 inline-block max-w-full">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="text-xs font-bold text-slate-800 dark:text-zinc-200">${esc(c.commenter_name || 'Anonim')}</span>
                  ${c.commenter_username && c.commenter_username !== '' ? `<span class="text-[10px] text-slate-400 dark:text-zinc-500">@${esc(c.commenter_username)}</span>` : ''}
                </div>
                <p class="text-[13px] text-slate-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">${esc(c.content || '')}</p>
              </div>
              <div class="text-[10px] text-slate-300 dark:text-zinc-600 mt-1 ml-1">${timeAgo(c.created_at)}</div>
            </div>
          </div>`;
      }).join('');
    }

    list.innerHTML = html;
    lucide.createIcons();
  } catch (e) {
    list.innerHTML = `<div class="text-center py-4 text-xs text-rose-400">${e.message}</div>`;
  }
}
let userPage = 1, userSearch = '', userLimit = 20;
let userT; document.getElementById('userSearch').addEventListener('input', e => { clearTimeout(userT); userT = setTimeout(() => { userSearch = e.target.value; userPage = 1; loadUsers(); }, 400); });
document.getElementById('userPerPage').addEventListener('change', e => { userLimit = +e.target.value; userPage = 1; loadUsers(); });

async function loadUsers() {
  const tb = document.getElementById('usersTableBody');
  tb.innerHTML = '<tr><td colspan="7" class="text-center py-16"><div class="w-5 h-5 border-2 border-slate-200 dark:border-zinc-700 border-t-violet-500 rounded-full animate-spin mx-auto"></div></td></tr>';
  try {
    const data = await api(`/api/users?page=${userPage}&limit=${userLimit}&search=${encodeURIComponent(userSearch)}`);
    if (!data.users.length) { tb.innerHTML = '<tr><td colspan="7" class="text-center py-16 text-slate-400 dark:text-zinc-600 text-xs">Tidak ada pengguna</td></tr>'; document.getElementById('userPagination').innerHTML = ''; return; }
    tb.innerHTML = data.users.map(u => {
      const vipExpiry = u.is_vip && u.vip_expires_at ? new Date(u.vip_expires_at + 'Z') : null;
      const vipDaysLeft = vipExpiry ? Math.max(0, Math.ceil((vipExpiry - Date.now()) / 86400000)) : 0;
      const statusBadge = u.is_banned
        ? '<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400">Banned</span>'
        : u.is_vip
          ? `<div><span class="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">⭐ VIP</span><div class="text-[9px] text-amber-500 dark:text-amber-400/70 mt-0.5">${vipDaysLeft}h lagi</div></div>`
          : '<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Free</span>';
      const actions = [];
      actions.push(`<button onclick="topupUser(${u.id}, '${esc(u.first_name || 'User')}')" class="px-2.5 py-1 text-[10px] font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 rounded-lg transition-colors">💰 Top-up</button>`);
      if (u.is_banned) {
        actions.push(`<button onclick="unbanUser(${u.id})" class="px-2.5 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors">Unban</button>`);
      } else {
        actions.push(`<button onclick="banUser(${u.id})" class="px-2.5 py-1 text-[10px] font-semibold text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors">Ban</button>`);
        if (u.is_vip) {
          actions.push(`<button onclick="unsetVip(${u.id})" class="px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">Hapus VIP</button>`);
        } else {
          actions.push(`<button onclick="setVip(${u.id})" class="px-2.5 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-colors">⭐ Set VIP</button>`);
        }
      }
      return `
      <tr class="border-b border-slate-100 dark:border-zinc-800/40 hover:bg-slate-50 dark:hover:bg-zinc-800/20 transition-colors">
        <td class="px-5 py-3.5">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full ${u.is_vip ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-violet-100 dark:bg-violet-600/15 text-violet-600 dark:text-violet-400'} flex items-center justify-center text-[11px] font-bold flex-shrink-0">${u.is_vip ? '⭐' : (u.first_name || 'U').charAt(0)}</div>
            <div><div class="text-xs font-semibold text-slate-800 dark:text-zinc-200">${esc(u.first_name || '')} ${esc(u.last_name || '')}</div><div class="text-[10px] text-slate-400 dark:text-zinc-500">${u.username ? '@' + esc(u.username) : '-'}</div></div>
          </div>
        </td>
        <td class="px-5 py-3.5 font-mono text-[10px] text-slate-400 dark:text-zinc-500">${u.telegram_id}</td>
        <td class="px-5 py-3.5 text-xs font-bold text-violet-600 dark:text-violet-400">Rp${((u.balance || 0) + (u.referral_balance || 0)).toLocaleString('id-ID')}</td>
        <td class="px-5 py-3.5 text-xs font-bold">${u.message_count}</td>
        <td class="px-5 py-3.5">${statusBadge}</td>
        <td class="px-5 py-3.5 text-[10px] text-slate-400 dark:text-zinc-500">${fmtDate(u.last_active)}</td>
        <td class="px-5 py-3.5"><div class="flex items-center gap-1">${actions.join('')}</div></td>
      </tr>`;
    }).join('');
    renderPagination('userPagination', data, p => { userPage = p; loadUsers(); });
  } catch (e) { tb.innerHTML = `<tr><td colspan="7" class="text-center py-16 text-rose-500 text-xs">${e.message}</td></tr>`; }
}

async function banUser(id) { if (!confirm('Ban pengguna ini?')) return; try { await api(`/api/users/${id}/ban`,{method:'POST'}); toast('User dibanned'); loadUsers(); } catch(e) { toast(e.message,'error'); } }
async function unbanUser(id) { try { await api(`/api/users/${id}/unban`,{method:'POST'}); toast('User di-unban'); loadUsers(); } catch(e) { toast(e.message,'error'); } }

function setVip(id) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-xl">
      <h3 class="text-sm font-bold text-slate-900 dark:text-zinc-100 mb-1 flex items-center gap-2">⭐ Set VIP Member</h3>
      <p class="text-[11px] text-slate-500 dark:text-zinc-400 mb-4">Pesan VIP akan langsung terbit tanpa review admin.</p>
      <div class="grid grid-cols-3 gap-2 mb-3">
        <button class="vip-dur px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition" data-days="7">7 Hari</button>
        <button class="vip-dur px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition" data-days="30">30 Hari</button>
        <button class="vip-dur px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition" data-days="90">90 Hari</button>
      </div>
      <div class="flex items-center gap-2 mb-4">
        <input type="number" id="vipCustomDays" min="1" max="365" placeholder="Custom hari..." class="flex-1 px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs text-slate-800 dark:text-zinc-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition">
        <span class="text-[10px] text-slate-400 dark:text-zinc-500">hari</span>
      </div>
      <div class="flex gap-2">
        <button id="vipCancelBtn" class="flex-1 py-2 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition">Batal</button>
        <button id="vipConfirmBtn" class="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-xs font-semibold transition">⭐ Aktifkan VIP</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedDays = 0;
  overlay.querySelectorAll('.vip-dur').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.vip-dur').forEach(b => b.classList.remove('border-amber-400', 'bg-amber-50', 'dark:bg-amber-500/10'));
      btn.classList.add('border-amber-400', 'bg-amber-50', 'dark:bg-amber-500/10');
      selectedDays = +btn.dataset.days;
      document.getElementById('vipCustomDays').value = '';
    });
  });
  document.getElementById('vipCustomDays').addEventListener('input', e => {
    selectedDays = +e.target.value;
    overlay.querySelectorAll('.vip-dur').forEach(b => b.classList.remove('border-amber-400', 'bg-amber-50', 'dark:bg-amber-500/10'));
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('vipCancelBtn').addEventListener('click', () => overlay.remove());
  document.getElementById('vipConfirmBtn').addEventListener('click', async () => {
    if (!selectedDays || selectedDays < 1) { toast('Pilih durasi VIP', 'error'); return; }
    try {
      await api(`/api/users/${id}/vip`, { method: 'POST', body: { days: selectedDays } });
      toast(`⭐ VIP aktif selama ${selectedDays} hari!`);
      overlay.remove();
      loadUsers();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function unsetVip(id) { if (!confirm('Cabut VIP user ini?')) return; try { await api(`/api/users/${id}/unvip`,{method:'POST'}); toast('VIP dicabut'); loadUsers(); } catch(e) { toast(e.message,'error'); } }

function topupUser(id, name) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-xl">
      <h3 class="text-sm font-bold text-slate-900 dark:text-zinc-100 mb-1 flex items-center gap-2">💰 Top-Up Saldo</h3>
      <p class="text-[11px] text-slate-500 dark:text-zinc-400 mb-4">Tambahkan saldo untuk <strong>${esc(name)}</strong></p>
      <div class="space-y-2 mb-4">
        <div class="grid grid-cols-3 gap-2">
          <button class="topup-amt px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition" data-amount="10000">Rp10.000</button>
          <button class="topup-amt px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition" data-amount="25000">Rp25.000</button>
          <button class="topup-amt px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition" data-amount="50000">Rp50.000</button>
        </div>
        <div class="flex items-center gap-2">
          <input type="number" id="topupCustomAmount" min="1000" placeholder="Jumlah custom..." class="flex-1 px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs text-slate-800 dark:text-zinc-200 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition">
          <span class="text-[10px] text-slate-400 dark:text-zinc-500">Rp</span>
        </div>
      </div>
      <div class="flex gap-2">
        <button id="topupCancelBtn" class="flex-1 py-2 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition">Batal</button>
        <button id="topupConfirmBtn" class="flex-1 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold transition">💰 Top-Up</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedAmount = 0;
  overlay.querySelectorAll('.topup-amt').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.topup-amt').forEach(b => b.classList.remove('border-violet-400', 'bg-violet-50', 'dark:bg-violet-500/10'));
      btn.classList.add('border-violet-400', 'bg-violet-50', 'dark:bg-violet-500/10');
      selectedAmount = +btn.dataset.amount;
      document.getElementById('topupCustomAmount').value = '';
    });
  });
  document.getElementById('topupCustomAmount').addEventListener('input', e => {
    selectedAmount = +e.target.value;
    overlay.querySelectorAll('.topup-amt').forEach(b => b.classList.remove('border-violet-400', 'bg-violet-50', 'dark:bg-violet-500/10'));
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('topupCancelBtn').addEventListener('click', () => overlay.remove());
  document.getElementById('topupConfirmBtn').addEventListener('click', async () => {
    if (!selectedAmount || selectedAmount < 1000) { toast('Masukkan jumlah minimal Rp1.000', 'error'); return; }
    try {
      await api(`/api/users/${id}/topup`, { method: 'POST', body: { amount: selectedAmount } });
      toast(`💰 Top-up Rp${selectedAmount.toLocaleString('id-ID')} berhasil!`);
      overlay.remove();
      loadUsers();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ===== SETTINGS =====
const sFields = ['welcome_message','help_message','approve_message','reject_message','channel_id','channel_footer','channel_link','rate_limit','daily_limit','referral_cash_amount','referral_min_referrals','message_cost','pakasir_slug','pakasir_api_key'];
const sToggles = ['maintenance_mode','notify_admin','notify_comments','referral_enabled','auto_post','paid_message_enabled','topup_bot_enabled','topup_miniapp_enabled','transfer_enabled'];
const sSelects = [];

async function loadSettings() {
  try { const s = await api('/api/settings'); sFields.forEach(k => { const el = document.getElementById('set_' + k); if (el) el.value = (s[k] || '').replace(/\\n/g, '\n'); }); sToggles.forEach(k => { const el = document.getElementById('set_' + k); if (el) el.checked = s[k] === 'true'; }); sSelects.forEach(k => { const el = document.getElementById('set_' + k); if (el) el.value = s[k] || ''; }); }
  catch (e) { toast('Gagal memuat pengaturan', 'error'); }
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const body = {}; sFields.forEach(k => { const el = document.getElementById('set_' + k); if (el) body[k] = el.value.replace(/\n/g, '\\n'); }); sToggles.forEach(k => { const el = document.getElementById('set_' + k); if (el) body[k] = el.checked ? 'true' : 'false'; }); sSelects.forEach(k => { const el = document.getElementById('set_' + k); if (el) body[k] = el.value; });
  try { await api('/api/settings', { method: 'POST', body }); toast('Pengaturan disimpan!'); } catch (e) { toast(e.message, 'error'); }
});

document.getElementById('changePwBtn').addEventListener('click', async () => {
  const c = document.getElementById('currentPassword').value, n = document.getElementById('newPassword').value;
  if (!c || !n) { toast('Isi kedua field', 'error'); return; }
  try { await api('/api/change-password', { method: 'POST', body: { currentPassword: c, newPassword: n } }); toast('Password diganti!'); document.getElementById('currentPassword').value = ''; document.getElementById('newPassword').value = ''; }
  catch (e) { toast(e.message, 'error'); }
});

// ===== PAGINATION =====
function renderPagination(id, data, onClick) {
  const el = document.getElementById(id);
  if (data.totalPages <= 1) { el.innerHTML = `<div class="text-[10px] text-slate-400 dark:text-zinc-500">${data.total} data</div>`; return; }
  const s = Math.max(1, data.page - 2), e = Math.min(data.totalPages, data.page + 2);
  let h = `<button class="w-7 h-7 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-400 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-600 text-[11px] flex items-center justify-center transition disabled:opacity-30" ${data.page<=1?'disabled':''} data-p="1">«</button>`;
  h += `<button class="w-7 h-7 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-400 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-600 text-[11px] flex items-center justify-center transition disabled:opacity-30" ${data.page<=1?'disabled':''} data-p="${data.page-1}">‹</button>`;
  for (let i = s; i <= e; i++) h += `<button class="w-7 h-7 rounded-lg text-[11px] flex items-center justify-center font-medium transition ${i===data.page ? 'bg-violet-600 text-white' : 'border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-600'}" data-p="${i}">${i}</button>`;
  h += `<button class="w-7 h-7 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-400 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-600 text-[11px] flex items-center justify-center transition disabled:opacity-30" ${data.page>=data.totalPages?'disabled':''} data-p="${data.page+1}">›</button>`;
  h += `<button class="w-7 h-7 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-400 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-600 text-[11px] flex items-center justify-center transition disabled:opacity-30" ${data.page>=data.totalPages?'disabled':''} data-p="${data.totalPages}">»</button>`;
  h += `<span class="text-[10px] text-slate-400 dark:text-zinc-500 ml-1.5">${data.total} data</span>`;
  el.innerHTML = h;
  el.querySelectorAll('button:not(:disabled)').forEach(b => b.addEventListener('click', () => onClick(+b.dataset.p)));
}

// ===== SUPPORT =====
let supFilter = 'open', supPage = 1;

async function loadSupport() {
  const el = document.getElementById('supportList');
  el.innerHTML = '<div class="flex justify-center py-16"><div class="w-5 h-5 border-2 border-slate-200 dark:border-zinc-700 border-t-violet-500 rounded-full animate-spin"></div></div>';
  try {
    const data = await api(`/api/support-tickets?page=${supPage}&limit=20&status=${supFilter}`);
    if (!data.tickets.length) { el.innerHTML = '<div class="text-center py-20 text-slate-400 dark:text-zinc-600 text-xs">Tidak ada tiket</div>'; document.getElementById('supPagination').innerHTML = ''; return; }
    el.innerHTML = data.tickets.map(t => {
      const sc = { open: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400', replied: 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400', closed: 'bg-slate-100 dark:bg-slate-800/40 text-slate-500 dark:text-zinc-500' };
      return `
        <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/60 rounded-2xl p-5 shadow-sm dark:shadow-none">
          <div class="flex items-start justify-between mb-3">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-bold text-slate-900 dark:text-zinc-100">#SUP${t.id}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${sc[t.status] || ''}">${t.status}</span>
              </div>
              <div class="text-xs font-semibold text-slate-700 dark:text-zinc-300">${esc(t.subject || 'Tanpa subjek')}</div>
              <div class="text-[10px] text-slate-400 dark:text-zinc-500">${esc(t.user_name || '')} · ${fmtDate(t.created_at)}</div>
            </div>
            <div class="flex gap-1.5 flex-shrink-0">
              ${t.status !== 'closed' ? `<button onclick="replyTicket(${t.id})" class="px-3 py-1.5 bg-violet-50 dark:bg-violet-600/10 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-600/20 rounded-lg text-[11px] font-semibold transition-colors">Balas</button>` : ''}
              ${t.status !== 'closed' ? `<button onclick="closeTicket(${t.id})" class="px-3 py-1.5 text-slate-400 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg text-[11px] font-semibold transition-colors">Tutup</button>` : ''}
            </div>
          </div>
          <div class="bg-slate-50 dark:bg-zinc-800/60 rounded-xl p-3.5 text-[13px] text-slate-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">${esc(t.message)}</div>
          <div class="mt-2" id="conv-${t.id}">
            <button onclick="loadConversation(${t.id})" class="text-[11px] font-semibold text-violet-500 hover:text-violet-400 transition-colors">📋 Lihat Percakapan</button>
          </div>
        </div>`;
    }).join('');
    renderPagination('supPagination', data, p => { supPage = p; loadSupport(); });
  } catch(e) { el.innerHTML = `<div class="text-center py-16 text-rose-500 text-xs">${e.message}</div>`; }
}

function replyTicket(id) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[9000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-xl">
      <h3 class="text-sm font-bold text-slate-900 dark:text-zinc-100 mb-3">💬 Balas Tiket #SUP${id}</h3>
      <textarea id="replyText" rows="4" placeholder="Tulis balasan untuk pengguna..." class="w-full px-3 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm text-slate-800 dark:text-zinc-200 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 resize-none transition mb-4"></textarea>
      <div class="flex gap-2">
        <button id="replyCancelBtn" class="flex-1 py-2 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition">Batal</button>
        <button id="replyConfirmBtn" class="flex-1 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold transition">Kirim Balasan</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('replyCancelBtn').addEventListener('click', () => overlay.remove());
  document.getElementById('replyConfirmBtn').addEventListener('click', async () => {
    const reply = document.getElementById('replyText').value.trim();
    if (!reply) { toast('Tulis balasan', 'error'); return; }
    try {
      await api(`/api/support-tickets/${id}/reply`, { method: 'POST', body: { reply } });
      toast('✅ Balasan terkirim!');
      overlay.remove();
      loadSupport();
    } catch(e) { toast(e.message, 'error'); }
  });
}

async function closeTicket(id) {
  if (!confirm('Tutup tiket ini?')) return;
  try { await api(`/api/support-tickets/${id}/close`, { method: 'POST' }); toast('Tiket ditutup'); loadSupport(); } catch(e) { toast(e.message, 'error'); }
}

// ===== ANNOUNCEMENT =====
function resetAnnouncement() {
  document.getElementById('announcementText').value = '';
  document.getElementById('pinAnnouncement').checked = false;
  document.getElementById('announcementError').classList.add('hidden');
  document.getElementById('announcementSuccess').classList.add('hidden');
  document.getElementById('sendAnnouncementBtn').disabled = false;
  document.getElementById('sendAnnouncementBtn').innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> Kirim Pengumuman';
  lucide.createIcons();
}

document.getElementById('sendAnnouncementBtn').addEventListener('click', async () => {
  const text = document.getElementById('announcementText').value.trim();
  if (!text) {
    document.getElementById('announcementError').classList.remove('hidden');
    document.getElementById('announcementError').textContent = 'Tulis pesan pengumuman terlebih dahulu';
    return;
  }

  const target = document.querySelector('input[name="announceTarget"]:checked')?.value || 'channel';
  const pin = target === 'channel' && document.getElementById('pinAnnouncement').checked;
  const btn = document.getElementById('sendAnnouncementBtn');
  const err = document.getElementById('announcementError');
  const success = document.getElementById('announcementSuccess');
  err.classList.add('hidden');
  success.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<div class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Mengirim...';

  try {
    const result = await api('/api/announcement', { method: 'POST', body: { text, pin, target } });
    if (target === 'bot') {
      success.textContent = `✅ Broadcast terkirim! ${result.sent} berhasil, ${result.failed} gagal dari ${result.total} pengguna`;
    } else {
      success.textContent = pin ? '✅ Pengumuman terkirim & dipin di channel!' : '✅ Pengumuman terkirim ke channel!';
    }
    success.classList.remove('hidden');
    document.getElementById('announcementText').value = '';
    document.getElementById('pinAnnouncement').checked = false;
  } catch(e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> Kirim Pengumuman';
  lucide.createIcons();
});

// Show/hide pin section based on target
document.querySelectorAll('input[name="announceTarget"]').forEach(r => {
  r.addEventListener('change', () => {
    document.getElementById('pinSection').style.display = r.value === 'channel' ? '' : 'none';
  });
});

// ===== CHALLENGE =====
async function loadChallenges() {
  const el = document.getElementById('challengeList');
  el.innerHTML = '<div class="flex justify-center py-16"><div class="w-5 h-5 border-2 border-slate-200 dark:border-zinc-700 border-t-violet-500 rounded-full animate-spin"></div></div>';
  try {
    const data = await api('/api/challenges');
    if (!data.challenges.length) { el.innerHTML = '<div class="text-center py-16 text-slate-400 dark:text-zinc-600 text-xs">Belum ada challenge</div>'; return; }
    el.innerHTML = data.challenges.map(c => {
      const isActive = c.status === 'active';
      return `
        <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/60 rounded-2xl p-5 shadow-sm dark:shadow-none">
          <div class="flex items-start justify-between">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-bold text-slate-900 dark:text-zinc-100">${esc(c.title)}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${isActive ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600' : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'}">${isActive ? 'Aktif' : 'Selesai'}</span>
              </div>
              ${c.description ? `<div class="text-xs text-slate-600 dark:text-zinc-400 mt-1">${esc(c.description)}</div>` : ''}
              <div class="text-[10px] text-slate-400 dark:text-zinc-500 mt-2">
                ${fmtDate(c.start_time)} — ${fmtDate(c.end_time)}
                ${c.reward ? ` · Hadiah: ${esc(c.reward)}` : ''}
                · 🏆 ${c.winners_count} besar
              </div>
            </div>
            ${isActive ? `<button onclick="endChallenge(${c.id})" class="text-[10px] font-semibold text-rose-500 px-2 py-1 hover:bg-rose-50 rounded-lg">Akhiri</button>` : ''}
          </div>
          <button onclick="viewLeaderboard(${c.id})" class="mt-3 text-[11px] font-semibold text-violet-500 hover:text-violet-400">📊 Lihat Leaderboard</button>
        </div>`;
    }).join('');
  } catch(e) { el.innerHTML = `<div class="text-center py-16 text-rose-500 text-xs">${e.message}</div>`; }
}

async function endChallenge(id) {
  if (!confirm('Akhiri challenge ini?')) return;
  try { await api(`/api/challenges/${id}/end`, { method: 'POST' }); toast('Challenge diakhiri'); loadChallenges(); } catch(e) { toast(e.message, 'error'); }
}

async function viewLeaderboard(challengeId) {
  try {
    const data = await api(`/api/challenges/active`);
    const lb = data.leaderboard || [];
    let html = '<div class="fixed inset-0 z-[9000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"><div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-xl">';
    html += `<div class="flex items-center justify-between mb-4"><h3 class="text-sm font-bold text-slate-900 dark:text-zinc-100">🏆 Leaderboard</h3><button onclick="this.closest(\'.fixed\').remove()" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button></div>`;
    if (!lb.length) {
      html += '<div class="text-center py-8 text-slate-400 text-xs">Belum ada data</div>';
    } else {
      html += '<div class="space-y-2">';
      lb.forEach((u, i) => {
        const medals = { 0: '🥇', 1: '🥈', 2: '🥉' };
        const medal = medals[i] || `${i + 1}.`;
        html += `<div class="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-zinc-800/40 last:border-0">
          <span class="text-base w-8 text-center">${medal}</span>
          <div class="flex-1"><div class="text-xs font-semibold text-slate-800 dark:text-zinc-200">${esc(u.first_name || '')}</div><div class="text-[10px] text-slate-400">${u.username ? '@' + esc(u.username) : '-'}</div></div>
          <span class="text-xs font-bold text-violet-600">${u.count} undangan</span>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div></div>';
    const overlay = document.createElement('div');
    overlay.innerHTML = html;
    document.body.appendChild(overlay.firstElementChild);
    document.querySelector('.fixed.inset-0').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.remove(); });
  } catch(e) { toast(e.message, 'error'); }
}

function showCreateChallenge() {
  const overlay = document.getElementById('challengeModal');
  overlay.classList.remove('hidden');
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  overlay.innerHTML = `
    <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-xl">
      <h3 class="text-sm font-bold text-slate-900 dark:text-zinc-100 mb-4">🏆 Buat Challenge</h3>
      <div class="space-y-3">
        <input id="chTitle" placeholder="Judul challenge" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:border-violet-500">
        <input id="chDesc" placeholder="Deskripsi (opsional)" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:border-violet-500">
        <input id="chReward" placeholder="Hadiah (contoh: Rp100.000 + VIP 7 hari)" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:border-violet-500">
        <div class="grid grid-cols-2 gap-2">
          <div><label class="text-[10px] text-slate-500">Mulai</label><input id="chStart" type="datetime-local" value="${now.toISOString().slice(0,16)}" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs outline-none focus:border-violet-500"></div>
          <div><label class="text-[10px] text-slate-500">Selesai</label><input id="chEnd" type="datetime-local" value="${tomorrow.toISOString().slice(0,16)}" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs outline-none focus:border-violet-500"></div>
        </div>
        <div><label class="text-[10px] text-slate-500">Jumlah Pemenang</label><input id="chWinners" type="number" value="3" min="1" max="20" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:border-violet-500"></div>
      </div>
      <div class="flex gap-2 mt-4">
        <button onclick="document.getElementById('challengeModal').classList.add('hidden')" class="flex-1 py-2 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800">Batal</button>
        <button onclick="createChallenge()" class="flex-1 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold">Buat</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
}

async function createChallenge() {
  const title = document.getElementById('chTitle').value.trim();
  const start = document.getElementById('chStart').value;
  const end = document.getElementById('chEnd').value;
  if (!title || !start || !end) { toast('Isi judul, mulai, dan selesai', 'error'); return; }
  try {
    await api('/api/challenges', {
      method: 'POST',
      body: {
        title, description: document.getElementById('chDesc').value.trim(),
        reward: document.getElementById('chReward').value.trim(),
        winners_count: +document.getElementById('chWinners').value || 3,
        start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString()
      }
    });
    toast('✅ Challenge dibuat!');
    document.getElementById('challengeModal').classList.add('hidden');
    loadChallenges();
  } catch(e) { toast(e.message, 'error'); }
}

// ===== AVATAR ADMIN =====
async function loadAvatarsAdmin() {
  const el = document.getElementById('avatarListAdmin');
  el.innerHTML = '<div class="flex justify-center py-16"><div class="w-5 h-5 border-2 border-slate-200 dark:border-zinc-700 border-t-violet-500 rounded-full animate-spin"></div></div>';
  try {
    const data = await api('/api/avatars');
    if (!data.avatars.length) { el.innerHTML = '<div class="text-center py-12 text-slate-400 text-xs">Belum ada avatar</div>'; return; }
    el.innerHTML = data.avatars.map(a => `
      <div class="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/60 rounded-2xl p-4 shadow-sm flex items-center gap-4">
        <img src="${esc(a.image_url)}" style="width:56px;height:56px;border-radius:14px;flex-shrink:0">
        <div style="flex:1">
          <div class="text-sm font-bold text-slate-900 dark:text-zinc-100">${esc(a.name)}</div>
          <div class="text-xs text-slate-500">Rp${a.price.toLocaleString('id-ID')}</div>
        </div>
        <div class="flex gap-1.5">
          <button onclick="showEditAvatar(${a.id},'${esc(a.name)}',${a.price},'${esc(a.image_url)}')" class="px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 rounded-lg">Edit</button>
          <button onclick="deleteAvatar(${a.id})" class="px-2.5 py-1 text-[10px] font-semibold text-rose-500 hover:bg-rose-50 rounded-lg">Hapus</button>
        </div>
      </div>`).join('');
  } catch(e) { el.innerHTML = `<div class="text-center py-12 text-rose-500 text-xs">${e.message}</div>`; }
}

function showAddAvatar() {
  showAvatarForm(null, '', 0, '');
}

function showEditAvatar(id, name, price, image_url) {
  showAvatarForm(id, name, price, image_url);
}

function showAvatarForm(id, name, price, image_url) {
  const modal = document.getElementById('avatarModal');
  modal.classList.remove('hidden');
  modal.innerHTML = `
    <div class="bg-white dark:bg-zinc-900 border border-slate-200 rounded-2xl p-6 w-full max-w-md shadow-xl">
      <h3 class="text-sm font-bold mb-4">${id ? 'Edit' : 'Tambah'} Avatar</h3>
      <div class="space-y-3">
        <input id="avName" value="${name}" placeholder="Nama avatar" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border rounded-xl text-sm outline-none focus:border-violet-500">
        <input id="avPrice" type="number" value="${price}" placeholder="Harga (Rp)" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border rounded-xl text-sm outline-none focus:border-violet-500">
        ${id ? `<div id="avOldImage" class="text-xs text-slate-400">URL tersimpan: ${esc(image_url)}</div>` : ''}
        <div><label class="text-[10px] text-slate-500">Upload Gambar</label><input type="file" id="avImage" accept="image/*" class="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-800 border rounded-xl text-sm outline-none focus:border-violet-500 mt-1 file:mr-3 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-violet-50 file:text-violet-600"></div>
        ${id ? `<input type="hidden" id="avId" value="${id}">` : ''}
        <input type="hidden" id="avImageUrl" value="${image_url}">
      </div>
      <div class="flex gap-2 mt-4">
        <button onclick="document.getElementById('avatarModal').classList.add('hidden')" class="flex-1 py-2 border rounded-xl text-xs text-slate-500 hover:bg-slate-100">Batal</button>
        <button onclick="saveAvatar(${id ? id : 'null'})" class="flex-1 py-2 bg-violet-600 text-white rounded-xl text-xs font-semibold">Simpan</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
}

async function saveAvatar(id) {
  const name = document.getElementById('avName').value.trim();
  const price = parseInt(document.getElementById('avPrice').value) || 0;
  const fileInput = document.getElementById('avImage');
  const file = fileInput ? fileInput.files[0] : null;
  let image_url = document.getElementById('avImageUrl').value;

  if (!name) { toast('Nama wajib diisi', 'error'); return; }
  if (!file && !image_url) { toast('Upload gambar atau isi URL', 'error'); return; }

  // Upload file if selected
  if (file) {
    const formData = new FormData();
    formData.append('avatar', file);
    const uploadRes = await fetch('/api/upload-avatar', { method: 'POST', body: formData });
    const uploadData = await uploadRes.json();
    if (!uploadData.success) { toast(uploadData.error || 'Upload gagal', 'error'); return; }
    image_url = uploadData.url;
  }

  try {
    if (id) {
      await api(`/api/avatars/${id}`, { method: 'PUT', body: { name, price, image_url } });
    } else {
      await api('/api/avatars', { method: 'POST', body: { name, price, image_url } });
    }
    toast('✅ Avatar disimpan!');
    document.getElementById('avatarModal').classList.add('hidden');
    loadAvatarsAdmin();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteAvatar(id) {
  if (!confirm('Hapus avatar ini? Avatar yang sudah dibeli user juga akan terhapus.')) return;
  try { await api(`/api/avatars/${id}`, { method: 'DELETE' }); toast('Avatar dihapus'); loadAvatarsAdmin(); } catch(e) { toast(e.message, 'error'); }
}

async function loadConversation(ticketId) {
  const el = document.getElementById('conv-' + ticketId);
  try {
    const data = await api(`/api/support-tickets/${ticketId}/messages`);
    if (!data.messages.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="mt-3 space-y-2">${data.messages.map(m => `
      <div class="flex gap-2">
        <span class="text-[10px] font-bold flex-shrink-0 ${m.sender === 'admin' ? 'text-violet-500' : 'text-emerald-500'}">${m.sender === 'admin' ? 'Admin' : 'User'}</span>
        <div class="flex-1 bg-slate-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2 text-[12px] text-slate-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">${esc(m.message)}</div>
        <span class="text-[9px] text-slate-400 dark:text-zinc-600 flex-shrink-0 self-end">${timeAgo(m.created_at)}</span>
      </div>
    `).join('')}</div>`;
  } catch(e) { el.innerHTML = ''; }
}

// ===== INIT =====
(async () => {
  try { const d = await api('/auth/me'); document.getElementById('adminName').textContent = d.admin.username; document.getElementById('adminAvatar').textContent = d.admin.username.charAt(0).toUpperCase(); }
  catch { window.location.href = '/login'; return; }
  lucide.createIcons();
  navigateTo('dashboard');
})();
