const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan password diperlukan' });
  const admin = db.getAdmin(username);
  if (!admin || !bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'Username atau password salah' });
  req.session.admin = { id: admin.id, username: admin.username };
  res.json({ success: true, admin: { username: admin.username } });
});

router.post('/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

router.get('/me', (req, res) => {
  if (req.session && req.session.admin) return res.json({ admin: req.session.admin });
  res.status(401).json({ error: 'Not logged in' });
});

module.exports = router;
