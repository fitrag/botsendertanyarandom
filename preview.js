require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

async function main() {
  const db = require('./database/db');
  await db.initDb();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'test-preview', resave: false, saveUninitialized: false }));
  app.use('/css', express.static(path.join(__dirname, 'public/css')));
  app.use('/js', express.static(path.join(__dirname, 'public/js')));
  app.use('/auth', require('./routes/auth'));
  app.use('/api', require('./routes/api'));

  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/login.html')));
  app.get('/', (req, res) => {
    if (!req.session || !req.session.admin) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/pages/dashboard.html'));
  });

  app.listen(3000, () => console.log('Preview: http://localhost:3000'));
}

main().catch(e => { console.error(e); process.exit(1); });
