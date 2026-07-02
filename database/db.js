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
  try { db.run('ALTER TABLE users ADD COLUMN gender TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0'); } catch(e) {}
  try { db.run('ALTER TABLE users ADD COLUMN daily_message_count INTEGER DEFAULT 0'); } catch(e) {}
  try { db.run('ALTER TABLE users ADD COLUMN daily_message_date TEXT'); } catch(e) {}
  // Migrate referral_balance into balance if exists
  try {
    const rbRows = getRows(db.exec('SELECT telegram_id, referral_balance FROM users WHERE COALESCE(referral_balance, 0) > 0'));
    rbRows.forEach(r => {
      db.run('UPDATE users SET balance = COALESCE(balance, 0) + ? WHERE telegram_id = ?', [r.referral_balance, r.telegram_id]);
    });
  } catch(e) {}

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

  db.run(`CREATE TABLE IF NOT EXISTS topup_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE NOT NULL,
    telegram_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_method TEXT,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    user_name TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    admin_reply TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS balance_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_tg_id TEXT NOT NULL,
    receiver_tg_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    reward TEXT,
    winners_count INTEGER DEFAULT 3,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    image_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    avatar_id INTEGER NOT NULL,
    is_active INTEGER DEFAULT 0,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (avatar_id) REFERENCES avatars(id)
  )`);

  try { db.run('ALTER TABLE users ADD COLUMN active_avatar_url TEXT'); } catch(e) {}

  // Seed avatars
  const avatarCount = getCount(db.exec('SELECT COUNT(*) FROM avatars'));
  if (avatarCount === 0) {
    const avatars = [
      ['Avatar Pria (Default)', 0, 'https://ui-avatars.com/api/?name=Pria&size=300&background=b6e3f4&color=1e40af&format=png&bold=true'],
      ['Avatar Wanita (Default)', 0, 'https://ui-avatars.com/api/?name=Wanita&size=300&background=ffdfbf&color=c2410c&format=png&bold=true'],
      ['Avatar Kucing', 5000, 'https://ui-avatars.com/api/?name=Cat&size=300&background=c0aede&color=4c1d95&format=png&bold=true'],
      ['Avatar Keren', 10000, 'https://ui-avatars.com/api/?name=Cool&size=300&background=1e1e2e&color=f8fafc&format=png&bold=true'],
      ['Avatar Anime', 15000, 'https://ui-avatars.com/api/?name=Anime&size=300&background=ffb6c1&color=9d174d&format=png&bold=true'],
      ['Avatar Gaming', 20000, 'https://ui-avatars.com/api/?name=Gamer&size=300&background=7c3aed&color=faf5ff&format=png&bold=true'],
      ['Avatar Premium', 30000, 'https://ui-avatars.com/api/?name=VIP&size=300&background=f59e0b&color=78350f&format=png&bold=true']
    ];
avatars.forEach(a => db.run('INSERT INTO avatars (name, price, image_url) VALUES (?, ?, ?)', [a[0], a[1], a[2]]));
  }

  // Migration: reset old external avatar URLs so users get default avatars from DB
  db.run("UPDATE users SET active_avatar_url = NULL WHERE active_avatar_url LIKE '%dicebear%' OR active_avatar_url LIKE '%pravatar%' OR active_avatar_url LIKE '%ui-avatars%'");
  db.run("DELETE FROM user_avatars WHERE avatar_id IN (SELECT id FROM avatars WHERE image_url LIKE '%dicebear%' OR image_url LIKE '%pravatar%' OR image_url LIKE '%ui-avatars%')");

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
    welcome_message: '👋 Selamat datang!\\nKirimkan pesan teks yang ingin kamu sampaikan secara anonim.\\nPesan akan direview admin sebelum diposting ke channel.',
    approve_message: '✅ Pesanmu telah disetujui dan diposting ke channel!',
    reject_message: '❌ Maaf, pesanmu tidak disetujui oleh admin.',
    help_message: '📝 Cara menggunakan bot:\\n\\n1. Dari Menu Utama, klik Kirim Pesan\\n2. Tulis pesan yang ingin dikirim\\n3. Admin akan mereview pesanmu\\n4. Jika disetujui, pesan diposting ke channel\\n\\nGunakan /menu untuk kembali ke menu utama.',
    channel_id: '', rate_limit: '5', daily_limit: '0', maintenance_mode: 'false', port: '3000',
    channel_footer: '', channel_link: '', notify_admin: 'true', notify_comments: 'true',
    auto_post: 'false',
    referral_enabled: 'false',
    referral_cash_amount: '10000',
    referral_min_referrals: '1',
    paid_message_enabled: 'false',
    message_cost: '5000',
    topup_bot_enabled: 'true',
    topup_miniapp_enabled: 'true',
    transfer_enabled: 'true',
    pakasir_slug: '',
    pakasir_api_key: ''
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

  getUserById(id) {
    return getOne(db.exec('SELECT * FROM users WHERE id = ?', [Number(id)]));
  },

  findUser(query) {
    const q = String(query).trim();
    return getOne(db.exec('SELECT * FROM users WHERE telegram_id = ? OR LOWER(username) = ?', [q, q.toLowerCase()]));
  },

  getAllTelegramIds() {
    return getRows(db.exec('SELECT telegram_id FROM users')).map(r => r.telegram_id);
  },

  getAvatars() {
    return getRows(db.exec('SELECT * FROM avatars ORDER BY price ASC'));
  },

  addAvatar(name, price, imageUrl) {
    db.run('INSERT INTO avatars (name, price, image_url) VALUES (?, ?, ?)', [name, price || 0, imageUrl]);
    saveDb();
  },

  updateAvatar(id, name, price, imageUrl) {
    db.run('UPDATE avatars SET name = ?, price = ?, image_url = ? WHERE id = ?', [name, price || 0, imageUrl, Number(id)]);
    saveDb();
  },

  deleteAvatar(id) {
    db.run('DELETE FROM avatars WHERE id = ?', [Number(id)]);
    db.run('DELETE FROM user_avatars WHERE avatar_id = ?', [Number(id)]);
    saveDb();
  },

  getAvatar(id) {
    return getOne(db.exec('SELECT * FROM avatars WHERE id = ?', [Number(id)]));
  },

  getUserAvatars(tgId) {
    return getRows(db.exec('SELECT ua.*, a.name, a.image_url, a.price FROM user_avatars ua JOIN avatars a ON a.id = ua.avatar_id WHERE ua.telegram_id = ? ORDER BY ua.purchased_at DESC', [String(tgId)]));
  },

  buyAvatar(tgId, avatarId) {
    const avatar = this.getAvatar(avatarId);
    if (!avatar) return { error: 'Avatar tidak ditemukan' };
    const alreadyOwned = getOne(db.exec('SELECT id FROM user_avatars WHERE telegram_id = ? AND avatar_id = ?', [String(tgId), avatarId]));
    if (alreadyOwned) return { error: 'Kamu sudah memiliki avatar ini' };
    const balance = this.getUserBalance(tgId);
    if (balance < avatar.price) return { error: 'Saldo tidak cukup' };
    db.run('UPDATE users SET balance = COALESCE(balance, 0) - ? WHERE telegram_id = ?', [avatar.price, String(tgId)]);
    db.run('INSERT INTO user_avatars (telegram_id, avatar_id, is_active) VALUES (?, ?, 1)', [String(tgId), avatarId]);
    // Deactivate other avatars
    db.run('UPDATE user_avatars SET is_active = 0 WHERE telegram_id = ? AND avatar_id != ?', [String(tgId), avatarId]);
    db.run('UPDATE users SET active_avatar_url = ? WHERE telegram_id = ?', [avatar.image_url, String(tgId)]);
    saveDb();
    return { success: true };
  },

  setActiveAvatar(tgId, avatarId) {
    const owned = getOne(db.exec('SELECT ua.*, a.image_url FROM user_avatars ua JOIN avatars a ON a.id = ua.avatar_id WHERE ua.telegram_id = ? AND ua.avatar_id = ?', [String(tgId), Number(avatarId)]));
    if (!owned) return { error: 'Avatar tidak ditemukan di koleksimu' };
    db.run('UPDATE user_avatars SET is_active = 0 WHERE telegram_id = ?', [String(tgId)]);
    db.run('UPDATE user_avatars SET is_active = 1 WHERE id = ?', [owned.id]);
    db.run('UPDATE users SET active_avatar_url = ? WHERE telegram_id = ?', [owned.image_url, String(tgId)]);
    saveDb();
    return { success: true };
  },

  getUserActiveAvatar(tgId) {
    const row = getOne(db.exec('SELECT ua.*, a.image_url FROM user_avatars ua JOIN avatars a ON a.id = ua.avatar_id WHERE ua.telegram_id = ? AND ua.is_active = 1', [String(tgId)]));
    return row ? row.image_url : null;
  },

  assignDefaultAvatar(tgId, gender) {
    const hasAvatar = getOne(db.exec('SELECT id FROM user_avatars WHERE telegram_id = ? AND is_active = 1', [String(tgId)]));
    if (hasAvatar) return;
    const avatarName = gender === 'female' ? 'Avatar Cewek Default' : 'Avatar Cowok Default';
    let avatar = getOne(db.exec('SELECT * FROM avatars WHERE name = ? AND price = 0 LIMIT 1', [avatarName]));
    if (!avatar) avatar = getOne(db.exec('SELECT * FROM avatars WHERE price = 0 LIMIT 1'));
    if (!avatar) return;
    db.run('INSERT INTO user_avatars (telegram_id, avatar_id, is_active) VALUES (?, ?, 1)', [String(tgId), avatar.id]);
    db.run('UPDATE users SET active_avatar_url = ? WHERE telegram_id = ?', [avatar.image_url, String(tgId)]);
    saveDb();
  },

  transferBalance(senderTgId, receiverTgId, amount) {
    const senderBalance = this.getUserBalance(senderTgId);
    if (senderBalance < amount) return null;
    db.run('UPDATE users SET balance = COALESCE(balance, 0) - ? WHERE telegram_id = ?', [amount, String(senderTgId)]);
    db.run('UPDATE users SET balance = COALESCE(balance, 0) + ? WHERE telegram_id = ?', [amount, String(receiverTgId)]);
    db.run('INSERT INTO balance_transfers (sender_tg_id, receiver_tg_id, amount) VALUES (?, ?, ?)',
      [String(senderTgId), String(receiverTgId), amount]);
    saveDb();
    return true;
  },

  getDailyMessageCount(tgId) {
    const today = new Date().toISOString().slice(0, 10);
    const user = this.getUser(tgId);
    if (!user) return 0;
    if (user.daily_message_date !== today) return 0;
    return user.daily_message_count || 0;
  },

  incrementDailyMessage(tgId) {
    const today = new Date().toISOString().slice(0, 10);
    const user = this.getUser(tgId);
    if (!user || user.daily_message_date !== today) {
      db.run('UPDATE users SET daily_message_count = 1, daily_message_date = ? WHERE telegram_id = ?', [today, String(tgId)]);
    } else {
      db.run('UPDATE users SET daily_message_count = COALESCE(daily_message_count, 0) + 1 WHERE telegram_id = ?', [String(tgId)]);
    }
    saveDb();
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

  setGender(tgId, gender) {
    db.run('UPDATE users SET gender = ? WHERE telegram_id = ?', [gender, String(tgId)]);
    saveDb();
  },

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

  // Balance methods
  getUserBalance(tgId) {
    const user = this.getUser(tgId);
    return user ? (user.balance || 0) : 0;
  },

  addBalance(tgId, amount) {
    db.run('UPDATE users SET balance = COALESCE(balance, 0) + ? WHERE telegram_id = ?', [amount, String(tgId)]);
    saveDb();
  },

  deductBalance(tgId, amount) {
    const total = this.getUserBalance(tgId);
    if (total < amount) return false;
    db.run('UPDATE users SET balance = COALESCE(balance, 0) - ? WHERE telegram_id = ?', [amount, String(tgId)]);
    saveDb();
    return true;
  },

  getTotalBalance(tgId) {
    return this.getUserBalance(tgId);
  },

  createTopupTransaction(tgId, amount, orderId) {
    db.run('INSERT INTO topup_transactions (order_id, telegram_id, amount) VALUES (?, ?, ?)',
      [orderId, String(tgId), amount]);
    saveDb();
    const result = db.exec('SELECT last_insert_rowid() as id');
    return result[0].values[0][0];
  },

  getTopupByOrderId(orderId) {
    return getOne(db.exec('SELECT * FROM topup_transactions WHERE order_id = ?', [orderId]));
  },

  completeTopupTransaction(orderId, paymentMethod) {
    const tx = this.getTopupByOrderId(orderId);
    if (!tx || tx.status !== 'pending') return null;
    db.run("UPDATE topup_transactions SET status = 'completed', payment_method = ?, completed_at = CURRENT_TIMESTAMP WHERE order_id = ?",
      [paymentMethod || '', orderId]);
    saveDb();
    return this.getTopupByOrderId(orderId);
  },

cancelTopupTransaction(orderId) {
    db.run("UPDATE topup_transactions SET status = 'cancelled' WHERE order_id = ?", [orderId]);
    saveDb();
  },

  getTopupHistory(tgId, limit = 20) {
    return getRows(db.exec('SELECT id, order_id, amount, status, payment_method, created_at, completed_at FROM topup_transactions WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?', [String(tgId), limit]));
  },

  getTopupDetail(orderId) {
    return getOne(db.exec('SELECT id, order_id, telegram_id, amount, status, payment_method, completed_at, created_at FROM topup_transactions WHERE order_id = ?', [orderId]));
  },

  createSupportTicket(tgId, userName, subject, message) {
    db.run('INSERT INTO support_tickets (telegram_id, user_name, subject, message) VALUES (?, ?, ?, ?)',
      [String(tgId), userName, subject, message]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const ticketId = result[0].values[0][0];
    db.run('INSERT INTO support_messages (ticket_id, sender, message) VALUES (?, ?, ?)', [ticketId, 'user', message]);
    saveDb();
    return ticketId;
  },

  getOpenTicketByUser(tgId) {
    return getOne(db.exec("SELECT * FROM support_tickets WHERE telegram_id = ? AND status != 'closed' ORDER BY created_at DESC LIMIT 1", [String(tgId)]));
  },

  getSupportMessages(ticketId) {
    return getRows(db.exec('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC', [Number(ticketId)]));
  },

  addSupportMessage(ticketId, sender, message) {
    db.run('INSERT INTO support_messages (ticket_id, sender, message) VALUES (?, ?, ?)', [Number(ticketId), sender, message]);
    db.run('UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [Number(ticketId)]);
    saveDb();
  },

  replySupportTicket(id, reply) {
    this.addSupportMessage(id, 'admin', reply);
    db.run("UPDATE support_tickets SET admin_reply = ?, status = 'replied', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [reply, Number(id)]);
    saveDb();
  },

  getSupportTickets(page = 1, limit = 20, status = '') {
    let q = 'SELECT * FROM support_tickets';
    let cq = 'SELECT COUNT(*) FROM support_tickets';
    const p = [];
    if (status) { q += ' WHERE status = ?'; cq += ' WHERE status = ?'; p.push(status); }
    const total = getCount(db.exec(cq, [...p]));
    q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    p.push(limit, (page - 1) * limit);
    return { tickets: getRows(db.exec(q, p)), total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  getUserSupportTickets(telegramId) {
    return getRows(db.exec('SELECT * FROM support_tickets WHERE telegram_id = ? ORDER BY created_at DESC', [String(telegramId)]));
  },

  getSupportTicket(id) {
    return getOne(db.exec('SELECT * FROM support_tickets WHERE id = ?', [Number(id)]));
  },

  replySupportTicket(id, reply) {
    db.run("UPDATE support_tickets SET admin_reply = ?, status = 'replied', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [reply, Number(id)]);
    saveDb();
  },

  closeSupportTicket(id) {
    db.run("UPDATE support_tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(id)]);
    saveDb();
  },

  createChallenge(title, description, reward, winnersCount, startTime, endTime) {
    db.run('INSERT INTO challenges (title, description, reward, winners_count, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, reward, winnersCount, startTime, endTime]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return result[0].values[0][0];
  },

  getActiveChallenge() {
    return getOne(db.exec("SELECT * FROM challenges WHERE status = 'active' AND end_time > datetime('now') ORDER BY created_at DESC LIMIT 1"));
  },

  getAllChallenges() {
    return getRows(db.exec('SELECT * FROM challenges ORDER BY created_at DESC LIMIT 20'));
  },

  getChallenge(id) {
    return getOne(db.exec('SELECT * FROM challenges WHERE id = ?', [Number(id)]));
  },

  endChallenge(id) {
    db.run("UPDATE challenges SET status = 'ended' WHERE id = ?", [Number(id)]);
    saveDb();
  },

  getChallengeLeaderboard(challengeId, limit = 10) {
    const challenge = this.getChallenge(challengeId);
    if (!challenge) return [];
    const start = (challenge.start_time || '').replace('T', ' ').replace(/\.\d+Z$/,'').replace('Z','');
    const end = (challenge.end_time || '').replace('T', ' ').replace(/\.\d+Z$/,'').replace('Z','');
    return getRows(db.exec(
      `SELECT r.referrer_telegram_id, u.first_name, u.username, COUNT(*) as count
       FROM referrals r LEFT JOIN users u ON u.telegram_id = r.referrer_telegram_id
       WHERE r.created_at >= ? AND r.created_at <= ?
       GROUP BY r.referrer_telegram_id ORDER BY count DESC LIMIT ?`,
      [start, end, limit]
    ));
  },

  getUserChallengeRank(challengeId, tgId) {
    const challenge = this.getChallenge(challengeId);
    if (!challenge) return null;
    const start = (challenge.start_time || '').replace('T', ' ').replace(/\.\d+Z$/,'').replace('Z','');
    const end = (challenge.end_time || '').replace('T', ' ').replace(/\.\d+Z$/,'').replace('Z','');
    const row = getOne(db.exec(
      `SELECT COUNT(*) as count FROM referrals
       WHERE referrer_telegram_id = ? AND created_at >= ? AND created_at <= ?`,
      [String(tgId), start, end]
    ));
    const myCount = row ? row.count : 0;
    if (myCount === 0) return { rank: null, count: 0, total: 0 };
    const total = getCount(db.exec(
      `SELECT COUNT(DISTINCT referrer_telegram_id) FROM referrals WHERE created_at >= ? AND created_at <= ?`,
      [start, end]
    ));
    return { rank: null, count: myCount, total };
  },

  createMessage(userId, tgId, content, status = 'pending') {
    db.run('INSERT INTO messages (user_id, telegram_id, content, status) VALUES (?, ?, ?, ?)',
      [userId, String(tgId), content, status]);
    db.run('UPDATE users SET message_count = message_count + 1 WHERE telegram_id = ?', [String(tgId)]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return result[0].values[0][0];
  },

  getMessage(id) {
    return getOne(db.exec('SELECT m.*, u.username, u.first_name, u.last_name, u.gender FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?', [Number(id)]));
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
