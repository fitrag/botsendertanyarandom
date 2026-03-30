const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'bot.db');
let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// Auto-save every 30 seconds
let saveInterval;

async function initDb() {
  const SQL = await initSqlJs();
  try {
    if (fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }
  } catch (e) {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    is_banned INTEGER DEFAULT 0,
    is_vip INTEGER DEFAULT 0,
    vip_expires_at DATETIME,
    message_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migrations
  try { db.run('ALTER TABLE users ADD COLUMN is_vip INTEGER DEFAULT 0'); } catch(e) {}
  try { db.run('ALTER TABLE users ADD COLUMN vip_expires_at DATETIME'); } catch(e) {}
  try { db.run('ALTER TABLE users ADD COLUMN referral_balance INTEGER DEFAULT 0'); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    telegram_id TEXT NOT NULL,
    content TEXT,
    media_type TEXT DEFAULT 'text',
    media_file_id TEXT,
    status TEXT DEFAULT 'pending',
    reviewed_at DATETIME,
    posted_message_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    commenter_name TEXT,
    commenter_username TEXT,
    commenter_telegram_id TEXT,
    content TEXT,
    media_type TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_telegram_id TEXT NOT NULL,
    referred_telegram_id TEXT NOT NULL UNIQUE,
    reward_type TEXT,
    reward_given INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    payment_method TEXT,
    payment_info TEXT,
    status TEXT DEFAULT 'pending',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
  )`);

  try { db.run('CREATE INDEX IF NOT EXISTS idx_msg_status ON messages(status)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_msg_uid ON messages(user_id)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_usr_tgid ON users(telegram_id)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_cmt_msgid ON comments(message_id)'); } catch(e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_ref_referrer ON referrals(referrer_telegram_id)'); } catch(e) {}

  // Seed admin
  const adminRow = db.exec('SELECT id FROM admin_users LIMIT 1');
  if (!adminRow.length || !adminRow[0].values.length) {
    db.run('INSERT INTO admin_users (username, password) VALUES (?, ?)', ['admin', bcrypt.hashSync('admin123', 10)]);
  }

  // Seed settings
  const defaults = {
    welcome_message: '👋 Selamat datang!\\nKirimkan pesan teks atau foto yang ingin kamu sampaikan secara anonim.\\nPesan akan direview admin sebelum diposting ke channel.',
    approve_message: '✅ Pesanmu telah disetujui dan diposting ke channel!',
    reject_message: '❌ Maaf, pesanmu tidak disetujui oleh admin.',
    help_message: '📝 Cara menggunakan bot:\\n\\n1. Kirim pesan teks atau foto\\n2. Pesan akan direview oleh admin\\n3. Jika disetujui, pesan diposting ke channel secara anonim\\n\\nGunakan /status untuk cek status kiriman.',
    channel_id: '', rate_limit: '5', hashtag_enabled: 'false',
    hashtag_text: '#TanyaRandom', maintenance_mode: 'false', port: '3000',
    channel_footer: '', notify_admin: 'true', notify_comments: 'true',
    auto_post: 'false',
    bot_name: 'Bot Pengirim Anonim',
    referral_enabled: 'false',
    referral_reward_type: 'vip',
    referral_cash_amount: '10000',
    referral_vip_days: '7',
    referral_min_referrals: '1',
    referral_min_withdraw: '50000'
  };
  for (const [k, v] of Object.entries(defaults)) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);
  }

  saveDb();
  saveInterval = setInterval(saveDb, 30000);
  return db;
}

// Helper to get row(s) from sql.js result
function getRows(result) {
  if (!result.length || !result[0].values.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
}

function getOne(result) {
  const rows = getRows(result);
  return rows.length ? rows[0] : null;
}

function getCount(result) {
  if (!result.length || !result[0].values.length) return 0;
  return result[0].values[0][0];
}

// Exports
module.exports = {
  initDb,

  getUser(tgId) {
    return getOne(db.exec('SELECT * FROM users WHERE telegram_id = ?', [String(tgId)]));
  },

  createOrUpdateUser(tgId, username, firstName, lastName) {
    db.run('INSERT OR IGNORE INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)',
      [String(tgId), username, firstName, lastName]);
    db.run('UPDATE users SET last_active = CURRENT_TIMESTAMP, username = ?, first_name = ?, last_name = ? WHERE telegram_id = ?',
      [username, firstName, lastName, String(tgId)]);
    saveDb();
    return this.getUser(tgId);
  },

  getAllUsers(page = 1, limit = 20, search = '') {
    let q = 'SELECT * FROM users', cq = 'SELECT COUNT(*) FROM users';
    const p = [];
    if (search) {
      const w = ' WHERE username LIKE ? OR first_name LIKE ? OR telegram_id LIKE ?';
      q += w; cq += w;
      const s = `%${search}%`; p.push(s, s, s);
    }
    const total = getCount(db.exec(cq, [...p]));
    q += ' ORDER BY last_active DESC LIMIT ? OFFSET ?';
    p.push(limit, (page - 1) * limit);
    return { users: getRows(db.exec(q, p)), total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  banUser(id) { db.run('UPDATE users SET is_banned = 1 WHERE id = ?', [Number(id)]); saveDb(); },
  unbanUser(id) { db.run('UPDATE users SET is_banned = 0 WHERE id = ?', [Number(id)]); saveDb(); },

  setVip(id, days) {
    const expires = new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    db.run('UPDATE users SET is_vip = 1, vip_expires_at = ? WHERE id = ?', [expires, Number(id)]);
    saveDb();
  },
  unsetVip(id) {
    db.run('UPDATE users SET is_vip = 0, vip_expires_at = NULL WHERE id = ?', [Number(id)]);
    saveDb();
  },

  getVipUsers() {
    return getRows(db.exec("SELECT * FROM users WHERE is_vip = 1 ORDER BY vip_expires_at ASC"));
  },

  expireVips() {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const expired = getRows(db.exec('SELECT * FROM users WHERE is_vip = 1 AND vip_expires_at IS NOT NULL AND vip_expires_at <= ?', [now]));
    if (expired.length) {
      db.run('UPDATE users SET is_vip = 0, vip_expires_at = NULL WHERE is_vip = 1 AND vip_expires_at IS NOT NULL AND vip_expires_at <= ?', [now]);
      saveDb();
    }
    return expired;
  },

  // Referral methods
  createReferral(referrerTgId, referredTgId) {
    try {
      db.run('INSERT INTO referrals (referrer_telegram_id, referred_telegram_id) VALUES (?, ?)',
        [String(referrerTgId), String(referredTgId)]);
      saveDb();
      return true;
    } catch (e) { return false; } // UNIQUE constraint will prevent duplicates
  },

  getReferralCount(referrerTgId) {
    return getCount(db.exec('SELECT COUNT(*) FROM referrals WHERE referrer_telegram_id = ?', [String(referrerTgId)]));
  },

  getUnrewardedReferralCount(referrerTgId) {
    return getCount(db.exec('SELECT COUNT(*) FROM referrals WHERE referrer_telegram_id = ? AND reward_given = 0', [String(referrerTgId)]));
  },

  markReferralsRewarded(referrerTgId, rewardType) {
    db.run('UPDATE referrals SET reward_given = 1, reward_type = ? WHERE referrer_telegram_id = ? AND reward_given = 0',
      [rewardType, String(referrerTgId)]);
    saveDb();
  },

  getAllReferrals(page = 1, limit = 20) {
    const total = getCount(db.exec('SELECT COUNT(*) FROM referrals'));
    const rows = getRows(db.exec(`
      SELECT r.*, 
        u1.first_name as referrer_name, u1.username as referrer_username,
        u2.first_name as referred_name, u2.username as referred_username
      FROM referrals r
      LEFT JOIN users u1 ON u1.telegram_id = r.referrer_telegram_id
      LEFT JOIN users u2 ON u2.telegram_id = r.referred_telegram_id
      ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [limit, (page - 1) * limit]));
    return { referrals: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  getReferralStats() {
    const total = getCount(db.exec('SELECT COUNT(*) FROM referrals'));
    const rewarded = getCount(db.exec('SELECT COUNT(*) FROM referrals WHERE reward_given = 1'));
    const topReferrers = getRows(db.exec(`
      SELECT r.referrer_telegram_id, u.first_name, u.username, COUNT(*) as count
      FROM referrals r LEFT JOIN users u ON u.telegram_id = r.referrer_telegram_id
      GROUP BY r.referrer_telegram_id ORDER BY count DESC LIMIT 10`));
    return { total, rewarded, pending: total - rewarded, topReferrers };
  },

  // Withdrawal methods
  addReferralBalance(tgId, amount) {
    db.run('UPDATE users SET referral_balance = COALESCE(referral_balance, 0) + ? WHERE telegram_id = ?', [amount, String(tgId)]);
    saveDb();
  },

  getUserBalance(tgId) {
    const user = this.getUser(tgId);
    return user ? (user.referral_balance || 0) : 0;
  },

  createWithdrawal(tgId, amount, paymentMethod, paymentInfo) {
    db.run('INSERT INTO withdrawals (telegram_id, amount, payment_method, payment_info) VALUES (?, ?, ?, ?)',
      [String(tgId), amount, paymentMethod, paymentInfo]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return result[0].values[0][0];
  },

  getAllWithdrawals(page = 1, limit = 20, status = '') {
    let q = `SELECT w.*, u.first_name, u.username FROM withdrawals w LEFT JOIN users u ON u.telegram_id = w.telegram_id`;
    let cq = 'SELECT COUNT(*) FROM withdrawals';
    const p = [];
    if (status) { q += ' WHERE w.status = ?'; cq += ' WHERE status = ?'; p.push(status); }
    const total = getCount(db.exec(cq, [...p]));
    q += ' ORDER BY w.created_at DESC LIMIT ? OFFSET ?';
    p.push(limit, (page - 1) * limit);
    return { withdrawals: getRows(db.exec(q, p)), total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  approveWithdrawal(id, note) {
    const w = getOne(db.exec('SELECT * FROM withdrawals WHERE id = ?', [Number(id)]));
    if (!w || w.status !== 'pending') return false;
    db.run('UPDATE withdrawals SET status = ?, note = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?', ['approved', note || '', Number(id)]);
    db.run('UPDATE users SET referral_balance = MAX(0, COALESCE(referral_balance, 0) - ?) WHERE telegram_id = ?', [w.amount, w.telegram_id]);
    saveDb();
    return w;
  },

  rejectWithdrawal(id, note) {
    const w = getOne(db.exec('SELECT * FROM withdrawals WHERE id = ?', [Number(id)]));
    if (!w || w.status !== 'pending') return false;
    db.run('UPDATE withdrawals SET status = ?, note = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?', ['rejected', note || '', Number(id)]);
    saveDb();
    return w;
  },

  createMessage(userId, tgId, content, mediaType = 'text', mediaFileId = null, status = 'pending') {
    db.run('INSERT INTO messages (user_id, telegram_id, content, media_type, media_file_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, String(tgId), content, mediaType, mediaFileId, status]);
    db.run('UPDATE users SET message_count = message_count + 1 WHERE telegram_id = ?', [String(tgId)]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return result[0].values[0][0];
  },

  getMessage(id) {
    return getOne(db.exec('SELECT m.*, u.username, u.first_name, u.last_name FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?', [Number(id)]));
  },

  getMessages(page = 1, limit = 20, status = 'all', search = '') {
    let q = 'SELECT m.*, u.username, u.first_name, u.last_name FROM messages m JOIN users u ON m.user_id = u.id';
    let cq = 'SELECT COUNT(*) FROM messages m JOIN users u ON m.user_id = u.id';
    const conds = [], p = [];
    if (status !== 'all') { conds.push('m.status = ?'); p.push(status); }
    if (search) { conds.push('(m.content LIKE ? OR u.username LIKE ?)'); const s = `%${search}%`; p.push(s, s); }
    if (conds.length) { const w = ' WHERE ' + conds.join(' AND '); q += w; cq += w; }
    const total = getCount(db.exec(cq, [...p]));
    q += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
    p.push(limit, (page - 1) * limit);
    return { messages: getRows(db.exec(q, p)), total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  approveMessage(id) { db.run("UPDATE messages SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(id)]); saveDb(); },
  rejectMessage(id) { db.run("UPDATE messages SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(id)]); saveDb(); },
  setPostedMessageId(id, msgId) { db.run('UPDATE messages SET posted_message_id = ? WHERE id = ?', [String(msgId), Number(id)]); saveDb(); },

  deleteMessage(id) {
    db.run('DELETE FROM comments WHERE message_id = ?', [Number(id)]);
    db.run('DELETE FROM messages WHERE id = ?', [Number(id)]);
    saveDb();
  },

  createComment(messageId, commenterName, commenterUsername, commenterTgId, content, mediaType = 'text') {
    db.run('INSERT INTO comments (message_id, commenter_name, commenter_username, commenter_telegram_id, content, media_type) VALUES (?, ?, ?, ?, ?, ?)',
      [Number(messageId), commenterName, commenterUsername, String(commenterTgId), content, mediaType]);
    saveDb();
    const r = db.exec('SELECT last_insert_rowid() as id');
    return r[0].values[0][0];
  },

  getComments(messageId) {
    return getRows(db.exec('SELECT * FROM comments WHERE message_id = ? ORDER BY created_at ASC', [Number(messageId)]));
  },

  getCommentCount(messageId) {
    return getCount(db.exec('SELECT COUNT(*) FROM comments WHERE message_id = ?', [Number(messageId)]));
  },

  getCommentCounts(messageIds) {
    if (!messageIds.length) return {};
    const counts = {};
    messageIds.forEach(id => { counts[id] = 0; });
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = getRows(db.exec(`SELECT message_id, COUNT(*) as count FROM comments WHERE message_id IN (${placeholders}) GROUP BY message_id`, messageIds.map(Number)));
    rows.forEach(r => { counts[r.message_id] = r.count; });
    return counts;
  },

  getMessageByPostedId(postedMessageId) {
    return getOne(db.exec('SELECT m.*, u.telegram_id as sender_tg_id, u.first_name FROM messages m JOIN users u ON m.user_id = u.id WHERE m.posted_message_id = ?', [String(postedMessageId)]));
  },

  getUserMessages(tgId) {
    return getRows(db.exec('SELECT id, content, media_type, status, created_at FROM messages WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 5', [String(tgId)]));
  },

  getStats() {
    const g = (q) => getCount(db.exec(q));
    return {
      totalMessages: g('SELECT COUNT(*) FROM messages'),
      pendingMessages: g("SELECT COUNT(*) FROM messages WHERE status='pending'"),
      approvedMessages: g("SELECT COUNT(*) FROM messages WHERE status='approved'"),
      rejectedMessages: g("SELECT COUNT(*) FROM messages WHERE status='rejected'"),
      totalUsers: g('SELECT COUNT(*) FROM users'),
      todayMessages: g("SELECT COUNT(*) FROM messages WHERE DATE(created_at)=DATE('now')"),
      thisWeekMessages: g("SELECT COUNT(*) FROM messages WHERE created_at>=DATE('now','-7 days')"),
      thisMonthMessages: g("SELECT COUNT(*) FROM messages WHERE created_at>=DATE('now','-30 days')"),
    };
  },

  getDailyStats(days = 30) {
    return getRows(db.exec("SELECT DATE(created_at) as date, COUNT(*) as count FROM messages WHERE created_at>=DATE('now','-'||?||' days') GROUP BY DATE(created_at) ORDER BY date ASC", [days]));
  },

  getStatusDistribution() {
    return getRows(db.exec('SELECT status, COUNT(*) as count FROM messages GROUP BY status'));
  },

  getRecentMessages(limit = 10) {
    return getRows(db.exec('SELECT m.*, u.username, u.first_name, u.last_name FROM messages m JOIN users u ON m.user_id=u.id ORDER BY m.created_at DESC LIMIT ?', [limit]));
  },

  getSetting(key) {
    const row = getOne(db.exec('SELECT value FROM settings WHERE key = ?', [key]));
    return row ? row.value : null;
  },

  setSetting(key, value) { db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]); saveDb(); },

  getAllSettings() {
    const rows = getRows(db.exec('SELECT * FROM settings'));
    const s = {};
    rows.forEach(r => s[r.key] = r.value);
    return s;
  },

  getAdmin(username) {
    return getOne(db.exec('SELECT * FROM admin_users WHERE username = ?', [username]));
  },

  updateAdminPassword(id, hash) { db.run('UPDATE admin_users SET password = ? WHERE id = ?', [hash, Number(id)]); saveDb(); },

  close() {
    clearInterval(saveInterval);
    saveDb();
    db.close();
  }
};
