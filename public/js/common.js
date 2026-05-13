const API = '';

function getToken() { return localStorage.getItem('token'); }
function getUser() { return JSON.parse(localStorage.getItem('user') || 'null'); }

async function apiFetch(url, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...opts.headers };
  const res = await fetch(API + url, { ...opts, headers });
  if (res.status === 401 && !url.includes('/login')) {
    logout();
    throw new Error('Sessiya tugadi, qayta kiring');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server xatosi (${res.status})`);
  }
  if (!res.ok) throw new Error(data?.error || `Server xatosi (${res.status})`);
  return data;
}

function logout() {
  localStorage.clear();
  window.location.href = '/login.html?v=' + Date.now();
}

function toast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || '•'}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.animation = 'fadeOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, 3500);
}

function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function gradeClass(g) {
  if (!g) return 'grade-d';
  if (g >= 90) return 'grade-a';
  if (g >= 75) return 'grade-b';
  if (g >= 60) return 'grade-c';
  return 'grade-d';
}

function statusBadge(s) {
  const map = {
    pending: '<span class="badge badge-gray">Kutilmoqda</span>',
    in_progress: '<span class="badge badge-info">Jarayonda</span>',
    submitted: '<span class="badge badge-warning">Topshirildi</span>',
    graded: '<span class="badge badge-success">Baholandi</span>',
    active: '<span class="badge badge-success">Faol</span>',
    completed: '<span class="badge badge-primary">Yakunlandi</span>',
    archived: '<span class="badge badge-gray">Arxiv</span>',
  };
  return map[s] || `<span class="badge badge-gray">${s}</span>`;
}

// Protect panel pages
function requireAuth(role) {
  const user = getUser();
  const token = getToken();
  if (!token || !user) { window.location.href = '/login.html?v=' + Date.now(); return null; }
  if (role && user.role !== role) { window.location.href = '/login.html?v=' + Date.now(); return null; }
  return user;
}

// Init sidebar active link
function initNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });

  // Mobile sidebar toggle
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', e => {
      if (!sidebar.contains(e.target) && e.target !== toggle) sidebar.classList.remove('open');
    });
  }
}

async function downloadTask(taskId, fileName) {
  try {
    const token = getToken();
    if (!token) throw new Error("Avtorizatsiya yo'q");

    toast('Yuklanmoqda...', 'info');
    const res = await fetch(`/api/teacher/tasks/${taskId}/download`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Serverda fayl topilmadi');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName || `vazifa_${taskId}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (err) {
    toast(err.message, 'error');
  }
}
