const express = require('express');
const https = require('https');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { postToChannel, notifyUser, getBot, deleteFromChannel } = require('../bot/bot');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth);

// Stats
router.get('/stats', (req, res) => {
  res.json({
    stats: db.getStats(),
    dailyStats: db.getDailyStats(30),
    statusDistribution: db.getStatusDistribution(),
    recentMessages: db.getRecentMessages(10)
  });
});

// Messages
router.get('/messages', (req, res) => {
  const { page = 1, limit = 20, status = 'all', search = '' } = req.query;
  const data = db.getMessages(+page, +limit, status, search);
  // Attach comment counts
  const ids = data.messages.map(m => m.id);
  const counts = db.getCommentCounts(ids);
  data.messages.forEach(m => { m.comment_count = counts[m.id] || 0; });
  res.json(data);
});

router.get('/messages/:id/comments', (req, res) => {
  const comments = db.getComments(req.params.id);
  res.json({ comments });
});

router.post('/messages/:id/approve', async (req, res) => {
  try {
    const msg = db.getMessage(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Pesan tidak ditemukan' });
    if (msg.status !== 'pending') return res.status(400).json({ error: 'Pesan sudah diproses' });
    const { hashtag } = req.body || {};
    const result = await postToChannel(msg, hashtag);
    db.approveMessage(req.params.id);
    db.setPostedMessageId(req.params.id, result.message_id);
    notifyUser(msg.telegram_id, db.getSetting('approve_message') || '✅ Pesanmu disetujui!');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/messages/:id/reject', (req, res) => {
  const msg = db.getMessage(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Pesan tidak ditemukan' });
  if (msg.status !== 'pending') return res.status(400).json({ error: 'Pesan sudah diproses' });
  db.rejectMessage(req.params.id);
  notifyUser(msg.telegram_id, db.getSetting('reject_message') || '❌ Pesanmu tidak disetujui.');
  res.json({ success: true });
});

router.post('/messages/bulk', async (req, res) => {
  const { ids, action } = req.body;
  if (!ids || !Array.isArray(ids) || !action) return res.status(400).json({ error: 'Invalid request' });
  let success = 0, failed = 0;
  for (const id of ids) {
    try {
      const msg = db.getMessage(id);
      if (!msg || msg.status !== 'pending') { failed++; continue; }
      if (action === 'approve') {
        const r = await postToChannel(msg);
        db.approveMessage(id); db.setPostedMessageId(id, r.message_id);
        notifyUser(msg.telegram_id, db.getSetting('approve_message') || '✅ Pesanmu disetujui!');
      } else {
        db.rejectMessage(id);
        notifyUser(msg.telegram_id, db.getSetting('reject_message') || '❌ Pesanmu tidak disetujui.');
      }
      success++;
    } catch (e) { failed++; }
  }
  res.json({ success: true, processed: success, failed });
});

router.delete('/messages/:id', async (req, res) => {
  try {
    const msg = db.getMessage(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Pesan tidak ditemukan' });
    // Delete from channel if it was posted
    if (msg.posted_message_id) {
      await deleteFromChannel(msg.posted_message_id);
    }
    db.deleteMessage(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Users
router.get('/users', (req, res) => {
  const { page = 1, limit = 20, search = '' } = req.query;
  res.json(db.getAllUsers(+page, +limit, search));
});

router.get('/users/vip', (req, res) => { res.json({ users: db.getVipUsers() }); });

router.post('/users/:id/ban', (req, res) => { db.banUser(req.params.id); res.json({ success: true }); });
router.post('/users/:id/unban', (req, res) => { db.unbanUser(req.params.id); res.json({ success: true }); });
router.post('/users/:id/vip', (req, res) => {
  const { days } = req.body || {};
  if (!days || days < 1) return res.status(400).json({ error: 'Durasi VIP diperlukan (minimal 1 hari)' });
  db.setVip(req.params.id, Number(days));
  res.json({ success: true });
});
router.post('/users/:id/unvip', (req, res) => { db.unsetVip(req.params.id); res.json({ success: true }); });

// Referrals
router.get('/referrals', (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  res.json(db.getAllReferrals(+page, +limit));
});
router.get('/referrals/stats', (req, res) => { res.json(db.getReferralStats()); });

// Withdrawals
router.get('/withdrawals', (req, res) => {
  const { page = 1, limit = 20, status = '' } = req.query;
  res.json(db.getAllWithdrawals(+page, +limit, status));
});
router.post('/withdrawals/:id/approve', (req, res) => {
  const w = db.approveWithdrawal(req.params.id, req.body.note);
  if (!w) return res.status(400).json({ error: 'Tidak dapat diproses' });
  // Notify user via bot
  try {
    const bot = require('../bot/bot').getBot();
    if (bot && w.telegram_id) {
      bot.sendMessage(w.telegram_id,
        `✅ *Withdraw Disetujui!*\n\n💰 Jumlah: *Rp${w.amount.toLocaleString('id-ID')}*\n💳 ${w.payment_method}: ${w.payment_info}\n${req.body.note ? `📝 Catatan: ${req.body.note}` : ''}\n\nDana akan segera ditransfer.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch(e) {}
  res.json({ success: true });
});
router.post('/withdrawals/:id/reject', (req, res) => {
  const w = db.rejectWithdrawal(req.params.id, req.body.note);
  if (!w) return res.status(400).json({ error: 'Tidak dapat diproses' });
  // Notify user + refund balance
  db.addReferralBalance(w.telegram_id, w.amount);
  try {
    const bot = require('../bot/bot').getBot();
    if (bot && w.telegram_id) {
      bot.sendMessage(w.telegram_id,
        `❌ *Withdraw Ditolak*\n\n💰 Jumlah: *Rp${w.amount.toLocaleString('id-ID')}*\n${req.body.note ? `📝 Alasan: ${req.body.note}` : ''}\n\nSaldo telah dikembalikan ke akunmu.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch(e) {}
  res.json({ success: true });
});

// Settings
router.get('/settings', (req, res) => res.json(db.getAllSettings()));
router.post('/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body)) db.setSetting(k, v);
  res.json({ success: true });
});

// Change password
router.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const admin = db.getAdmin(req.session.admin.username);
  if (!bcrypt.compareSync(currentPassword, admin.password))
    return res.status(400).json({ error: 'Password saat ini salah' });
  db.updateAdminPassword(admin.id, bcrypt.hashSync(newPassword, 10));
  res.json({ success: true });
});

// Photo proxy
router.get('/photo/:fileId', async (req, res) => {
  try {
    const b = getBot();
    const file = await b.getFile(req.params.fileId);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    https.get(url, (stream) => {
      res.set('Content-Type', stream.headers['content-type'] || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      stream.pipe(res);
    });
  } catch (e) { res.status(404).json({ error: 'Photo not found' }); }
});

module.exports = router;
