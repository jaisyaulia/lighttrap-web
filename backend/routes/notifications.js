const express = require('express');
const router = express.Router();

// Simpan notifikasi di memory (MVP)
let notifications = [];
let idCounter = 1;

// Fungsi untuk tambah notifikasi dari service lain
function addNotification(type, title, message) {
  const notif = {
    id: idCounter++,
    type,        // "warning" | "info" | "success" | "error"
    title,
    message,
    read: false,
    createdAt: new Date().toISOString(),
  };
  notifications.unshift(notif); // terbaru di atas
  if (notifications.length > 50) notifications.pop(); // simpan max 50
  console.log(`[NOTIF] ${type.toUpperCase()}: ${title}`);
  return notif;
}

// GET /api/notifications
router.get('/', (req, res) => {
  const unreadCount = notifications.filter((n) => !n.read).length;
  res.json({ success: true, unreadCount, data: notifications });
});

// PUT /api/notifications/read-all — tandai semua dibaca
router.put('/read-all', (req, res) => {
  notifications = notifications.map((n) => ({ ...n, read: true }));
  res.json({ success: true, message: 'Semua notifikasi ditandai dibaca' });
});

// PUT /api/notifications/:id/read — tandai satu dibaca
router.put('/:id/read', (req, res) => {
  const id = parseInt(req.params.id);
  const notif = notifications.find((n) => n.id === id);
  if (!notif) return res.status(404).json({ success: false, message: 'Notifikasi tidak ditemukan' });
  notif.read = true;
  res.json({ success: true, message: 'Notifikasi dibaca' });
});

module.exports = { router, addNotification };
