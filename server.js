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

  app.use('/auth', require('./routes/auth'));
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
