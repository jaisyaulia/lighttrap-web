const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const mqttService = require('../services/mqtt');

// Simpan jadwal di memory (untuk MVP — bisa diganti database nanti)
let schedules = [
  {
    id: 1,
    name: 'Sesi Pagi',
    startTime: '06:00',
    endTime: '08:00',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    active: true,
  },
  {
    id: 2,
    name: 'Sesi Siang',
    startTime: '10:00',
    endTime: '13:00',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    active: true,
  },
  {
    id: 3,
    name: 'Sesi Sore',
    startTime: '17:00',
    endTime: '18:30',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    active: false,
  },
];

// Map untuk menyimpan cron job yang sedang berjalan
const cronJobs = new Map();

// Konversi "06:00" dan hari ke cron expression
function toCronExpression(time, days) {
  const [hour, minute] = time.split(':');
  const dayMap = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const cronDays = days.map((d) => dayMap[d]).join(',');
  return `${minute} ${hour} * * ${cronDays}`;
}

// Daftarkan satu jadwal ke cron
function registerSchedule(schedule) {
  // Hapus cron lama jika ada
  if (cronJobs.has(`start-${schedule.id}`)) cronJobs.get(`start-${schedule.id}`).stop();
  if (cronJobs.has(`end-${schedule.id}`)) cronJobs.get(`end-${schedule.id}`).stop();

  if (!schedule.active) return;

  const startCron = toCronExpression(schedule.startTime, schedule.days);
  const endCron = toCronExpression(schedule.endTime, schedule.days);

  const startJob = cron.schedule(startCron, () => {
    console.log(`[JADWAL] ${schedule.name} — Menyalakan sistem`);
    mqttService.publish({ command: 'ON', mode: 'jadwal', schedule: schedule.name });
  });

  const endJob = cron.schedule(endCron, () => {
    console.log(`[JADWAL] ${schedule.name} — Mematikan sistem`);
    mqttService.publish({ command: 'OFF', mode: 'jadwal', schedule: schedule.name });
  });

  cronJobs.set(`start-${schedule.id}`, startJob);
  cronJobs.set(`end-${schedule.id}`, endJob);
  console.log(`[JADWAL] Terdaftar: ${schedule.name} (${schedule.startTime}–${schedule.endTime})`);
}

// Daftarkan semua jadwal saat server start
function initSchedules() {
  schedules.forEach(registerSchedule);
  console.log(`[JADWAL] ${schedules.length} jadwal diinisialisasi`);
}

// GET /api/schedules — ambil semua jadwal
router.get('/', (req, res) => {
  res.json({ success: true, data: schedules });
});

// POST /api/schedules — tambah jadwal baru
router.post('/', (req, res) => {
  const { name, startTime, endTime, days, active } = req.body;

  if (!name || !startTime || !endTime || !days || !Array.isArray(days)) {
    return res.status(400).json({ success: false, message: 'Data jadwal tidak lengkap' });
  }

  const newSchedule = {
    id: Date.now(),
    name,
    startTime,
    endTime,
    days,
    active: active !== undefined ? active : true,
  };

  schedules.push(newSchedule);
  registerSchedule(newSchedule);

  res.json({ success: true, message: 'Jadwal berhasil ditambahkan', data: newSchedule });
});

// PUT /api/schedules/:id — update jadwal
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = schedules.findIndex((s) => s.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan' });
  }

  schedules[index] = { ...schedules[index], ...req.body, id };
  registerSchedule(schedules[index]);

  res.json({ success: true, message: 'Jadwal diperbarui', data: schedules[index] });
});

// DELETE /api/schedules/:id — hapus jadwal
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  schedules = schedules.filter((s) => s.id !== id);

  if (cronJobs.has(`start-${id}`)) { cronJobs.get(`start-${id}`).stop(); cronJobs.delete(`start-${id}`); }
  if (cronJobs.has(`end-${id}`))   { cronJobs.get(`end-${id}`).stop();   cronJobs.delete(`end-${id}`);   }

  res.json({ success: true, message: 'Jadwal dihapus' });
});

module.exports = { router, initSchedules };
