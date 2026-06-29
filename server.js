require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

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

  app.use('/css', express.static(path.join(__dirname, 'public/css')));
  app.use('/js', express.static(path.join(__dirname, 'public/js')));

  app.get('/topup', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/topup.html')));
  app.get('/api/pakasir/balance/:tid', (req, res) => {
    const balance = db.getUserBalance(req.params.tid);
    const messageCost = parseInt(db.getSetting('message_cost') || '0');
    res.json({ balance, message_cost: messageCost });
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
