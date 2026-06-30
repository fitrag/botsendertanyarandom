const express = require('express');
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

router.post('/users/:id/topup', (req, res) => {
  const { amount } = req.body || {};
  if (!amount || amount < 1) return res.status(400).json({ error: 'Jumlah top-up diperlukan' });
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  db.addBalance(user.telegram_id, Number(amount));
  const newBalance = db.getTotalBalance(user.telegram_id);
  // Notify user via bot
  try {
    const bot = require('../bot/bot').getBot();
    if (bot && user.telegram_id) {
      bot.sendMessage(user.telegram_id,
        `💰 *Top-Up Berhasil!*\n\n+ Rp${Number(amount).toLocaleString('id-ID')} ditambahkan ke saldomu\n💳 Saldo saat ini: *Rp${newBalance.toLocaleString('id-ID')}*\n\nSekarang kamu bisa kirim pesan! ✏️`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch (e) { }
  res.json({ success: true, newBalance });
});

// Referrals
router.get('/referrals', (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  res.json(db.getAllReferrals(+page, +limit));
});
router.get('/referrals/stats', (req, res) => { res.json(db.getReferralStats()); });

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

// Support Tickets
router.get('/support-tickets', (req, res) => {
  const { page = 1, limit = 20, status = '' } = req.query;
  res.json(db.getSupportTickets(+page, +limit, status));
});

router.get('/support-tickets/:id/messages', (req, res) => {
  res.json({ messages: db.getSupportMessages(req.params.id) });
});

router.post('/support-tickets/:id/reply', (req, res) => {
  const { reply } = req.body || {};
  if (!reply) return res.status(400).json({ error: 'Reply diperlukan' });
  const ticket = db.getSupportTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Tiket tidak ditemukan' });
  db.replySupportTicket(req.params.id, reply);
  try {
    const bot = require('../bot/bot').getBot();
    if (bot && ticket.telegram_id) {
      bot.sendMessage(ticket.telegram_id,
        `📞 *Balasan Support #SUP${ticket.id}*\n\n📋 Subjek: _${ticket.subject}_\n\n💬 Balasan admin:\n${reply}`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '💬 Balas', callback_data: `support_reply_${ticket.id}` }]] }
        }
      ).catch(() => {});
    }
  } catch(e) {}
  res.json({ success: true });
});

router.post('/support-tickets/:id/close', (req, res) => {
  db.closeSupportTicket(req.params.id);
  res.json({ success: true });
});

// Announcement
router.post('/announcement', async (req, res) => {
  const { text, pin } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Teks pengumuman diperlukan' });
  try {
    const { postAnnouncement } = require('../bot/bot');
    await postAnnouncement(text.trim(), pin === true);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Challenges
router.get('/challenges', (req, res) => {
  res.json({ challenges: db.getAllChallenges() });
});

router.get('/challenges/active', (req, res) => {
  const challenge = db.getActiveChallenge();
  if (!challenge) return res.json({ active: false });
  res.json({ active: true, challenge, leaderboard: db.getChallengeLeaderboard(challenge.id) });
});

router.post('/challenges', (req, res) => {
  const { title, description, reward, winners_count, start_time, end_time } = req.body || {};
  if (!title || !start_time || !end_time) return res.status(400).json({ error: 'Data tidak lengkap' });
  const id = db.createChallenge(title, description || '', reward || '', winners_count || 3, start_time, end_time);
  res.json({ success: true, id });
});

router.post('/challenges/:id/end', (req, res) => {
  db.endChallenge(req.params.id);
  res.json({ success: true });
});

module.exports = router;
