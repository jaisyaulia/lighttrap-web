/* ============================================
   LIGHTTRAP UV — APP.JS
   ============================================ */

const API = 'http://localhost:3000/api';

// ============================================
// STATE
// ============================================
let currentMode = 'auto';
let powerState  = false;

let luxChart    = null;

let chartLabels = [];
let chartData   = [];

// State jadwal
let scheduleList  = [];      // semua jadwal dari server
let editingId     = null;    // null = tambah baru, angka = edit

/* ============================================
   NAVIGASI HALAMAN
   ============================================ */
function showPage(name) {

  document.querySelectorAll('.page')
    .forEach(p => {
      p.classList.remove('active');
    });

  document.querySelectorAll('.ni')
    .forEach(n => {
      n.classList.remove('active');
      const ico = n.querySelector('.ni-ico');
      if (ico) {
        ico.style.background = '';
        ico.style.color      = '';
      }
    });

  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');

  const nav = document.getElementById('nav-' + name);
  if (nav) {
    nav.classList.add('active');
    const ico = nav.querySelector('.ni-ico');
    if (ico) {
      ico.style.background = 'var(--pri)';
      ico.style.color      = '#fff';
    }
  }

  if (name === 'dashboard') { fetchStatus(); fetchHistory(); }
  if (name === 'history')   { fetchHistory(); }
  if (name === 'jadwal')    { fetchSchedules(); }
  if (name === 'notifikasi'){ fetchNotifications(); }
}

/* ============================================
   FORMAT WAKTU
   ============================================ */
function formatTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function timeAgo(isoString) {
  if (!isoString) return '—';
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (diff < 60)   return `${diff} detik lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  return `${Math.floor(diff / 3600)} jam lalu`;
}

/* ============================================
   INIT CHART
   ============================================ */
function initChart() {
  const canvas = document.getElementById('luxChart');
  if (!canvas) return;

  luxChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Lux',
        data: chartData,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.12)',
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });

  console.log('[Chart] Initialized');
}

/* ============================================
   FETCH STATUS
   ============================================ */
async function fetchStatus() {
  try {
    const res  = await fetch(`${API}/status`);
    const json = await res.json();
    if (!json.success) return;

    const { lampStatus, fanStatus, lux, mode, lastUpdated, mqttConnected } = json.data;

    powerState  = lampStatus;
    currentMode = mode || 'auto';

    setConnDot('dot-mqtt',   mqttConnected ? 'green' : 'red');
    setConnDot('dot-influx', 'green');

    updateDashboard(lampStatus, fanStatus, lux, mode);
    updateKontrol(lampStatus, fanStatus, lux, mode);
    updateActivityLog(lampStatus, fanStatus, lux, mode, lastUpdated);
    updateDashSchedule();

    const upd = document.getElementById('lastUpdate');
    if (upd) upd.textContent = 'Diperbarui ' + timeAgo(lastUpdated);

  } catch (err) {
    console.error('[fetchStatus]', err.message);
  }
}

/* ============================================
   FETCH HISTORY
   ============================================ */
async function fetchHistory() {
  // Ambil range dari dropdown (halaman history) kalau ada
  const rangeEl = document.getElementById('historyRange');
  const range   = rangeEl ? rangeEl.value : '24h';

  // Tampilkan loading di tabel
  const tbody = document.getElementById('historyBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3)">Memuat data...</td></tr>';
  }

  try {
    const res = await fetch(
      `${API}/history?range=${range}&t=${Date.now()}`,
      { cache: 'no-store' }
    );
    const json = await res.json();

    if (!json.success) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#ef4444">Gagal memuat data</td></tr>';
      return;
    }

    const data = json.data || [];

    // ── RENDER TABEL ────────────────────────────────
    if (tbody) {
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3)">Belum ada data di rentang ini</td></tr>';
      } else {
        tbody.innerHTML = data.map(item => {
          const waktu  = formatTime(item.time);
          const lux    = item.lux  !== undefined ? parseFloat(item.lux).toFixed(1)  + ' lx' : '—';
          const lamp   = item.lamp ? '<span class="chip on">ON</span>'  : '<span class="chip off">OFF</span>';
          const fan    = item.fan  ? '<span class="chip on">ON</span>'  : '<span class="chip off">OFF</span>';
          const mode   = item.mode || '—';
          return `<tr>
            <td>${waktu}</td>
            <td>${lux}</td>
            <td>${lamp}</td>
            <td>${fan}</td>
            <td>${escHtml(mode)}</td>
          </tr>`;
        }).join('');
      }
    }

    // ── UPDATE CHART (20 data terbaru, dibalik agar kronologis) ──
    if (luxChart && data.length > 0) {
      const latest = data.slice(0, 20).reverse();
      luxChart.data.labels = latest.map(item =>
        new Date(item.time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      );
      luxChart.data.datasets[0].data = latest.map(item => parseFloat(item.lux || 0));
      luxChart.update();
      console.log('[Chart] Updated:', latest.length, 'points');
    }

  } catch (err) {
    console.error('[fetchHistory]', err.message);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#ef4444">⚠ Gagal terhubung ke server</td></tr>';
    }
  }
}

/* ============================================
   DASHBOARD
   ============================================ */
function updateDashboard(lamp, fan, lux, mode) {
  setText('dashLux', lux !== null ? lux : '—');

  const dashLamp = document.getElementById('dashLamp');
  if (dashLamp) {
    dashLamp.textContent = lamp ? '● Menyala' : '○ Mati';
    dashLamp.style.color = lamp ? 'var(--pri)' : 'var(--text3)';
  }

  const dashFan = document.getElementById('dashFan');
  if (dashFan) {
    dashFan.textContent = fan ? '● Aktif' : '○ Mati';
    dashFan.style.color = fan ? 'var(--fan)' : 'var(--text3)';
  }

  setChip('chipLamp', lamp);
  setChip('chipFan', fan);

  const mb = document.getElementById('dashModeBadge');
  if (mb) {
    const modeLabel = { auto: 'Otomatis', manual: 'Manual', jadwal: 'Jadwal' };
    mb.textContent = 'Mode: ' + (modeLabel[mode] || mode);
  }
}

/* ============================================
   KONTROL
   ============================================ */
function updateKontrol(lamp, fan, lux, mode) {
  const btn  = document.getElementById('powerBtn');
  const ptxt = document.getElementById('powerTxt');
  const plbl = document.getElementById('powerLabel');
  const psub = document.getElementById('powerSub');

  if (btn) {
    if (lamp) {
      btn.className    = 'power-btn on';
      ptxt.textContent = 'ON';
      plbl.textContent = 'Sistem Aktif';
      psub.textContent = 'Lampu UV & Kipas menyala';
    } else {
      btn.className    = 'power-btn off';
      ptxt.textContent = 'OFF';
      plbl.textContent = 'Sistem Mati';
      psub.textContent = 'Lampu UV & Kipas mati';
    }
  }

  const ctrlLux  = document.getElementById('ctrlLux');
  const ctrlMode = document.getElementById('ctrlMode');
  if (ctrlLux)  ctrlLux.textContent  = (lux !== null ? lux : '—') + ' lx';
  if (ctrlMode) ctrlMode.textContent = mode || '—';

  ['auto', 'manual', 'jadwal'].forEach(m => {
    const el = document.getElementById('mode-' + m);
    if (el) el.classList.toggle('selected', m === mode);
  });

  currentMode = mode || 'auto';
}

/* ============================================
   TOGGLE POWER
   ============================================ */
async function togglePower() {
  if (currentMode !== 'manual') {
    const konfirm = confirm(
      'Mode saat ini: ' + currentMode.toUpperCase() +
      '\n\nTombol ON/OFF hanya untuk mode Manual.\nGanti ke Manual sekarang?'
    );
    if (!konfirm) return;

    const success = await saveModeSilent('manual');
    if (!success) { alert('Gagal mengubah mode'); return; }
  }

  const command = powerState ? 'OFF' : 'ON';

  try {
    const res  = await fetch(`${API}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const json = await res.json();

    if (json.success) {
      powerState  = !powerState;
      currentMode = 'manual';
      updateKontrol(powerState, powerState, null, 'manual');
    } else {
      alert('Gagal: ' + (json.message || 'Error'));
    }
  } catch (err) {
    console.error('[togglePower]', err.message);
  }
}

/* ============================================
   MODE
   ============================================ */
function selectMode(mode) {
  currentMode = mode;
  ['auto', 'manual', 'jadwal'].forEach(m => {
    const el = document.getElementById('mode-' + m);
    if (el) el.classList.toggle('selected', m === mode);
  });
}

async function saveModeSilent(mode) {
  try {
    currentMode = mode;
    selectMode(mode);
    const res  = await fetch(`${API}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    const json = await res.json();
    return json.success;
  } catch (err) {
    console.error('[saveModeSilent]', err.message);
    return false;
  }
}

async function saveMode() {
  const success = await saveModeSilent(currentMode);
  if (success) alert('Mode berhasil diubah');
  else         alert('Gagal ubah mode');
}

/* ============================================
   HELPERS
   ============================================ */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setChip(id, isOn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = isOn ? 'ON' : 'OFF';
  el.className   = 'chip ' + (isOn ? 'on' : 'off');
}

function setConnDot(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'cd ' + state;
}

/* ============================================
   ACTIVITY LOG (dashboard)
   ============================================ */
const activityLogs = [];
let lastLoggedTime = null; // timestamp terakhir yang sudah masuk ke log

function updateActivityLog(lamp, fan, lux, mode, time) {
  const el = document.getElementById('activityLog');
  if (!el) return;

  // Hanya tambah log kalau:
  //  1. `time` ada (server kirim timestamp)
  //  2. `time` berbeda dari yang terakhir di-log (data benar-benar baru dari sensor)
  //  3. `lux` bukan null / undefined (sensor aktif mengirim data)
  if (time && time !== lastLoggedTime && lux !== null && lux !== undefined) {
    lastLoggedTime = time;

    const label = lamp
      ? `Sistem ON — ${lux} lx · Mode ${mode}`
      : `Sistem OFF · Mode ${mode}`;

    activityLogs.unshift({ label, time, lamp });
    if (activityLogs.length > 10) activityLogs.pop();
  }

  // Render
  if (activityLogs.length === 0) {
    el.innerHTML = `<div class="tl-item">
      <div class="tl-dot-wrap"><div class="tl-dot gray"></div></div>
      <div class="tl-content"><div class="tl-title">Belum ada aktivitas</div></div>
    </div>`;
    return;
  }

  el.innerHTML = activityLogs.map(log => {
    const dotColor = log.lamp ? 'green' : 'gray';
    return `<div class="tl-item">
      <div class="tl-dot-wrap"><div class="tl-dot ${dotColor}"></div></div>
      <div class="tl-content">
        <div class="tl-title">${escHtml(log.label)}</div>
        <div class="tl-time" style="font-size:11px;color:var(--text3)">${timeAgo(log.time)}</div>
      </div>
    </div>`;
  }).join('');
}

/* ============================================
   JADWAL AKTIF HARI INI (dashboard)
   ============================================ */
const HARI_ID = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
const DAY_BACKEND_TO_FRONTEND = {
  Mon:'Sen', Tue:'Sel', Wed:'Rab', Thu:'Kam', Fri:'Jum', Sat:'Sab', Sun:'Min'
};

function updateDashSchedule() {
  const el = document.getElementById('dashScheduleList');
  if (!el) return;

  const hariIdx     = new Date().getDay();          // 0=Sun … 6=Sat
  const hariBackend = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][hariIdx];

  const hariIni = scheduleList.filter(s =>
    s.active && (s.days || []).includes(hariBackend)
  );

  if (hariIni.length === 0) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3)">Tidak ada jadwal aktif hari ini</div>';
    return;
  }

  el.innerHTML = hariIni.map(s => `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span style="color:var(--text1);font-weight:500">${escHtml(s.name)}</span>
      <span style="color:var(--pri);font-weight:600">${s.startTime} – ${s.endTime}</span>
    </div>`).join('');
}

/* ============================================
   JADWAL — FETCH
   ============================================ */
async function fetchSchedules() {
  const container = document.getElementById('scheduleList');

  if (container) {
    container.innerHTML = '<p style="color:var(--text3);font-size:13px;">Memuat jadwal...</p>';
  }

  try {
    const res  = await fetch(`${API}/schedules`);
    const json = await res.json();

    if (!json.success) {
      if (container) container.innerHTML = '<p style="color:var(--text3);">Gagal memuat jadwal.</p>';
      return;
    }

    scheduleList = json.data || [];
    renderScheduleList();

  } catch (err) {
    console.error('[fetchSchedules]', err.message);
    if (container) {
      container.innerHTML = '<p style="color:#ef4444;font-size:13px;">⚠ Gagal terhubung ke server.</p>';
    }
  }
}

/* ============================================
   JADWAL — RENDER LIST
   ============================================ */
const DAY_LABEL = {
  Mon: 'Sen', Tue: 'Sel', Wed: 'Rab',
  Thu: 'Kam', Fri: 'Jum', Sat: 'Sab', Sun: 'Min',
};

const DAY_FRONTEND_TO_BACKEND = {
  Sen: 'Mon', Sel: 'Tue', Rab: 'Wed',
  Kam: 'Thu', Jum: 'Fri', Sab: 'Sat', Min: 'Sun',
};

function renderScheduleList() {
  const container = document.getElementById('scheduleList');
  if (!container) return;

  const visible = scheduleList.filter(s => s.name !== '__deleted__');

  if (visible.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px 0;color:var(--text3);font-size:13px;">
        <div style="font-size:28px;margin-bottom:8px;">📅</div>
        Belum ada jadwal tersimpan.<br>Tambah jadwal di sebelah kanan.
      </div>`;
    return;
  }

  container.innerHTML = visible.map(s => {
    const dayLabels = (s.days || [])
      .map(d => DAY_LABEL[d] || d)
      .join(' · ');

    const activeColor = s.active ? 'var(--pri)' : 'var(--text3)';
    const activeBadge = s.active
      ? `<span style="background:#dcfce7;color:#16a34a;font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600;">Aktif</span>`
      : `<span style="background:#f3f4f6;color:var(--text3);font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600;">Nonaktif</span>`;

    return `
      <div style="
        background:var(--card);border:1px solid var(--border);
        border-radius:12px;padding:14px 16px;margin-bottom:10px;
        display:flex;flex-direction:column;gap:6px;
        border-left:3px solid ${activeColor};
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:600;font-size:14px;color:var(--text1);">${escHtml(s.name)}</span>
          ${activeBadge}
        </div>
        <div style="font-size:13px;color:var(--text2);">
          🕐 ${s.startTime} – ${s.endTime}
        </div>
        <div style="font-size:12px;color:var(--text3);">
          📆 ${dayLabels || '—'}
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
          <button
            onclick="editSchedule(${s.id})"
            style="flex:1;min-width:70px;padding:6px;border:1px solid var(--border);background:var(--bg);
                   color:var(--text2);border-radius:8px;font-size:12px;cursor:pointer;">
            ✏️ Edit
          </button>
          <button
            onclick="toggleScheduleActive(${s.id})"
            style="flex:1;min-width:70px;padding:6px;border:1px solid var(--border);background:var(--bg);
                   color:var(--text2);border-radius:8px;font-size:12px;cursor:pointer;">
            ${s.active ? '⏸ Nonaktifkan' : '▶️ Aktifkan'}
          </button>
          <button
            onclick="deleteSchedule(${s.id})"
            style="padding:6px 12px;border:1px solid #fca5a5;background:#fff5f5;
                   color:#ef4444;border-radius:8px;font-size:12px;cursor:pointer;">
            🗑
          </button>
        </div>
      </div>`;
  }).join('');
}

/* ============================================
   JADWAL — FORM: PILIH HARI
   ============================================ */
let selectedDays = [];

function toggleDay(btn) {
  const day = btn.dataset.day;
  const idx = selectedDays.indexOf(day);

  if (idx === -1) {
    selectedDays.push(day);
    btn.style.background  = 'var(--pri)';
    btn.style.color       = '#fff';
    btn.style.borderColor = 'var(--pri)';
  } else {
    selectedDays.splice(idx, 1);
    btn.style.background  = '';
    btn.style.color       = '';
    btn.style.borderColor = '';
  }
}

function setSelectedDays(backendDays) {
  selectedDays = [];

  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.style.background  = '';
    btn.style.color       = '';
    btn.style.borderColor = '';
  });

  (backendDays || []).forEach(bd => {
    const frontendKey = DAY_LABEL[bd] || bd;
    const btn = document.querySelector(`.day-btn[data-day="${frontendKey}"]`);
    if (btn) {
      selectedDays.push(frontendKey);
      btn.style.background  = 'var(--pri)';
      btn.style.color       = '#fff';
      btn.style.borderColor = 'var(--pri)';
    }
  });
}

/* ============================================
   JADWAL — FORM: RESET / ISI UNTUK EDIT
   ============================================ */
function resetScheduleForm() {
  editingId = null;

  const nameEl  = document.getElementById('schedName');
  const startEl = document.getElementById('schedStart');
  const endEl   = document.getElementById('schedEnd');
  const btnEl   = document.getElementById('schedSubmitBtn');
  const titleEl = document.getElementById('schedFormTitle');

  if (nameEl)  nameEl.value  = '';
  if (startEl) startEl.value = '';
  if (endEl)   endEl.value   = '';

  if (btnEl)   btnEl.textContent   = 'Simpan Jadwal';
  if (titleEl) titleEl.textContent = 'TAMBAH / EDIT JADWAL';

  setSelectedDays([]);
}

function editSchedule(id) {
  const s = scheduleList.find(x => x.id === id);
  if (!s) return;

  editingId = id;

  const nameEl  = document.getElementById('schedName');
  const startEl = document.getElementById('schedStart');
  const endEl   = document.getElementById('schedEnd');
  const btnEl   = document.getElementById('schedSubmitBtn');
  const titleEl = document.getElementById('schedFormTitle');

  if (nameEl)  nameEl.value  = s.name;
  if (startEl) startEl.value = s.startTime;
  if (endEl)   endEl.value   = s.endTime;

  if (btnEl)   btnEl.textContent   = 'Perbarui Jadwal';
  if (titleEl) titleEl.textContent = 'EDIT JADWAL';

  setSelectedDays(s.days || []);

  const formEl = document.getElementById('schedFormSection');
  if (formEl) formEl.scrollIntoView({ behavior: 'smooth' });
}

/* ============================================
   JADWAL — SUBMIT (TAMBAH / EDIT)
   ============================================ */
async function submitSchedule() {
  const nameEl  = document.getElementById('schedName');
  const startEl = document.getElementById('schedStart');
  const endEl   = document.getElementById('schedEnd');

  const name      = nameEl  ? nameEl.value.trim()  : '';
  const startTime = startEl ? startEl.value.trim() : '';
  const endTime   = endEl   ? endEl.value.trim()   : '';

  if (!name) {
    alert('Nama jadwal tidak boleh kosong.');
    if (nameEl) nameEl.focus();
    return;
  }
  if (!startTime || !endTime) {
    alert('Waktu mulai dan selesai harus diisi.');
    return;
  }
  if (startTime >= endTime) {
    alert('Waktu mulai harus lebih awal dari waktu selesai.');
    return;
  }
  if (selectedDays.length === 0) {
    alert('Pilih minimal satu hari aktif.');
    return;
  }

  const backendDays = selectedDays.map(d => DAY_FRONTEND_TO_BACKEND[d] || d);
  const payload = { name, startTime, endTime, days: backendDays, active: true };

  try {
    let res;

    if (editingId !== null) {
      res = await fetch(`${API}/schedules/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`${API}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    const json = await res.json();

    if (json.success) {
      resetScheduleForm();
      await fetchSchedules();
    } else {
      alert('Gagal menyimpan jadwal: ' + (json.message || 'Error'));
    }

  } catch (err) {
    console.error('[submitSchedule]', err.message);
    alert('Gagal terhubung ke server. Pastikan backend berjalan.');
  }
}

/* ============================================
   JADWAL — TOGGLE AKTIF / NONAKTIF
   ============================================ */
async function toggleScheduleActive(id) {
  const s = scheduleList.find(x => x.id === id);
  if (!s) return;

  try {
    const res  = await fetch(`${API}/schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, active: !s.active }),
    });
    const json = await res.json();

    if (json.success) {
      await fetchSchedules();
    } else {
      alert('Gagal mengubah status jadwal.');
    }
  } catch (err) {
    console.error('[toggleScheduleActive]', err.message);
    alert('Gagal terhubung ke server.');
  }
}

/* ============================================
   JADWAL — HAPUS
   ============================================ */
async function deleteSchedule(id) {
  const s = scheduleList.find(x => x.id === id);
  const nama = s ? `"${s.name}"` : 'jadwal ini';

  if (!confirm(`Hapus ${nama}?\n\nJadwal yang dihapus tidak bisa dikembalikan.`)) return;

  try {
    const res  = await fetch(`${API}/schedules/${id}`, { method: 'DELETE' });
    const json = await res.json();

    if (json.success) {
      if (editingId === id) resetScheduleForm();
      await fetchSchedules();
    } else {
      alert('Gagal menghapus jadwal.');
    }
  } catch (err) {
    console.error('[deleteSchedule]', err.message);
    alert('Gagal terhubung ke server.');
  }
}

/* ============================================
   NOTIFIKASI (placeholder)
   ============================================ */
function fetchNotifications() {
  console.log('[Notifikasi] Belum diimplementasikan');
}

/* ============================================
   ESCAPE HTML (keamanan)
   ============================================ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  fetchStatus();
  fetchHistory();

  setInterval(fetchStatus,  3000);
  setInterval(fetchHistory, 10000);

  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleDay(btn));
  });

  const submitBtn = document.getElementById('schedSubmitBtn');
  if (submitBtn && !submitBtn.getAttribute('onclick')) {
    submitBtn.addEventListener('click', submitSchedule);
  }

  console.log('[APP] Initialized');
});