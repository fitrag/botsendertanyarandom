const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');

let bot;
const rateLimitMap = new Map();
const writeMode = new Set();
const lastBotMsg = new Map();
const supportState = new Map();
const supportReplyFor = new Map();
const channelMemberCache = new Map();

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
    const welcome = `Halo *${name}*! 👋\n\nSelamat datang di *Bot Pesan Anonim*.\nBot ini memungkinkan kamu mengirim pesan teks secara anonim ke channel kami.\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `📝 *Cara Mengirim Pesan:*\n\n` +
      `1️⃣ Ketik pesan teksmu langsung di chat ini\n` +
      `2️⃣ Pesan akan direview oleh admin\n` +
      `3️⃣ Jika disetujui, pesan terbit di channel!\n` +
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
    const isPaid = db.getSetting('paid_message_enabled') === 'true';
    const messageCost = parseInt(db.getSetting('message_cost') || '5000');
    const help = `📖 *Panduan Penggunaan Bot*\n\n` +
      `🔹 *Mengirim Pesan*\nKlik *✏️ Kirim Pesan* di Menu Utama, lalu tulis pesanmu. Bisa juga gunakan perintah /kirim.\n` +
      (isPaid ? `\n💰 Biaya kirim: *Rp${messageCost.toLocaleString('id-ID')}* / pesan\nGunakan /balance untuk cek saldo, /topup untuk isi saldo.\n` : '') +
      `\n🔹 *Cek Status*\nKlik *📋 Status Kiriman* atau ketik /status.\n\n` +
      `🔹 *Dapatkan Saldo*\nAjak teman lewat *🔗 Referral* — dapat hadiah saldo untuk biaya kirim pesan!\n\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ *Peraturan:*\n• Jangan kirim spam atau pesan berulang\n• Konten harus sopan dan sesuai aturan\n• Admin berhak menolak pesan yang tidak sesuai`;
    bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
  }

  function sendStatus(chatId, userId) {
    const msgs = db.getUserMessages(userId);
    if (!msgs.length) {
      bot.sendMessage(chatId, `📭 *Belum Ada Kiriman*\n\nKamu belum pernah mengirim pesan.\n\nKlik *✏️ Kirim Pesan* dari menu untuk mulai!`, { parse_mode: 'Markdown' });
      return;
    }
    const statusLabels = { pending: '⏳ Menunggu Review', approved: '✅ Disetujui & Diposting', rejected: '❌ Tidak Disetujui' };
    let text = `📋 *5 Kiriman Terakhirmu:*\n\n`;
    msgs.forEach((m, i) => {
      const preview = m.content ? m.content.substring(0, 40) : '💬 Pesan';
      const date = new Date(m.created_at + 'Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      text += `${i + 1}. ${statusLabels[m.status] || m.status}\n    💬 _${preview}${m.content && m.content.length > 40 ? '...' : ''}_\n    📅 ${date}\n\n`;
    });
    text += `━━━━━━━━━━━━━━━━━\n✏️ Kirim pesan baru kapan saja!`;
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  function createTopupPayment(chatId, tgId, amount, slug) {
    const orderId = `TOPDUP-${tgId}-${Date.now()}`;
    db.createTopupTransaction(tgId, amount, orderId);
    const payUrl = `https://app.pakasir.com/pay/${slug}/${amount}?order_id=${encodeURIComponent(orderId)}&qris_only=1`;
    bot.sendMessage(chatId,
      `💳 *Top-Up Rp${amount.toLocaleString('id-ID')}*\n\n` +
      `🔢 ID: \`${orderId}\`\n\n` +
      `Klik tombol di bawah untuk membayar via *Pakasir* (QRIS & Virtual Account):`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Bayar via Pakasir', url: payUrl }]
          ]
        }
      }
    );
  }

  async function sendClean(chatId, text, options = {}) {
    const prevMsgId = lastBotMsg.get(String(chatId));
    if (prevMsgId) {
      try { await bot.deleteMessage(chatId, prevMsgId); } catch(e) {}
    }
    const sent = await bot.sendMessage(chatId, text, options);
    lastBotMsg.set(String(chatId), sent.message_id);
    return sent;
  }

  function getChannelLink() {
    const link = (db.getSetting('channel_link') || '').trim();
    if (!link) return '';
    return link.startsWith('http') ? link : 'https://' + link;
  }

  async function showMainMenu(chatId) {
    const isPaid = db.getSetting('paid_message_enabled') === 'true';
    const cost = parseInt(db.getSetting('message_cost') || '5000');
    const paidLabel = isPaid ? `\n💰 Biaya: *Rp${cost.toLocaleString('id-ID')}* / pesan` : '';
    return sendClean(chatId,
      `📋 *Menu Utama*${paidLabel}\n\nSilakan pilih menu di bawah:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Kirim Pesan', callback_data: 'menu_write' }],
            [{ text: '💰 Cek Saldo', callback_data: 'menu_balance' }, { text: '📋 Status Kiriman', callback_data: 'check_status' }],
[{ text: '🔗 Referral', callback_data: 'menu_referral' }, { text: '💳 Top-Up', callback_data: 'menu_topup' }],
            [{ text: '❓ Bantuan', callback_data: 'show_help' }, { text: '📞 Support', callback_data: 'menu_support' }]
          ]
        }
      }
    );
  }

  function askGender(chatId) {
    bot.sendMessage(chatId,
      `👤 *Pilih Jenis Kelamin*\n\nSilakan pilih jenis kelamin kamu. Ini akan digunakan untuk memberi tag pada pesanmu di channel.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '👨 Laki-laki', callback_data: 'set_gender_laki' },
              { text: '👩 Perempuan', callback_data: 'set_gender_perempuan' }
            ]
          ]
        }
      }
    );
  }

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
    if (query.message.chat.type !== 'private') return;
    const chatId = query.message.chat.id;
    const fromId = String(query.from.id);
    const data = query.data;
    bot.answerCallbackQuery(query.id).catch(() => {});

    // ── MUST JOIN CHANNEL ──
    const channelId = db.getSetting('channel_id') || process.env.CHANNEL_ID;
    if (channelId) {
      const cacheKey = fromId;
      const cached = channelMemberCache.get(cacheKey);
      const now = Date.now();
      let isMember = false;
      if (cached && (now - cached.time < 5000)) {
        isMember = cached.member;
      } else {
        try {
          const cid = /^-?\d+$/.test(channelId) ? Number(channelId) : channelId;
          const chatMember = await bot.getChatMember(cid, query.from.id);
          isMember = ['creator', 'administrator', 'member'].includes(chatMember.status);
          channelMemberCache.set(cacheKey, { member: isMember, time: now });
        } catch(e) {
          console.error('getChatMember error:', e.message);
          isMember = true;
        }
      }
      if (!isMember) {
        const channelLink = getChannelLink();
        const keyboard = channelLink
          ? { reply_markup: { inline_keyboard: [[{ text: '📢 Gabung Channel', url: channelLink }]] } }
          : {};
        bot.sendMessage(chatId,
          `🔒 *Akses Terbatas*\n\nKamu harus bergabung ke channel terlebih dahulu untuk menggunakan bot ini.` + (channelLink ? `\n\nKlik tombol di bawah untuk bergabung:` : ''),
          { parse_mode: 'Markdown', ...keyboard }
        );
        return;
      }
    }

    if (data === 'check_status') {
      sendStatus(chatId, query.from.id);
    } else if (data === 'show_help') {
      sendHelp(chatId);
    } else if (data === 'set_gender_laki') {
      db.setGender(query.from.id, 'male');
      bot.sendMessage(chatId, `✅ Jenis kelamin disimpan: *Laki-laki* 🧑`, { parse_mode: 'Markdown' });
      setTimeout(() => showMainMenu(chatId), 400);
    } else if (data === 'set_gender_perempuan') {
      db.setGender(query.from.id, 'female');
      bot.sendMessage(chatId, `✅ Jenis kelamin disimpan: *Perempuan* 👩`, { parse_mode: 'Markdown' });
      setTimeout(() => showMainMenu(chatId), 400);
    } else if (data.startsWith('topup_')) {
      const amount = parseInt(data.replace('topup_', ''));
      const slug = db.getSetting('pakasir_slug');
      if (!slug) {
        bot.sendMessage(chatId, '❌ Fitur top-up belum dikonfigurasi.', { parse_mode: 'Markdown' });
        return;
      }
      createTopupPayment(chatId, query.from.id, amount, slug);
    } else if (data === 'menu_write') {
      writeMode.add(fromId);
      sendClean(chatId,
        `✏️ *Tulis Pesan*\n\nSilakan ketik pesan yang ingin kamu kirim ke channel.\n\n_Pesanmu akan direview admin terlebih dahulu._\n\n📌 Ketik *batal* untuk keluar.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_cancel_write' }]] }
        }
      );
    } else if (data === 'menu_cancel_write') {
      writeMode.delete(fromId);
      showMainMenu(chatId);
    } else if (data === 'menu_balance') {
      const totalBalance = db.getTotalBalance(query.from.id);
      const isPaid = db.getSetting('paid_message_enabled') === 'true';
      const messageCost = parseInt(db.getSetting('message_cost') || '5000');
      bot.sendMessage(chatId,
        `💰 *Saldo Kamu*\n\nSaldo: *Rp${totalBalance.toLocaleString('id-ID')}*\n` +
        (isPaid ? `Biaya kirim pesan: *Rp${messageCost.toLocaleString('id-ID')}*\nBisa kirim: *${Math.floor(totalBalance / messageCost)} pesan*` : `Kirim pesan: *GRATIS* 🎉`),
        { parse_mode: 'Markdown' }
      );
      setTimeout(() => showMainMenu(chatId), 500);
    } else if (data === 'menu_referral') {
      if (db.getSetting('referral_enabled') !== 'true') {
        bot.sendMessage(chatId, `❌ Fitur referral sedang tidak aktif.`, { parse_mode: 'Markdown' });
        setTimeout(() => showMainMenu(chatId), 500);
      } else {
        const botInfo = await bot.getMe();
        const refLink = `https://t.me/${botInfo.username}?start=ref_${query.from.id}`;
        const refCount = db.getReferralCount(query.from.id);
        const cashAmount = parseInt(db.getSetting('referral_cash_amount') || '10000');
        bot.sendMessage(chatId,
          `🔗 *Program Referral*\n\nAjak teman dapat *Rp${cashAmount.toLocaleString('id-ID')}* saldo!\n📊 Referralmu: *${refCount}*\n\n📎 Link:\n\`${refLink}\``,
          { parse_mode: 'Markdown' }
        );
        setTimeout(() => showMainMenu(chatId), 600);
      }
} else if (data === 'menu_topup') {
      const slug = db.getSetting('pakasir_slug');
      const miniappEnabled = db.getSetting('topup_miniapp_enabled') !== 'false';
      if (!slug || !miniappEnabled) {
        const refEnabled = db.getSetting('referral_enabled') === 'true';
        const botInfo = await bot.getMe();
        const refLink = `https://t.me/${botInfo.username}?start=ref_${query.from.id}`;
        let msg = `💳 *Top-Up Saldo*\n\n` + (!miniappEnabled ? `Fitur top-up via aplikasi sedang dinonaktifkan.\n\n` : `Fitur top-up online belum dikonfigurasi.\n\n`);
        if (refEnabled) {
          msg += `🎁 *Dapatkan saldo lewat Referral!*\nAjak teman bergabung dan dapatkan saldo.\n\n📎 Link:\n\`${refLink}\``;
        } else {
          msg += `📲 Hubungi admin untuk top-up manual.`;
        }
        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        setTimeout(() => showMainMenu(chatId), 600);
      } else {
        const miniAppUrl = process.env.WEBAPP_URL || '';
        const botTopup = db.getSetting('topup_bot_enabled') !== 'false';
        const keyboard = [];
        if (miniAppUrl) keyboard.push([{ text: '📱 Buka Aplikasi Top-Up', web_app: { url: miniAppUrl + '/topup' } }]);
        if (botTopup) {
          keyboard.push(
            [{ text: '💰 Rp10.000', callback_data: 'topup_10000' }],
            [{ text: '💰 Rp25.000', callback_data: 'topup_25000' }],
            [{ text: '💰 Rp50.000', callback_data: 'topup_50000' }],
            [{ text: '💰 Rp100.000', callback_data: 'topup_100000' }]
          );
        }
        keyboard.push([{ text: '« Kembali', callback_data: 'menu_back' }]);
        const msgText = botTopup ? `💳 *Top-Up Saldo*\n\nPilih nominal atau ketik /topup <jumlah>` : `💳 *Top-Up Saldo*\n\n📱 Gunakan aplikasi top-up untuk isi saldo.`;
        sendClean(chatId, msgText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
      }
} else if (data === 'menu_back') {
      showMainMenu(chatId);
    } else if (data === 'menu_support') {
      supportState.set(fromId, { step: 'subject' });
      sendClean(chatId,
        `📞 *Support / Bantuan*\n\nSilakan tulis judul/subjek masalah kamu.\n\n_Contoh: "Saldo tidak masuk" atau "Pesan tidak terkirim"_`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'support_cancel' }]] } }
      );
    } else if (data === 'support_cancel') {
      supportState.delete(fromId);
      showMainMenu(chatId);
    } else if (data.startsWith('support_reply_')) {
      const ticketId = parseInt(data.replace('support_reply_', ''));
      const ticket = db.getSupportTicket(ticketId);
      if (!ticket || ticket.status === 'closed') {
        bot.sendMessage(chatId, '❌ Tiket sudah ditutup.', { parse_mode: 'Markdown' });
        return;
      }
      supportReplyFor.set(fromId, ticketId);
      bot.sendMessage(chatId,
        `💬 *Balas Tiket #SUP${ticketId}*\n\nTulis balasan kamu:\n\n📌 Ketik *batal* untuk keluar.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'support_reply_cancel' }]] }
        }
      );
    } else if (data === 'support_reply_cancel') {
      supportReplyFor.delete(fromId);
      showMainMenu(chatId);
    }
  });

  // ===== PRIVATE MESSAGE HANDLER =====
  bot.on('message', async (msg) => {
    // STRICT: Only process private (1-on-1) messages
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const from = msg.from;

    // ── USER MUST /start FIRST ──
    const cmdCheck = msg.text && msg.text.startsWith('/') ? msg.text.split('@')[0].toLowerCase().split(' ')[0] : '';
    if (cmdCheck !== '/start') {
      const existingUser = db.getUser(from.id);
      if (!existingUser) {
        bot.sendMessage(chatId, `👋 *Halo!*\n\nSebelum menggunakan bot, silakan ketik /start terlebih dahulu.`, { parse_mode: 'Markdown' });
        return;
      }
    }

    // ── MUST JOIN CHANNEL ──
    if (cmdCheck !== '/start') {
      const channelId = db.getSetting('channel_id') || process.env.CHANNEL_ID;
      const channelLink = getChannelLink();
      if (channelId) {
        const cacheKey = String(from.id);
        const cached = channelMemberCache.get(cacheKey);
        const now = Date.now();

        let isMember = false;
        if (cached && (now - cached.time < 5000)) {
          isMember = cached.member;
        } else {
          try {
            const chatId = /^-?\d+$/.test(channelId) ? Number(channelId) : channelId;
            const chatMember = await bot.getChatMember(chatId, from.id);
            isMember = ['creator', 'administrator', 'member'].includes(chatMember.status);
            channelMemberCache.set(cacheKey, { member: isMember, time: now });
          } catch(e) {
            console.error('getChatMember error:', e.message);
            isMember = true;
          }
        }

        if (!isMember) {
          const keyboard = channelLink
            ? { reply_markup: { inline_keyboard: [[{ text: '📢 Gabung Channel', url: channelLink }]] } }
            : {};
          bot.sendMessage(chatId,
            `🔒 *Akses Terbatas*\n\nKamu harus bergabung ke channel terlebih dahulu untuk menggunakan bot ini.` + (channelLink ? `\n\nKlik tombol di bawah untuk bergabung:` : ''),
            { parse_mode: 'Markdown', ...keyboard }
          );
          return;
        }
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
        // Prompt gender if not set, otherwise show main menu
        setTimeout(() => {
          const startedUser = db.getUser(from.id);
          if (!startedUser || !startedUser.gender) {
            askGender(chatId);
          } else {
            showMainMenu(chatId);
          }
        }, 600);
      } else if (cmd === '/help') {
        sendHelp(chatId);
      } else if (cmd === '/support') {
        supportState.set(String(from.id), { step: 'subject' });
        sendClean(chatId,
          `📞 *Support / Bantuan*\n\nSilakan tulis judul/subjek masalah kamu.\n\n_Contoh: "Saldo tidak masuk" atau "Pesan tidak terkirim"_`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'support_cancel' }]] } }
        );
      } else if (cmd === '/status') {
        sendStatus(chatId, from.id);
      } else if (cmd === '/menu') {
        writeMode.delete(String(from.id));
        showMainMenu(chatId);
      } else if (cmd === '/referral') {
        if (db.getSetting('referral_enabled') !== 'true') {
          bot.sendMessage(chatId, `❌ Fitur referral sedang tidak aktif.`, { parse_mode: 'Markdown' });
        } else {
          const botInfo = await bot.getMe();
          const refLink = `https://t.me/${botInfo.username}?start=ref_${from.id}`;
          const refCount = db.getReferralCount(from.id);
          const minRef = parseInt(db.getSetting('referral_min_referrals') || '1');
          const cashAmount = parseInt(db.getSetting('referral_cash_amount') || '10000');
          bot.sendMessage(chatId,
            `🔗 *Program Referral*\n\n` +
            `Ajak temanmu bergabung dan dapatkan hadiah!\n\n` +
            `🎁 Hadiah: *Rp${cashAmount.toLocaleString('id-ID')}* saldo\n` +
            `👥 Minimum undangan: *${minRef} orang*\n` +
            `📊 Referralmu saat ini: *${refCount}*\n\n` +
            `📎 Link referralmu:\n\`${refLink}\`\n\n` +
            `_Bagikan link di atas ke temanmu!_`,
            { parse_mode: 'Markdown' }
          );
        }
      } else if (cmd === '/balance') {
        const totalBalance = db.getTotalBalance(from.id);
        const isPaid = db.getSetting('paid_message_enabled') === 'true';
        const messageCost = parseInt(db.getSetting('message_cost') || '5000');
        bot.sendMessage(chatId,
          `💰 *Saldo Kamu*\n\n` +
          `Saldo: *Rp${totalBalance.toLocaleString('id-ID')}*\n` +
          (isPaid ? `Biaya kirim pesan: *Rp${messageCost.toLocaleString('id-ID')}*\nBisa kirim: *${Math.floor(totalBalance / messageCost)} pesan*\n` : `Kirim pesan: *GRATIS* 🎉\n`) +
          `\n📌 Cara isi saldo:\n• 🎁 /referral — Ajak teman dapat saldo\n• 💳 /topup — Top-up via Pakasir`,
          { parse_mode: 'Markdown' }
        );
      } else if (cmd === '/topup') {
        const slug = db.getSetting('pakasir_slug');
        const miniappEnabled = db.getSetting('topup_miniapp_enabled') !== 'false';
        if (!slug || !miniappEnabled) {
          // Show referral as alternative
          const refEnabled = db.getSetting('referral_enabled') === 'true';
          const botInfo = await bot.getMe();
          const refLink = `https://t.me/${botInfo.username}?start=ref_${from.id}`;
          let msg = `💳 *Top-Up Saldo*\n\n` + (!miniappEnabled ? `Fitur top-up via aplikasi sedang dinonaktifkan.\n\n` : `Fitur top-up online belum dikonfigurasi.\n\n`);
          if (refEnabled) {
            msg += `🎁 *Dapatkan saldo lewat Referral!*\nAjak teman bergabung dan dapatkan saldo gratis.\n\n📎 Link referralmu:\n\`${refLink}\``;
            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
          } else {
            msg += `📲 Silakan hubungi admin untuk top-up manual.`;
            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
          }
        } else {
          const args2 = msg.text.split(' ');
          if (args2[1] && /^\d+$/.test(args2[1]) && parseInt(args2[1]) >= 1000) {
            const customAmount = parseInt(args2[1]);
            createTopupPayment(chatId, from.id, customAmount, slug);
          } else {
            const miniAppUrl = process.env.WEBAPP_URL || '';
            const botTopup = db.getSetting('topup_bot_enabled') !== 'false';
            const keyboard = [];
            if (miniAppUrl) keyboard.push([{ text: '📱 Buka Aplikasi Top-Up', web_app: { url: miniAppUrl + '/topup' } }]);
            if (botTopup) {
              keyboard.push(
                [{ text: '💰 Rp10.000', callback_data: 'topup_10000' }],
                [{ text: '💰 Rp25.000', callback_data: 'topup_25000' }],
                [{ text: '💰 Rp50.000', callback_data: 'topup_50000' }],
                [{ text: '💰 Rp100.000', callback_data: 'topup_100000' }]
              );
            }
            const msgText = !miniAppUrl ? `💳 *Top-Up Saldo via Pakasir*\n\nTop-up hanya tersedia lewat Mini App.\n\n📱 Silakan buka aplikasi top-up kami.` :
              !botTopup ? `💳 *Top-Up Saldo via Pakasir*\n\n📱 Gunakan aplikasi top-up untuk isi saldo.` :
              `💳 *Top-Up Saldo via Pakasir*\n\n📱 *Rekomendasi:* Gunakan aplikasi top-up!\n\nPilih nominal top-up:\n\nAtau ketik \`/topup <jumlah>\` untuk nominal custom.\n_Contoh: /topup 15000_`;
            if (keyboard.length) {
              sendClean(chatId, msgText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
            } else {
              bot.sendMessage(chatId, `💳 *Top-Up Saldo*\n\nTop-up hanya tersedia lewat Mini App.\n\n📱 Silakan tanya admin untuk info lebih lanjut.`, { parse_mode: 'Markdown' });
            }
          }
        }
      } else if (cmd === '/kirim') {
        const text = msg.text.replace(/^\/kirim(@\w+)?\s*/i, '').trim();
        if (!text) {
          writeMode.add(String(from.id));
          sendClean(chatId,
            `✏️ *Tulis Pesan*\n\nSilakan ketik pesan yang ingin kamu kirim ke channel.\n\n📌 Ketik *batal* untuk keluar.`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_cancel_write' }]] }
            }
          );
          return;
        } else {
          msg._kirimText = text;
        }
        if (!msg._kirimText) return;
      } else {
        bot.sendMessage(chatId,
          `❓ *Command tidak dikenal*\n\n` +
          `Gunakan salah satu command berikut:\n` +
          `• /start — Mulai bot\n` +
          `• /menu — Tampilkan menu utama\n` +
          `• /kirim — Kirim pesan anonim\n` +
          `• /balance — Cek saldo\n` +
          `• /topup — Info top-up saldo\n` +
          `• /referral — Program referral\n` +
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

    // ── GENDER CHECK ──
    if (!user.gender) {
      askGender(chatId);
      return;
    }

    // ── WRITE MODE CHECK ──
    const inWriteMode = writeMode.has(String(from.id)) || !!msg._kirimText;

    // ── TEXT (write mode or /kirim) ──
    if (msg.text) {
      const text = msg._kirimText || msg.text;

      // ── SUPPORT FLOW ──
      if (msg._kirimText) msg._kirimText = undefined;
      const supState = supportState.get(String(from.id));
      const replyTicketId = supportReplyFor.get(String(from.id));

      // ── SUPPORT REPLY FLOW ──
      if (replyTicketId && !msg.text.startsWith('/')) {
        const input = text.trim();
        if (input.toLowerCase() === 'batal') {
          supportReplyFor.delete(String(from.id));
          showMainMenu(chatId);
          return;
        }
        if (input.length < 3) {
          bot.sendMessage(chatId, '⚠️ Balasan terlalu pendek.', { parse_mode: 'Markdown' });
          return;
        }
        supportReplyFor.delete(String(from.id));
        db.addSupportMessage(replyTicketId, 'user', input);
        const ticket = db.getSupportTicket(replyTicketId);
        bot.sendMessage(chatId,
          `✅ *Balasan Terkirim!*\n\nTiket #SUP${replyTicketId}: _${ticket ? ticket.subject : ''}_\n\nAdmin akan segera merespon.`,
          { parse_mode: 'Markdown' }
        );
        const adminId = process.env.ADMIN_TELEGRAM_ID;
        if (adminId) {
          const userName = from.first_name || from.username || String(from.id);
          bot.sendMessage(adminId,
            `💬 *Balasan User — #SUP${replyTicketId}*\n\n👤 Dari: ${userName}\n\n${input.substring(0, 300)}${input.length > 300 ? '...' : ''}\n\n_Buka dashboard untuk merespon._`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
        setTimeout(() => showMainMenu(chatId), 800);
        return;
      }

      // ── SUPPORT CREATE FLOW ──
      if (supState && !msg.text.startsWith('/')) {
        const input = text.trim();
        if (supState.step === 'subject') {
          if (input.length < 3) {
            bot.sendMessage(chatId, '⚠️ Subjek terlalu pendek. Minimal 3 karakter.', { parse_mode: 'Markdown' });
            return;
          }
          supportState.set(String(from.id), { step: 'message', subject: input });
          bot.sendMessage(chatId,
            `📞 *Support*\n\nSubjek: _${input}_\n\nSekarang tulis pesan / detail masalah kamu.\n\n📌 Ketik *batal* untuk keluar.`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'support_cancel' }]] } }
          );
          return;
        } else if (supState.step === 'message') {
          if (input.length < 5) {
            bot.sendMessage(chatId, '⚠️ Pesan terlalu pendek. Minimal 5 karakter.', { parse_mode: 'Markdown' });
            return;
          }
          const userName = from.first_name || from.username || String(from.id);
          const ticketId = db.createSupportTicket(from.id, userName, supState.subject, input);
          supportState.delete(String(from.id));
          bot.sendMessage(chatId,
            `✅ *Tiket Support Terkirim!*\n\n🔢 ID: \`#SUP${ticketId}\`\n📋 Subjek: _${supState.subject}_\n\nAdmin kami akan segera merespon.\nKamu akan dihubungi lewat Telegram.`,
            { parse_mode: 'Markdown' }
          );
          // Notify admin
          const adminId = process.env.ADMIN_TELEGRAM_ID;
          if (adminId) {
            bot.sendMessage(adminId,
              `📞 *Tiket Support Baru!*\n\n🔢 ID: \`#SUP${ticketId}\`\n👤 Dari: ${userName}\n📋 Subjek: ${supState.subject}\n💬 Pesan: ${input.substring(0, 200)}${input.length > 200 ? '...' : ''}\n\n_Buka dashboard untuk merespon._`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }
          setTimeout(() => showMainMenu(chatId), 800);
          return;
        }
      }

      // "batal" to exit write mode
      if (inWriteMode && !msg._kirimText && text.trim().toLowerCase() === 'batal') {
        writeMode.delete(String(from.id));
        showMainMenu(chatId);
        return;
      }

      if (inWriteMode) {
        writeMode.delete(String(from.id));

        // ── PAID MESSAGE CHECK ──
        if (db.getSetting('paid_message_enabled') === 'true') {
          const messageCost = parseInt(db.getSetting('message_cost') || '5000');
          const totalBalance = db.getTotalBalance(from.id);
          if (totalBalance < messageCost) {
            bot.sendMessage(chatId,
              `💰 *Saldo Tidak Cukup*\n\n` +
              `Biaya kirim pesan: *Rp${messageCost.toLocaleString('id-ID')}*\n` +
              `Saldo kamu: *Rp${totalBalance.toLocaleString('id-ID')}*\n` +
              `Kekurangan: *Rp${(messageCost - totalBalance).toLocaleString('id-ID')}*\n\n` +
              `📌 Cara isi saldo:\n` +
              `• 🎁 Ajak teman lewat /referral\n` +
              `• 💳 Top-up via admin (ketik /topup)\n\n` +
              `_Saldo akan otomatis terpotong saat kirim pesan._`,
              { parse_mode: 'Markdown' }
            );
            showMainMenu(chatId);
            return;
          }
          db.deductBalance(from.id, messageCost);
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

        // ── POST MESSAGE ──
        const content = text;
        if (isVip) {
          const msgId = db.createMessage(user.id, from.id, content, 'approved');
          try {
            const message = db.getMessage(msgId);
            const result = await postToChannel(message);
            db.setPostedMessageId(msgId, result.message_id);
            const label = autoPost && !user.is_vip
              ? `🚀 *Pesan Langsung Diposting!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ✅ Diposting ke channel`
              : `⭐ *VIP — Pesan Langsung Diposting!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ✅ Diposting ke channel`;
            bot.sendMessage(chatId, label, { parse_mode: 'Markdown' });
          } catch (e) {
            bot.sendMessage(chatId, `⚠️ Gagal posting otomatis: ${e.message}`, { parse_mode: 'Markdown' });
          }
        } else {
          const msgId = db.createMessage(user.id, from.id, content);
          bot.sendMessage(chatId,
            `✅ *Pesan Berhasil Dikirim!*\n\n📋 ID Kiriman: \`#${msgId}\`\n📌 Status: ⏳ Menunggu review admin`,
            { parse_mode: 'Markdown' }
          );
          notifyAdmin(msgId, user, content);
        }
        showMainMenu(chatId);
        return;
      } else {
        // Not in write mode — show main menu
        showMainMenu(chatId);
        return;
      }
    }

    // ── UNSUPPORTED FORMAT ──
    bot.sendMessage(chatId, `⚠️ *Format Tidak Didukung*\n\nBot hanya menerima pesan teks.\n\nSilakan kirim pesan teks saja.`, { parse_mode: 'Markdown' });
  });

  console.log('🤖 Bot Telegram aktif!');
  return bot;
}

function checkAndGiveReward(referrerTgId) {
  const minRef = parseInt(db.getSetting('referral_min_referrals') || '1');
  const unrewarded = db.getUnrewardedReferralCount(referrerTgId);
  if (unrewarded < minRef) return;

  const cashAmount = parseInt(db.getSetting('referral_cash_amount') || '10000');
  db.addBalance(referrerTgId, cashAmount);
  db.markReferralsRewarded(referrerTgId, 'cash');
  const newBalance = db.getTotalBalance(referrerTgId);
  bot.sendMessage(referrerTgId,
    `🎁 *Selamat! Kamu Mendapat Hadiah Referral!*\n\n💰 +Rp${cashAmount.toLocaleString('id-ID')} ditambahkan ke saldomu\n💳 Saldo saat ini: *Rp${newBalance.toLocaleString('id-ID')}*\n\nGunakan saldo ini untuk biaya kirim pesan!\nTerus ajak temanmu untuk hadiah lagi! 🔗 /referral`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
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

  if (/^-?\d+$/.test(channelId)) {
    channelId = Number(channelId);
  }

  console.log('📡 Posting ke channel:', channelId, typeof channelId);

  let content = message.content || '';

  // Prepend gender hashtag + custom hashtag above the message
  const topTags = [];
  if (message.gender === 'male') topTags.push('#FWBBoy');
  else if (message.gender === 'female') topTags.push('#FWBGirl');
  const hashtagLine = (customHashtag || '').trim();
  if (hashtagLine) topTags.push(hashtagLine);
  if (topTags.length) {
    content = topTags.join(' ') + '\n\n' + content;
  }

  // Append username + footer at the bottom
  const parts = [];
  if (message.username && message.username !== '') parts.push('@' + message.username);
  const footer = db.getSetting('channel_footer');
  if (footer) parts.push(footer);
  const suffix = parts.length ? '\n\n' + parts.join(' | ') : '';

  try {
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

async function postAnnouncement(text, shouldPin) {
  let channelId = db.getSetting('channel_id') || process.env.CHANNEL_ID;
  if (!channelId) throw new Error('Channel ID belum diatur');
  if (/^-?\d+$/.test(channelId)) channelId = Number(channelId);

  const sent = await bot.sendMessage(channelId, text, { parse_mode: 'Markdown' });
  if (shouldPin && sent) {
    try { await bot.pinChatMessage(channelId, sent.message_id); } catch(e) {}
  }
  return sent;
}

module.exports = { initBot, getBot, postToChannel, notifyUser, deleteFromChannel, postAnnouncement };
