require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');

async function main() {
  // Init database first
  const db = require('./database/db');
  await db.initDb();

  // Sync .env values to database settings if not already set
  if (process.env.CHANNEL_ID && !db.getSetting('channel_id')) {
    db.setSetting('channel_id', process.env.CHANNEL_ID);
    console.log('📡 Channel ID dari .env disimpan ke pengaturan');
  }

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'bot-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
  }));

  // Migration: assign default avatars to all users by gender
  try {
    const cowok = db.getAvatars().find(a => a.name === 'Avatar Cowok Default' && a.price === 0);
    const cewek = db.getAvatars().find(a => a.name === 'Avatar Cewek Default' && a.price === 0);
    if (cowok && cewek) {
      const users = db.getAllUsers(1, 99999).users;
      let assigned = 0;
      users.forEach(u => {
        if (!u.gender) return;
        const hasActive = db.getUserActiveAvatar(u.telegram_id);
        if (hasActive) return;
        const avatar = u.gender === 'female' ? cewek : cowok;
        db.assignDefaultAvatar(u.telegram_id, u.gender);
        assigned++;
      });
      if (assigned > 0) console.log(`👤 Default avatars assigned to ${assigned} users`);
    }
  } catch(e) { console.error('Avatar migration error:', e.message); }
  const uploadsDir = path.join(__dirname, 'uploads', 'avatars');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, 'avatar-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Hanya file gambar yang diizinkan'));
  }});

  app.use('/css', express.static(path.join(__dirname, 'public/css')));
  app.use('/js', express.static(path.join(__dirname, 'public/js')));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  app.get('/topup', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/topup.html')));

  // Avatar upload (admin, but public endpoint since auth handled by session in api.js)
  app.post('/api/upload-avatar', upload.single('avatar'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File gambar diperlukan' });
    try {
      const originalPath = req.file.path;
      const compressedPath = originalPath.replace(/(\.\w+)$/, '_thumb$1');
      await sharp(originalPath)
        .resize(300, 300, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toFile(compressedPath);
      // Replace original with compressed
      fs.unlinkSync(originalPath);
      fs.renameSync(compressedPath, originalPath);
      const url = '/uploads/avatars/' + req.file.filename;
      res.json({ success: true, url });
    } catch(e) {
      console.error('Image processing error:', e);
      res.status(500).json({ error: 'Gagal memproses gambar' });
    }
  });
  app.get('/api/pakasir/balance/:tid', (req, res) => {
    const user = db.getUser(req.params.tid);
    if (!user) return res.status(404).json({ error: 'User not found', exists: false });
    const balance = db.getUserBalance(req.params.tid);
    const messageCost = parseInt(db.getSetting('message_cost') || '0');
    res.json({
      balance, message_cost: messageCost, exists: true,
      transfer_enabled: db.getSetting('transfer_enabled') !== 'false',
      miniapp_enabled: db.getSetting('topup_miniapp_enabled') !== 'false',
      referral_enabled: db.getSetting('referral_enabled') === 'true',
      referral_count: db.getReferralCount(req.params.tid),
      referral_amount: parseInt(db.getSetting('referral_cash_amount') || '10000')
    });
  });

  app.get('/api/pakasir/referral-link/:tid', async (req, res) => {
    try {
      const bot = require('./bot/bot').getBot();
      const botInfo = bot ? await bot.getMe() : null;
      const botUsername = botInfo ? botInfo.username : '';
      res.json({
        link: botUsername ? `https://t.me/${botUsername}?start=ref_${req.params.tid}` : '',
        count: db.getReferralCount(req.params.tid),
        amount: parseInt(db.getSetting('referral_cash_amount') || '10000'),
        enabled: db.getSetting('referral_enabled') === 'true'
      });
    } catch(e) {
      res.json({ link: '', count: 0, amount: 10000, enabled: false });
    }
  });

  app.get('/api/pakasir/history/:tid', (req, res) => {
    const history = db.getTopupHistory(req.params.tid);
    res.json({ history });
  });

  app.get('/api/pakasir/detail/:order_id', (req, res) => {
    const tx = db.getTopupDetail(req.params.order_id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  });

  app.get('/api/pakasir/challenge', (req, res) => {
    const challenge = db.getActiveChallenge();
    if (!challenge) return res.json({ active: false });
    const leaderboard = db.getChallengeLeaderboard(challenge.id);
    const userRank = req.query.tid ? db.getUserChallengeRank(challenge.id, req.query.tid) : null;
    res.json({ active: true, challenge, leaderboard, userRank });
  });

  app.get('/api/pakasir/avatars', (req, res) => {
    const tid = req.query.tid;
    const catalog = db.getAvatars();
    const owned = tid ? db.getUserAvatars(tid).map(a => a.avatar_id) : [];
    res.json({ avatars: catalog.map(a => ({ ...a, owned: owned.includes(a.id) })) });
  });

  app.get('/api/pakasir/my-avatars/:tid', (req, res) => {
    res.json({ avatars: db.getUserAvatars(req.params.tid) });
  });

  app.post('/api/pakasir/buy-avatar', (req, res) => {
    const { telegram_id, avatar_id } = req.body || {};
    if (!telegram_id || !avatar_id) return res.status(400).json({ error: 'Data tidak lengkap' });
    const result = db.buyAvatar(telegram_id, avatar_id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  });

  app.post('/api/pakasir/set-active-avatar', (req, res) => {
    const { telegram_id, avatar_id } = req.body || {};
    if (!telegram_id || !avatar_id) return res.status(400).json({ error: 'Data tidak lengkap' });
    const result = db.setActiveAvatar(telegram_id, avatar_id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  });

  app.post('/api/pakasir/transfer', async (req, res) => {
    const { telegram_id, amount } = req.body;
    const recipient = (req.body.recipient || '').replace(/^@/, '').trim();
    if (!telegram_id || !recipient || !amount) return res.status(400).json({ error: 'Data tidak lengkap' });
    if (db.getSetting('transfer_enabled') === 'false') return res.status(400).json({ error: 'Fitur transfer sedang dinonaktifkan' });
    if (!/^[a-zA-Z0-9_]+$/.test(recipient)) return res.status(400).json({ error: 'Format ID/username tidak valid' });
    if (amount < 1000) return res.status(400).json({ error: 'Minimal transfer Rp1.000' });

    const sender = db.getUser(telegram_id);
    if (!sender) return res.status(404).json({ error: 'Pengirim tidak ditemukan' });

    const receiver = db.findUser(recipient);
    if (!receiver) return res.status(404).json({ error: 'Penerima tidak ditemukan. Pastikan ID/username benar.' });
    if (String(telegram_id) === String(receiver.telegram_id)) return res.status(400).json({ error: 'Tidak bisa kirim ke diri sendiri' });
    const balance = db.getUserBalance(telegram_id);
    if (balance < amount) return res.status(400).json({ error: 'Saldo tidak cukup' });

    const success = db.transferBalance(telegram_id, receiver.telegram_id, amount);
    if (!success) return res.status(500).json({ error: 'Transfer gagal' });

    const newBalance = db.getUserBalance(telegram_id);
    res.json({ success: true, newBalance, receiverName: receiver.first_name || receiver.username });

    // Notify receiver via bot
    try {
      const bot = require('./bot/bot').getBot();
      if (bot) {
        bot.sendMessage(receiver.telegram_id,
          `💸 *Kamu Menerima Saldo!*\n\n👤 Dari: ${sender.first_name || sender.username || telegram_id}\n💰 Jumlah: *Rp${amount.toLocaleString('id-ID')}*\n\nGunakan /balance untuk cek saldo.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    } catch(e) {}
  });

  // Support (Mini App)
  app.get('/api/pakasir/support-tickets', (req, res) => {
    const { telegram_id } = req.query;
    if (!telegram_id) return res.status(400).json({ error: 'Telegram ID diperlukan' });
    res.json({ tickets: db.getUserSupportTickets(telegram_id) });
  });

  app.get('/api/pakasir/support-tickets/:id', (req, res) => {
    const ticket = db.getSupportTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Tiket tidak ditemukan' });
    res.json({ ticket, messages: db.getSupportMessages(req.params.id) });
  });

  app.post('/api/pakasir/support-tickets', async (req, res) => {
    const { telegram_id, user_name, subject, message } = req.body || {};
    if (!telegram_id || !subject || !message) return res.status(400).json({ error: 'Data tidak lengkap' });
    const ticketId = db.createSupportTicket(telegram_id, user_name || String(telegram_id), subject, message);
    const ticket = db.getSupportTicket(ticketId);
    try {
      const bot = require('./bot/bot').getBot();
      if (bot && process.env.ADMIN_TELEGRAM_ID) {
        bot.sendMessage(process.env.ADMIN_TELEGRAM_ID,
          `📞 Tiket Support Baru (Mini App)\n\n🔢 ID: #SUP${ticketId}\n👤 Dari: ${user_name || telegram_id}\n📋 Subjek: ${subject}\n💬 Pesan: ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}\n\nBuka dashboard untuk merespon.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    } catch(e) {}
    res.json({ success: true, ticket_id: ticketId });
  });

  app.post('/api/pakasir/support-tickets/:id/reply', (req, res) => {
    const { telegram_id, message } = req.body || {};
    if (!telegram_id || !message) return res.status(400).json({ error: 'Data tidak lengkap' });
    const ticket = db.getSupportTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Tiket tidak ditemukan' });
    if (ticket.status === 'closed') return res.status(400).json({ error: 'Tiket sudah ditutup' });
    if (String(ticket.telegram_id) !== String(telegram_id)) return res.status(403).json({ error: 'Akses ditolak' });
    db.addSupportMessage(req.params.id, 'user', message);
    res.json({ success: true });
  });

  app.post('/api/pakasir/support-tickets/:id/close', (req, res) => {
    const { telegram_id } = req.body || {};
    const ticket = db.getSupportTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Tiket tidak ditemukan' });
    if (String(ticket.telegram_id) !== String(telegram_id)) return res.status(403).json({ error: 'Akses ditolak' });
    db.closeSupportTicket(req.params.id);
    res.json({ success: true });
  });

  app.get('/api/pakasir/transaction-status/:order_id', async (req, res) => {
    const tx = db.getTopupByOrderId(req.params.order_id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status === 'completed') return res.json({ status: 'completed', order_id: tx.order_id, amount: tx.amount });

    // Check Pakasir API
    const apiKey = db.getSetting('pakasir_api_key');
    const slug = db.getSetting('pakasir_slug');
    if (apiKey && slug) {
      try {
        const verify = await fetch(`https://app.pakasir.com/api/transactiondetail?project=${slug}&amount=${tx.amount}&order_id=${encodeURIComponent(tx.order_id)}&api_key=${apiKey}`);
        const verifyData = await verify.json();
        if (verifyData.transaction && verifyData.transaction.status === 'completed') {
          db.completeTopupTransaction(tx.order_id, verifyData.transaction.payment_method);
          db.addBalance(tx.telegram_id, tx.amount);
          console.log(`[Poll] Top-up completed: ${tx.telegram_id} +Rp${tx.amount.toLocaleString('id-ID')}`);
          return res.json({ status: 'completed', order_id: tx.order_id, amount: tx.amount });
        }
      } catch(e) { /* ignore API errors, return pending */ }
    }
    res.json({ status: tx.status, order_id: tx.order_id, amount: tx.amount });
  });

  app.post('/api/pakasir/cancel-transaction', async (req, res) => {
    const { order_id } = req.body;
    const tx = db.getTopupByOrderId(order_id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.json({ success: true, already_processed: true });

    const apiKey = db.getSetting('pakasir_api_key');
    const slug = db.getSetting('pakasir_slug');
    if (apiKey && slug) {
      try {
        await fetch('https://app.pakasir.com/api/transactioncancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: slug, order_id: tx.order_id, amount: tx.amount, api_key: apiKey })
        });
      } catch(e) { /* still mark as cancelled locally */ }
    }
    db.cancelTopupTransaction(order_id);
    console.log(`[Cancel] Transaction cancelled: ${order_id}`);
    res.json({ success: true });
  });

  app.use('/auth', require('./routes/auth'));

  // Pakasir webhook (public, no auth) - MUST be before /api router
  app.post('/api/pakasir/webhook', async (req, res) => {
    try {
      const { order_id, amount, status, payment_method } = req.body;
      if (status !== 'completed') return res.json({ received: true });

      const tx = db.getTopupByOrderId(order_id);
      if (!tx) return res.status(404).json({ error: 'Order not found' });
      if (tx.status === 'completed') return res.json({ received: true, already_processed: true });
      if (tx.amount !== amount) return res.status(400).json({ error: 'Amount mismatch' });

      // Verify via Pakasir API if api_key is set
      const apiKey = db.getSetting('pakasir_api_key');
      const slug = db.getSetting('pakasir_slug');
      if (apiKey && slug) {
        try {
          const verify = await fetch(`https://app.pakasir.com/api/transactiondetail?project=${slug}&amount=${amount}&order_id=${encodeURIComponent(order_id)}&api_key=${apiKey}`);
          const verifyData = await verify.json();
          if (verifyData.transaction && verifyData.transaction.status === 'completed') {
            db.completeTopupTransaction(order_id, payment_method);
            db.addBalance(tx.telegram_id, amount);
            const newBalance = db.getTotalBalance(tx.telegram_id);
            try {
              const bot = require('./bot/bot').getBot();
              if (bot) {
                bot.sendMessage(tx.telegram_id,
                  `💰 *Top-Up Berhasil!*\n\n+ Rp${amount.toLocaleString('id-ID')} ditambahkan ke saldomu\n💳 Saldo saat ini: *Rp${newBalance.toLocaleString('id-ID')}*\n\nSekarang kamu bisa kirim pesan! ✏️`,
                  { parse_mode: 'Markdown' }
                ).catch(() => {});
              }
            } catch (e) { }
            console.log(`✅ Top-up via Pakasir: ${tx.telegram_id} +Rp${amount.toLocaleString('id-ID')}`);
          }
        } catch (e) {
          console.error('Pakasir verification failed:', e.message);
          return res.status(500).json({ error: 'Verification failed' });
        }
      } else {
        // No API key configured, trust webhook directly
        db.completeTopupTransaction(order_id, payment_method);
        db.addBalance(tx.telegram_id, amount);
        const newBalance = db.getTotalBalance(tx.telegram_id);
        try {
          const bot = require('./bot/bot').getBot();
          if (bot) {
            bot.sendMessage(tx.telegram_id,
              `💰 *Top-Up Berhasil!*\n\n+ Rp${amount.toLocaleString('id-ID')} ditambahkan ke saldomu\n💳 Saldo saat ini: *Rp${newBalance.toLocaleString('id-ID')}*\n\nSekarang kamu bisa kirim pesan! ✏️`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }
        } catch (e) { }
        console.log(`✅ Top-up via Pakasir (unverified): ${tx.telegram_id} +Rp${amount.toLocaleString('id-ID')}`);
      }
      res.json({ received: true });
    } catch (e) {
      console.error('Webhook error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Pakasir API: create transaction (called from Mini App, public)
  app.post('/api/pakasir/create-transaction', async (req, res) => {
    try {
      const { amount, method, telegram_id } = req.body;
      if (!amount || amount < 1000) return res.status(400).json({ error: 'Minimal top-up Rp1.000' });
      if (!telegram_id) return res.status(400).json({ error: 'Telegram ID diperlukan' });

      const slug = db.getSetting('pakasir_slug');
      const apiKey = db.getSetting('pakasir_api_key');
      if (!slug || !apiKey) return res.status(400).json({ error: 'Pakasir belum dikonfigurasi' });

      const orderId = `TOPDUP-${telegram_id}-${Date.now()}`;
      db.createTopupTransaction(telegram_id, amount, orderId);

      const apiRes = await fetch(`https://app.pakasir.com/api/transactioncreate/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: slug, order_id: orderId, amount, api_key: apiKey })
      });

      const apiData = await apiRes.json();
      if (!apiData.payment) {
        console.error('Pakasir API error:', apiData);
        return res.status(500).json({ error: 'Gagal membuat transaksi' });
      }

      res.json({
        success: true,
        order_id: orderId,
        payment_number: apiData.payment.payment_number,
        amount: apiData.payment.amount,
        fee: apiData.payment.fee,
        total_payment: apiData.payment.total_payment,
        payment_method: apiData.payment.payment_method,
        expired_at: apiData.payment.expired_at
      });
    } catch (e) {
      console.error('Create transaction error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.use('/api', require('./routes/api'));

  app.get('/login', (req, res) => {
    if (req.session && req.session.admin) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public/pages/login.html'));
  });

  app.get('/', (req, res) => {
    if (!req.session || !req.session.admin) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/pages/dashboard.html'));
  });

  // Init bot
  const { initBot } = require('./bot/bot');
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'YOUR_BOT_TOKEN_HERE') {
    console.error('❌ BOT_TOKEN belum diatur! Edit file .env');
    process.exit(1);
  }
  initBot(token);

  const port = db.getSetting('port') || process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 Dashboard: http://localhost:${port}`);
    console.log('📊 Login default: admin / admin123');
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
