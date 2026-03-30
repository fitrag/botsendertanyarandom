const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');

let bot;
const rateLimitMap = new Map();
const withdrawState = new Map();

function initBot(token) {
  bot = new TelegramBot(token, { polling: true });

  // ===== HELPER FUNCTIONS =====
  function sendWelcome(chatId, fromUser) {
    const name = fromUser.first_name || 'Kamu';
    const customWelcome = db.getSetting('welcome_message');
    if (customWelcome && customWelcome !== '') {
      bot.sendMessage(chatId, customWelcome.replace(/\\n/g, '\n'));
      return;
    }
    const welcome = `Halo *${name}*! 👋\n\nSelamat datang di *Bot Pesan Anonim*.\nBot ini memungkinkan kamu mengirim pesan secara anonim ke channel kami.\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `📝 *Cara Mengirim Pesan:*\n\n` +
      `1️⃣ Ketik pesan teksmu langsung di chat ini\n` +
      `2️⃣ Atau kirim foto (bisa tambahkan caption)\n` +
      `3️⃣ Pesan akan direview oleh admin\n` +
      `4️⃣ Jika disetujui, pesan terbit di channel!\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `✏️ *Silakan ketik pesanmu sekarang...*`;
    bot.sendMessage(chatId, welcome, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Cek Status Kiriman', callback_data: 'check_status' }],
          [{ text: '❓ Bantuan', callback_data: 'show_help' }]
        ]
      }
    });
  }

  function sendHelp(chatId) {
    const customHelp = db.getSetting('help_message');
    if (customHelp && customHelp !== '') {
      bot.sendMessage(chatId, customHelp.replace(/\\n/g, '\n'));
      return;
    }
    const help = `📖 *Panduan Penggunaan Bot*\n\n` +
      `🔹 *Mengirim Pesan Teks*\nCukup ketik pesanmu langsung di chat ini. Tidak perlu perintah khusus!\n\n` +
      `🔹 *Mengirim Foto*\nKirim foto langsung, bisa tambahkan caption sebagai keterangan.\n\n` +
      `🔹 *Cek Status Kiriman*\nKetik /status untuk melihat apakah pesanmu sudah disetujui.\n\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ *Peraturan:*\n• Jangan kirim spam atau pesan berulang\n• Konten harus sopan dan sesuai aturan\n• Admin berhak menolak pesan yang tidak sesuai\n\n` +
      `✏️ *Silakan ketik pesanmu sekarang...*`;
    bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
  }

  function sendStatus(chatId, userId) {
    const msgs = db.getUserMessages(userId);
    if (!msgs.length) {
      bot.sendMessage(chatId, `📭 *Belum Ada Kiriman*\n\nKamu belum pernah mengirim pesan.\n\n✏️ Silakan ketik pesan atau kirim foto sekarang untuk memulai!`, { parse_mode: 'Markdown' });
      return;
    }
    const statusLabels = { pending: '⏳ Menunggu Review', approved: '✅ Disetujui & Diposting', rejected: '❌ Tidak Disetujui' };
    let text = `📋 *5 Kiriman Terakhirmu:*\n\n`;
    msgs.forEach((m, i) => {
      const preview = m.content ? m.content.substring(0, 40) : '📷 Foto';
      const date = new Date(m.created_at + 'Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      text += `${i + 1}. ${statusLabels[m.status] || m.status}\n    💬 _${preview}${m.content && m.content.length > 40 ? '...' : ''}_\n    📅 ${date}\n\n`;
    });
    text += `━━━━━━━━━━━━━━━━━\n✏️ Kirim pesan baru kapan saja!`;
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  // ===== INLINE BUTTON HANDLER =====
  bot.on('callback_query', (query) => {
    // Only process in private chat
    if (query.message.chat.type !== 'private') return;
    bot.answerCallbackQuery(query.id);
    if (query.data === 'check_status') sendStatus(query.message.chat.id, query.from.id);
    else if (query.data === 'show_help') sendHelp(query.message.chat.id);
  });

  // ===== COMMENT HANDLER — Save & Notify =====
  bot.on('message', (msg) => {
    if (msg.chat.type !== 'supergroup') return;
    if (!msg.reply_to_message) return;

    const repliedTo = msg.reply_to_message;

    // Find the original channel post ID — could be a direct reply to forwarded post
    // or a reply to another comment in the thread
    let channelMsgId = null;
    if (repliedTo.is_automatic_forward && repliedTo.forward_from_message_id) {
      channelMsgId = String(repliedTo.forward_from_message_id);
    } else if (repliedTo.forward_from_message_id) {
      channelMsgId = String(repliedTo.forward_from_message_id);
    }

    // If replying to another comment, try to find the thread's original post
    // by checking if the replied message's reply_to_message has forward_from_message_id
    if (!channelMsgId && repliedTo.reply_to_message) {
      const root = repliedTo.reply_to_message;
      if (root.forward_from_message_id) channelMsgId = String(root.forward_from_message_id);
    }

    if (!channelMsgId) return;

    const originalMsg = db.getMessageByPostedId(channelMsgId);
    if (!originalMsg) return;

    // Save comment to database
    const commenterName = msg.from.first_name || msg.from.username || 'Anonim';
    const commenterUsername = msg.from.username || '';
    const commentContent = msg.text || (msg.photo ? '📷 Foto' : msg.sticker ? '🎨 Stiker' : '💬 Media');
    const mediaType = msg.photo ? 'photo' : msg.sticker ? 'sticker' : 'text';

    db.createComment(originalMsg.id, commenterName, commenterUsername, msg.from.id, commentContent, mediaType);
    console.log(`💬 Komentar baru di pesan #${originalMsg.id} dari ${commenterName}`);

    // Notify original sender (if enabled and not self-commenting)
    if (db.getSetting('notify_comments') === 'true' && originalMsg.sender_tg_id) {
      if (String(msg.from.id) !== String(originalMsg.sender_tg_id)) {
        const originalPreview = originalMsg.content ? originalMsg.content.substring(0, 50) : '📷 Foto';
        const notification = `💬 *Ada Komentar Baru!*\n\n` +
          `Pesanmu "_${originalPreview}${originalMsg.content && originalMsg.content.length > 50 ? '...' : ''}_" mendapat komentar:\n\n` +
          `👤 *${commenterName}*:\n${commentContent.substring(0, 150)}${commentContent.length > 150 ? '...' : ''}`;
        bot.sendMessage(originalMsg.sender_tg_id, notification, { parse_mode: 'Markdown' }).catch(err => {
          console.error('Gagal kirim notif komentar:', err.message);
        });
      }
    }
  });

  // ===== CALLBACK QUERY HANDLER =====
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const fromId = String(query.from.id);
    const data = query.data;
    bot.answerCallbackQuery(query.id).catch(() => {});

    if (data === 'check_status') {
      sendStatus(chatId, query.from.id);
    } else if (data === 'show_help') {
      sendHelp(chatId);
    } else if (data === 'wd_cancel') {
      withdrawState.delete(fromId);
      bot.sendMessage(chatId, '❌ Withdraw dibatalkan.', { parse_mode: 'Markdown' });
    } else if (data === 'wd_bank' || data === 'wd_ewallet') {
      const state = withdrawState.get(fromId);
      if (!state || state.step !== 'method') return;
      const method = data === 'wd_bank' ? 'Bank Transfer' : 'E-Wallet';
      withdrawState.set(fromId, { ...state, step: 'info', method });
      const prompt = data === 'wd_bank'
        ? `🏦 *Transfer Bank*\n\nKirim info rekening dengan format:\n\`Nama Bank - No Rekening - Atas Nama\`\n\n_Contoh: BCA - 1234567890 - John Doe_`
        : `💳 *E-Wallet*\n\nKirim info e-wallet dengan format:\n\`Nama E-Wallet - Nomor - Atas Nama\`\n\n_Contoh: GoPay - 08123456789 - John Doe_`;
      bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown' });
    } else if (data === 'wd_confirm') {
      const state = withdrawState.get(fromId);
      if (!state || state.step !== 'confirm') return;
      // Check balance again
      const currentBalance = db.getUserBalance(query.from.id);
      if (currentBalance < state.balance) {
        bot.sendMessage(chatId, `❌ Saldo berubah. Silakan coba lagi dengan /withdraw`, { parse_mode: 'Markdown' });
        withdrawState.delete(fromId);
        return;
      }
      const wdId = db.createWithdrawal(query.from.id, state.balance, state.method, state.info);
      withdrawState.delete(fromId);
      bot.sendMessage(chatId,
        `✅ *Withdraw Request Terkirim!*\n\n` +
        `🔢 ID: \`#WD${wdId}\`\n` +
        `💰 Jumlah: *Rp${state.balance.toLocaleString('id-ID')}*\n` +
        `💳 Metode: ${state.method}\n` +
        `📋 Info: ${state.info}\n\n` +
        `⏳ Tunggu admin memproses withdrawmu.`,
        { parse_mode: 'Markdown' }
      );
      // Notify admin
      const adminId = process.env.ADMIN_TELEGRAM_ID;
      if (adminId) {
        const name = query.from.first_name || query.from.username || fromId;
        bot.sendMessage(adminId,
          `💸 *Withdraw Request Baru!*\n\n` +
          `🔢 ID: \`#WD${wdId}\`\n` +
          `👤 Dari: ${name}\n` +
          `💰 Jumlah: *Rp${state.balance.toLocaleString('id-ID')}*\n` +
          `💳 Metode: ${state.method}\n` +
          `📋 Info: ${state.info}\n\n` +
          `_Buka dashboard untuk proses._`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }
  });

  // ===== PRIVATE MESSAGE HANDLER =====
  bot.on('message', async (msg) => {
    // STRICT: Only process private (1-on-1) messages
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const from = msg.from;

    // ── WITHDRAW FLOW INPUT ──
    if (msg.text && !msg.text.startsWith('/')) {
      const state = withdrawState.get(String(from.id));
      if (state && state.step === 'info') {
        const info = msg.text.trim();
        if (!info || info.length < 5) {
          bot.sendMessage(chatId, '⚠️ Info pembayaran terlalu pendek. Coba lagi:', { parse_mode: 'Markdown' });
          return;
        }
        withdrawState.set(String(from.id), { ...state, step: 'confirm', info });
        bot.sendMessage(chatId,
          `📋 *Konfirmasi Withdraw*\n\n` +
          `💰 Jumlah: *Rp${state.balance.toLocaleString('id-ID')}*\n` +
          `💳 Metode: ${state.method}\n` +
          `📋 Info: ${info}\n\n` +
          `Apakah data sudah benar?`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
              [{ text: '✅ Konfirmasi', callback_data: 'wd_confirm' }, { text: '❌ Batal', callback_data: 'wd_cancel' }]
            ]}
          }
        );
        return;
      }
    }

    // ── COMMAND ROUTING ──
    if (msg.text && msg.text.startsWith('/')) {
      const fullText = msg.text.split('@')[0]; // handle /start@botname
      const cmd = fullText.toLowerCase().split(' ')[0];
      if (cmd === '/start') {
        db.createOrUpdateUser(from.id, from.username || '', from.first_name || '', from.last_name || '');
        // Handle referral deep link: /start ref_TELEGRAM_ID
        const args = msg.text.split(' ');
        if (args[1] && args[1].startsWith('ref_')) {
          const referrerId = args[1].replace('ref_', '');
          if (referrerId !== String(from.id) && db.getSetting('referral_enabled') === 'true') {
            const created = db.createReferral(referrerId, from.id);
            if (created) {
              // Notify referrer
              const refCount = db.getReferralCount(referrerId);
              bot.sendMessage(referrerId,
                `🎉 *Referral Berhasil!*\n\n${from.first_name || 'Seseorang'} bergabung lewat link referralmu!\n📊 Total referral: *${refCount}*`,
                { parse_mode: 'Markdown' }
              ).catch(() => {});
              // Check if reward should be given
              checkAndGiveReward(referrerId);
            }
          }
        }
        sendWelcome(chatId, from);
      } else if (cmd === '/help') {
        sendHelp(chatId);
      } else if (cmd === '/status') {
        sendStatus(chatId, from.id);
      } else if (cmd === '/referral') {
        if (db.getSetting('referral_enabled') !== 'true') {
          bot.sendMessage(chatId, `❌ Fitur referral sedang tidak aktif.`, { parse_mode: 'Markdown' });
        } else {
          const botInfo = await bot.getMe();
          const refLink = `https://t.me/${botInfo.username}?start=ref_${from.id}`;
          const refCount = db.getReferralCount(from.id);
          const minRef = parseInt(db.getSetting('referral_min_referrals') || '1');
          const rewardType = db.getSetting('referral_reward_type') || 'vip';
          const rewardText = rewardType === 'cash'
            ? `💰 Rp${parseInt(db.getSetting('referral_cash_amount') || '10000').toLocaleString('id-ID')}`
            : `⭐ VIP ${db.getSetting('referral_vip_days') || '7'} hari`;
          bot.sendMessage(chatId,
            `🔗 *Program Referral*\n\n` +
            `Ajak temanmu bergabung dan dapatkan hadiah!\n\n` +
            `🎁 Hadiah: *${rewardText}*\n` +
            `👥 Minimum undangan: *${minRef} orang*\n` +
            `📊 Referralmu saat ini: *${refCount}*\n\n` +
            `📎 Link referralmu:\n\`${refLink}\`\n\n` +
            `_Bagikan link di atas ke temanmu!_`,
            { parse_mode: 'Markdown' }
          );
        }
      } else if (cmd === '/withdraw') {
        const balance = db.getUserBalance(from.id);
        const minWithdraw = parseInt(db.getSetting('referral_min_withdraw') || '50000');
        if (balance <= 0) {
          bot.sendMessage(chatId, `💳 *Saldo Referral*\n\nSaldomu saat ini: *Rp0*\n\nAjak temanmu bergabung untuk mendapat saldo! 🔗 /referral`, { parse_mode: 'Markdown' });
        } else if (balance < minWithdraw) {
          bot.sendMessage(chatId,
            `💳 *Saldo Referral*\n\n` +
            `💰 Saldo: *Rp${balance.toLocaleString('id-ID')}*\n` +
            `📌 Minimum withdraw: *Rp${minWithdraw.toLocaleString('id-ID')}*\n\n` +
            `❌ Saldomu belum mencukupi untuk withdraw.\nTerus ajak temanmu! 🔗 /referral`,
            { parse_mode: 'Markdown' }
          );
        } else {
          // Start withdraw flow
          withdrawState.set(String(from.id), { step: 'method', balance });
          bot.sendMessage(chatId,
            `💳 *Withdraw Saldo Referral*\n\n` +
            `💰 Saldo: *Rp${balance.toLocaleString('id-ID')}*\n` +
            `📌 Minimum: *Rp${minWithdraw.toLocaleString('id-ID')}*\n\n` +
            `Pilih metode pembayaran:`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [
                [{ text: '🏦 Transfer Bank', callback_data: 'wd_bank' }, { text: '💳 E-Wallet', callback_data: 'wd_ewallet' }],
                [{ text: '❌ Batal', callback_data: 'wd_cancel' }]
              ]}
            }
          );
        }
      } else if (cmd === '/kirim') {
        const text = msg.text.replace(/^\/kirim(@\w+)?\s*/i, '').trim();
        if (!text) {
          bot.sendMessage(chatId,
            `✏️ *Cara Mengirim Pesan:*\n\n` +
            `1️⃣ Ketik langsung: \`/kirim pesanmu di sini\`\n` +
            `2️⃣ Atau kirim teks/foto tanpa command\n\n` +
            `📷 Untuk foto, langsung kirim foto ke chat ini.\n\n` +
            `_Contoh:_ \`/kirim Halo, ini pesan anonim!\``,
            { parse_mode: 'Markdown' }
          );
        } else {
          // Process inline /kirim <message> — skip to text handler below
          msg._kirimText = text;
        }
        if (!msg._kirimText) return;
      } else {
        bot.sendMessage(chatId,
          `❓ *Command tidak dikenal*\n\n` +
          `Gunakan salah satu command berikut:\n` +
          `• /start — Mulai bot\n` +
          `• /kirim — Kirim pesan anonim\n` +
          `• /referral — Program referral\n` +
          `• /withdraw — Tarik saldo referral\n` +
          `• /status — Cek status kiriman\n` +
          `• /help — Bantuan`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      if (!msg._kirimText) return;
    }

    // ── MAINTENANCE CHECK ──
    if (db.getSetting('maintenance_mode') === 'true') {
      bot.sendMessage(chatId, `🔧 *Sedang Maintenance*\n\nBot sedang dalam perbaikan dan tidak menerima pesan untuk sementara.\n\nSilakan coba lagi nanti. Terima kasih atas kesabaranmu! 🙏`, { parse_mode: 'Markdown' });
      return;
    }

    // ── USER VALIDATION ──
    const user = db.createOrUpdateUser(from.id, from.username || '', from.first_name || '', from.last_name || '');
    if (user.is_banned) {
      bot.sendMessage(chatId, `🚫 *Akses Ditolak*\n\nMaaf, akunmu telah dibatasi dan tidak dapat mengirim pesan melalui bot ini.`, { parse_mode: 'Markdown' });
      return;
    }

    // ── CHECK AUTO-POST / VIP ──
    const autoPost = db.getSetting('auto_post') === 'true';
    const isVip = autoPost || (user.is_vip && (!user.vip_expires_at || new Date(user.vip_expires_at + 'Z') > new Date()));

    // ── RATE LIMIT ──
    const limit = parseInt(db.getSetting('rate_limit') || '5');
    const now = Date.now(), key = String(from.id);
    if (!rateLimitMap.has(key)) rateLimitMap.set(key, []);
    const ts = rateLimitMap.get(key).filter(t => now - t < 60000);
    if (ts.length >= limit) {
      const waitSec = Math.ceil((60000 - (now - ts[0])) / 1000);
      bot.sendMessage(chatId, `⏳ *Terlalu Cepat!*\n\nKamu sudah mengirim ${limit} pesan dalam 1 menit terakhir.\nTunggu *${waitSec} detik* lagi sebelum mengirim pesan baru.`, { parse_mode: 'Markdown' });
      return;
    }
    ts.push(now);
    rateLimitMap.set(key, ts);

    // ── PHOTO ──
    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      if (isVip) {
        // VIP: auto-post to channel
        const msgId = db.createMessage(user.id, from.id, msg.caption || '', 'photo', photo.file_id, 'approved');
        try {
          const message = db.getMessage(msgId);
          const result = await postToChannel(message);
          db.setPostedMessageId(msgId, result.message_id);
          const label = autoPost && !user.is_vip
            ? `🚀 *Foto Langsung Diposting!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ✅ Diposting ke channel\n\n_Pesanmu langsung terbit di channel!_`
            : `⭐ *VIP — Foto Langsung Diposting!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ✅ Diposting ke channel\n\n_Keuntungan VIP: pesanmu langsung terbit tanpa review!_`;
          bot.sendMessage(chatId, label,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 Cek Status', callback_data: 'check_status' }]] } }
          );
        } catch (e) {
          bot.sendMessage(chatId, `⚠️ Gagal posting otomatis: ${e.message}`, { parse_mode: 'Markdown' });
        }
      } else {
        const msgId = db.createMessage(user.id, from.id, msg.caption || '', 'photo', photo.file_id);
        bot.sendMessage(chatId,
          `✅ *Foto Berhasil Dikirim!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ⏳ Menunggu review admin\n\nKamu akan mendapat notifikasi saat pesanmu diproses.\n\n_Ingin kirim pesan lagi? Langsung ketik atau kirim foto!_`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 Cek Status', callback_data: 'check_status' }]] } }
        );
        notifyAdmin(msgId, user, msg.caption || '📷 [Foto]');
      }
      return;
    }

    // ── TEXT ──
    if (msg.text || msg._kirimText) {
      const content = msg._kirimText || msg.text;
      if (isVip) {
        // VIP: auto-post to channel
        const msgId = db.createMessage(user.id, from.id, content, 'text', null, 'approved');
        try {
          const message = db.getMessage(msgId);
          const result = await postToChannel(message);
          db.setPostedMessageId(msgId, result.message_id);
          const label = autoPost && !user.is_vip
            ? `🚀 *Pesan Langsung Diposting!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ✅ Diposting ke channel\n\n_Pesanmu langsung terbit di channel!_`
            : `⭐ *VIP — Pesan Langsung Diposting!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ✅ Diposting ke channel\n\n_Keuntungan VIP: pesanmu langsung terbit tanpa review!_`;
          bot.sendMessage(chatId, label,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 Cek Status', callback_data: 'check_status' }]] } }
          );
        } catch (e) {
          bot.sendMessage(chatId, `⚠️ Gagal posting otomatis: ${e.message}`, { parse_mode: 'Markdown' });
        }
      } else {
        const msgId = db.createMessage(user.id, from.id, content, 'text');
        bot.sendMessage(chatId,
          `✅ *Pesan Berhasil Dikirim!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ⏳ Menunggu review admin\n\nKamu akan mendapat notifikasi saat pesanmu diproses.\n\n_Ingin kirim pesan lagi? Ketik /kirim atau langsung ketik saja!_`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 Cek Status', callback_data: 'check_status' }]] } }
        );
        notifyAdmin(msgId, user, content);
      }
      return;
    }

    // ── UNSUPPORTED FORMAT ──
    bot.sendMessage(chatId, `⚠️ *Format Tidak Didukung*\n\nBot hanya menerima:\n• 📝 Pesan teks\n• 📷 Foto\n\nSilakan kirim salah satu format di atas.`, { parse_mode: 'Markdown' });
  });

  console.log('🤖 Bot Telegram aktif!');
  return bot;
}

function checkAndGiveReward(referrerTgId) {
  const minRef = parseInt(db.getSetting('referral_min_referrals') || '1');
  const unrewarded = db.getUnrewardedReferralCount(referrerTgId);
  if (unrewarded < minRef) return;

  const rewardType = db.getSetting('referral_reward_type') || 'vip';

  if (rewardType === 'vip') {
    const vipDays = parseInt(db.getSetting('referral_vip_days') || '7');
    const user = db.getUser(referrerTgId);
    if (user) {
      db.setVip(user.id, vipDays);
      db.markReferralsRewarded(referrerTgId, 'vip');
      bot.sendMessage(referrerTgId,
        `🎁 *Selamat! Kamu Mendapat Hadiah Referral!*\n\n⭐ VIP *${vipDays} hari* telah aktif di akunmu!\n\nPesanmu sekarang langsung terbit tanpa review admin.\nTerus ajak temanmu untuk hadiah lagi! 🔗 /referral`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } else {
    const cashAmount = parseInt(db.getSetting('referral_cash_amount') || '10000');
    db.addReferralBalance(referrerTgId, cashAmount);
    db.markReferralsRewarded(referrerTgId, 'cash');
    const newBalance = db.getUserBalance(referrerTgId);
    bot.sendMessage(referrerTgId,
      `🎁 *Selamat! Kamu Mendapat Hadiah Referral!*\n\n💰 +Rp${cashAmount.toLocaleString('id-ID')} ditambahkan ke saldomu\n💳 Saldo saat ini: *Rp${newBalance.toLocaleString('id-ID')}*\n\nKetik /withdraw untuk tarik saldo!\nTerus ajak temanmu untuk hadiah lagi! 🔗 /referral`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

function notifyAdmin(msgId, user, preview) {
  if (db.getSetting('notify_admin') !== 'true') return;
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (!adminId) return;
  const sender = user.username ? `@${user.username}` : user.first_name;
  const msgCount = user.message_count || 0;
  const text = `📩 *Pesan Baru Masuk!*\n\n` +
    `🔢 ID: \`#${msgId}\`\n` +
    `👤 Dari: ${sender}\n` +
    `📊 Total kiriman user: ${msgCount + 1}\n\n` +
    `💬 *Preview:*\n${preview.substring(0, 300)}\n\n` +
    `_Buka dashboard untuk review._`;
  bot.sendMessage(adminId, text, { parse_mode: 'Markdown' }).catch(() => { });
}

async function postToChannel(message, customHashtag) {
  let channelId = db.getSetting('channel_id') || process.env.CHANNEL_ID;
  if (!channelId) throw new Error('Channel ID belum diatur! Isi di Pengaturan dashboard atau di file .env');

  // Convert numeric string to number for Telegram API
  if (/^-?\d+$/.test(channelId)) {
    channelId = Number(channelId);
  }

  console.log('📡 Posting ke channel:', channelId, typeof channelId);

  let content = message.content || '';

  // Prepend custom hashtag above the message
  const hashtagLine = (customHashtag || '').trim();
  if (hashtagLine) {
    content = hashtagLine + '\n\n' + content;
  }

  // Append global hashtag + footer at the bottom
  const parts = [];
  if (db.getSetting('hashtag_enabled') === 'true') { const ht = db.getSetting('hashtag_text'); if (ht) parts.push(ht); }
  const footer = db.getSetting('channel_footer');
  if (footer) parts.push(footer);
  const suffix = parts.length ? '\n\n' + parts.join(' | ') : '';

  try {
    if (message.media_type === 'photo' && message.media_file_id) {
      return await bot.sendPhoto(channelId, message.media_file_id, { caption: content + suffix });
    }
    return await bot.sendMessage(channelId, content + suffix);
  } catch (err) {
    console.error('❌ Gagal posting ke channel:', err.message);
    console.error('   Channel ID yang digunakan:', channelId);
    console.error('   Pastikan: 1) Bot sudah jadi ADMIN di channel, 2) Channel ID benar');
    throw err;
  }
}

async function notifyUser(tgId, text) {
  try { await bot.sendMessage(tgId, text); } catch (e) { console.error('Notify user failed:', e.message); }
}

async function deleteFromChannel(postedMessageId) {
  let channelId = require('../database/db').getSetting('channel_id') || process.env.CHANNEL_ID;
  if (!channelId || !postedMessageId) return;
  if (/^-?\d+$/.test(channelId)) channelId = Number(channelId);
  try {
    await bot.deleteMessage(channelId, postedMessageId);
    console.log('🗑️ Pesan dihapus dari channel:', postedMessageId);
  } catch (e) {
    console.error('Gagal hapus dari channel:', e.message);
  }
}

function getBot() { return bot; }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap.entries()) {
    const f = v.filter(t => now - t < 60000);
    if (!f.length) rateLimitMap.delete(k); else rateLimitMap.set(k, f);
  }
}, 60000);

// VIP expiration check every 5 minutes
setInterval(() => {
  try {
    const expired = db.expireVips();
    expired.forEach(u => {
      if (u.telegram_id && bot) {
        bot.sendMessage(u.telegram_id,
          `⏰ *VIP Kamu Telah Berakhir*\n\nMasa aktif VIP kamu sudah habis. Pesanmu sekarang akan melalui review admin terlebih dahulu.\n\nHubungi admin jika ingin memperpanjang VIP! ⭐`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    });
    if (expired.length) console.log(`⭐ ${expired.length} VIP expired`);
  } catch (e) {
    console.error('VIP expiry check error:', e.message);
  }
}, 5 * 60 * 1000);

module.exports = { initBot, getBot, postToChannel, notifyUser, deleteFromChannel };
